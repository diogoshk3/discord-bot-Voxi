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
import { log } from '../logging/logger';
import { metrics } from '../metrics';

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
      void this.playNext();
    });

    this.player.on('error', (err) => {
      log.error('[player] erro no AudioPlayer:', err);
      this.current = null;
      void this.playNext();
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      void this.handleDisconnect();
    });

    this.armIdleTimer();
  }

  async say(req: SynthRequest): Promise<void> {
    if (this.destroyed) return;
    // Enfileira SINCRONAMENTE por ordem de chegada (preserva FIFO da spec §7).
    // A sintese acontece no worker (playNext), nao aqui, para nao reordenar
    // pedidos concorrentes pela duracao/cache-hit da sintese.
    const ok = this.queue.enqueue({ req });
    if (!ok) {
      log.warn('[player] fila cheia, pedido descartado');
      return;
    }
    if (!this.playing) {
      void this.playNext();
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

  private async playNext(): Promise<void> {
    if (this.destroyed) return;
    const next = this.queue.dequeue();
    if (!next) {
      this.playing = false;
      this.armIdleTimer();
      return;
    }
    this.clearIdleTimer();
    // IMPORTANTE: marcar `playing` ANTES do await da sintese. Isto impede que um
    // `say()` concorrente (que ve `!this.playing`) arranque um segundo worker de
    // drain durante a sintese, o que quebraria a ordem FIFO.
    this.playing = true;

    let audioPath: string;
    try {
      audioPath = await this.engine.synth(next.req);
    } catch (err) {
      log.error('[player] erro na sintese, item saltado:', err);
      metrics.inc('synthErrors');
      // Salta este item e continua a fila sem crashar (sem crescimento de stack:
      // estamos depois do await).
      void this.playNext();
      return;
    }

    // A sintese pode ter demorado; o player pode ter sido destruido entretanto.
    if (this.destroyed) return;

    const resource = createAudioResource(audioPath, {
      inputType: StreamType.Arbitrary,
    });
    this.current = resource;
    // messagesSpoken: incrementa quando o áudio começa efectivamente a tocar
    // (após síntese com sucesso e sem destroy entretanto).
    metrics.inc('messagesSpoken');
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
    // Semantica das metricas de voz (P7.4):
    //  - voiceDrops: conta a QUEDA uma vez por episodio. O guard acima
    //    (destroyed || reconnecting) impede que eventos Disconnected repetidos
    //    durante o mesmo episodio de reconexao re-entrem e contem a dobrar.
    //  - voiceReconnects: conta o SUCESSO uma vez, quando a ligacao confirma
    //    estar de volta a Ready — seja pela recuperacao "soft" (entersState Ready
    //    resolve) seja por rejoin manual bem-sucedido (tryRejoin devolve true).
    //    Como tryRejoin devolve um unico booleano (resultado do loop de backoff),
    //    o sucesso conta no RESULTADO, nunca por tentativa — um ciclo de backoff
    //    nunca conta a dobrar. Episodio que falha de vez: drops +1, reconnects +0.
    metrics.inc('voiceDrops');
    try {
      // Reconexao "soft": o gateway esta a renegociar a sessao de voz.
      await Promise.race([
        entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Recuperou — esperar que volte a Ready.
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
      metrics.inc('voiceReconnects');
    } catch {
      // Nao recuperou via soft — tentar rejoin manual algumas vezes.
      const recovered = await this.tryRejoin(3);
      if (!recovered) {
        this.destroy();
        this.onIdle();
        return;
      }
      // Rejoin manual recuperou a ligacao (voltou a Ready) — conta UM sucesso.
      metrics.inc('voiceReconnects');
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
