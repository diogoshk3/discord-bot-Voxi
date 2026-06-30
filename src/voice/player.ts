import {
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
} from '@discordjs/voice';
import type { TTSEngine, SynthRequest } from '../tts/engine';
import { PlayQueue } from './queue';

export class GuildVoicePlayer {
  private readonly player: AudioPlayer;
  private readonly queue: PlayQueue;
  private current: AudioResource | null = null;
  private playing = false;
  private destroyed = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private reconnecting = false;

  constructor(
    private readonly connection: VoiceConnection,
    private readonly engine: TTSEngine,
    queueCap: number,
    private readonly inactivityMs: number,
    private readonly onIdle: () => void,
  ) {
    this.queue = new PlayQueue(queueCap);
    this.player = createAudioPlayer();
    this.connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.current = null;
      this.playNext();
    });

    this.player.on('error', (err) => {
      console.error('[player] erro no AudioPlayer:', err);
      this.current = null;
      this.playNext();
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      void this.handleDisconnect();
    });

    this.armIdleTimer();
  }

  async say(req: SynthRequest): Promise<void> {
    if (this.destroyed) return;
    const audioPath = await this.engine.synth(req);
    const ok = this.queue.enqueue({ audioPath });
    if (!ok) {
      console.warn('[player] fila cheia, descartado:', audioPath);
      return;
    }
    if (!this.playing) {
      this.playNext();
    }
  }

  skip(): void {
    if (this.destroyed) return;
    // stop() emite Idle -> o handler chama playNext() e avanca para o proximo item.
    this.player.stop(true);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearIdleTimer();
    this.queue.clear();
    this.current = null;
    this.playing = false;
    try {
      this.player.stop(true);
    } catch {
      // ignorar
    }
    try {
      this.connection.destroy();
    } catch {
      // ja pode estar destruida
    }
  }

  private playNext(): void {
    if (this.destroyed) return;
    const next = this.queue.dequeue();
    if (!next) {
      this.playing = false;
      this.armIdleTimer();
      return;
    }
    this.clearIdleTimer();
    this.playing = true;
    const resource = createAudioResource(next.audioPath, {
      inputType: StreamType.Arbitrary,
    });
    this.current = resource;
    this.player.play(resource);
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    if (this.destroyed) return;
    this.idleTimer = setTimeout(() => {
      if (this.destroyed) return;
      if (!this.playing && this.queue.size() === 0) {
        this.onIdle();
      }
    }, this.inactivityMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async handleDisconnect(): Promise<void> {
    if (this.destroyed || this.reconnecting) return;
    this.reconnecting = true;
    try {
      // Reconexao "soft": o gateway esta a renegociar a sessao de voz.
      await Promise.race([
        entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Recuperou — esperar que volte a Ready.
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      // Nao recuperou — tentar rejoin manual algumas vezes.
      const recovered = await this.tryRejoin(3);
      if (!recovered) {
        this.destroy();
        this.onIdle();
        return;
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private async tryRejoin(attempts: number): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      if (this.destroyed) return false;
      try {
        this.connection.rejoin();
        await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 1_000 * (i + 1)));
      }
    }
    return false;
  }
}
