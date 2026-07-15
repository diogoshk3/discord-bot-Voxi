// src/voice/recorder.ts
//
// Gravação da PRÓPRIA voz para o clone (/voice clone record). CONSENT-FIRST por
// construção: subscrevemos APENAS o áudio do invocador (receiver.subscribe(userId)),
// nunca o canal inteiro; o bot vive ensurdecido (selfDeaf) e só o chamador o
// "destapa" durante a janela explícita de gravação, voltando a ensurdecer no fim.

import { EndBehaviorType, type VoiceConnection } from '@discordjs/voice';
import prism from 'prism-media';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Readable, Duplex } from 'node:stream';
import ffmpegStatic from 'ffmpeg-static';
import { rmDirSafe } from '../tts/cleanupDir';

/** PCM s16le 48kHz estéreo => 192 bytes por milissegundo. */
const BYTES_PER_MS = (48000 * 2 * 2) / 1000;

/**
 * Acumula só os frames COM VOZ (RMS acima do chão de ruído) até atingir o alvo de
 * milissegundos falados. Pausas/respiração não contam — assim "15s de amostra" são
 * 15s de FALA, não de silêncio. PURA (alimentada com buffers), logo testável.
 */
/** Chão de ruído (RMS int16) acima do qual um frame conta como FALA. ~350 ≈ −39 dBFS.
 * NOTA: era 500 (~−36 dBFS); baixado como HIPÓTESE para a amostra de clone sair curta —
 * fala normal (vogais fortes) passava, mas caudas de frase / consoantes suaves / mic com
 * ganho baixo ficavam abaixo e não contavam. A prova está nos diagnósticos por-gravação
 * (framesSeen vs framesVoiced + distribuição de RMS) que o recorder devolve. */
const DEFAULT_RMS_THRESHOLD = 350;

export class VoicedCollector {
  private chunks: Buffer[] = [];
  private voicedBytes = 0;
  /** Diagnóstico: total de frames vistos e a distribuição de RMS (para confirmar se é o
   *  gate a comer o áudio vs o utilizador simplesmente falar pouco). */
  framesSeen = 0;
  framesVoiced = 0;
  private readonly rmsSamples: number[] = [];

  constructor(
    private readonly targetVoicedMs: number,
    private readonly rmsThreshold: number = DEFAULT_RMS_THRESHOLD,
  ) {}

  /** Alimenta um frame PCM; devolve true quando o alvo foi atingido. */
  push(buf: Buffer): boolean {
    this.framesSeen++;
    const rms = this.rmsOf(buf);
    this.rmsSamples.push(rms);
    if (rms >= this.rmsThreshold) {
      this.chunks.push(buf);
      this.voicedBytes += buf.length;
      this.framesVoiced++;
    }
    return this.done;
  }

  get done(): boolean {
    return this.voicedBytes >= this.targetVoicedMs * BYTES_PER_MS;
  }

  get voicedMs(): number {
    return Math.round(this.voicedBytes / BYTES_PER_MS);
  }

  pcm(): Buffer {
    return Buffer.concat(this.chunks);
  }

  /** min/mediana/max do RMS dos frames vistos (0s se não viu nenhum). */
  rmsStats(): { min: number; median: number; max: number } {
    if (this.rmsSamples.length === 0) return { min: 0, median: 0, max: 0 };
    const sorted = [...this.rmsSamples].sort((a, b) => a - b);
    return {
      min: Math.round(sorted[0]),
      median: Math.round(sorted[Math.floor(sorted.length / 2)]),
      max: Math.round(sorted[sorted.length - 1]),
    };
  }

  get threshold(): number {
    return this.rmsThreshold;
  }

  private rmsOf(buf: Buffer): number {
    const n = Math.floor(buf.length / 2);
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const s = buf.readInt16LE(i * 2);
      sum += s * s;
    }
    return Math.sqrt(sum / n);
  }
}

export interface RecordDiag {
  framesSeen: number;
  framesVoiced: number;
  rmsMin: number;
  rmsMedian: number;
  rmsMax: number;
  rounds: number;
  threshold: number;
}

export interface RecordResult {
  pcm: Buffer;
  voicedMs: number;
  /** Diagnóstico da gravação — quem chama regista-o para confirmar a causa de amostras curtas. */
  diag: RecordDiag;
}

/** Dependências injetáveis (testes): como subscrever o SSRC e como construir o descodificador. */
export interface RecordDeps {
  subscribe?: (connection: VoiceConnection, userId: string) => Readable;
  makeDecoder?: () => Duplex;
}

function defaultSubscribe(connection: VoiceConnection, userId: string): Readable {
  return connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 800 },
  });
}

function defaultMakeDecoder(): Duplex {
  return new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }) as unknown as Duplex;
}

/**
 * Grava a voz de UM utilizador a partir da ligação de voz: subscreve o SSRC dele
 * (e só dele), descodifica opus->PCM 48k estéreo e acumula até `targetVoicedMs` de
 * fala ou `maxWallMs` de relógio. O Discord fecha o stream em cada pausa (DTX), por
 * isso RE-subscrevemos em loop até o alvo/tempo acabar. Nunca lança por silêncio —
 * devolve o que apanhou (o chamador decide se chega).
 */
export async function recordUserSample(
  connection: VoiceConnection,
  userId: string,
  opts: {
    targetVoicedMs?: number;
    maxWallMs?: number;
    shouldStop?: () => boolean;
    /** Guarda-tempo de ronda-sem-áudio-nenhum (testável; produção usa o default 5s). */
    roundSilenceMs?: number;
    /** Notificado com os ms de FALA acumulados a cada frame vozeado (feedback ao vivo). */
    onProgress?: (voicedMs: number) => void;
  } = {},
  deps: RecordDeps = {},
): Promise<RecordResult> {
  const targetVoicedMs = opts.targetVoicedMs ?? 15_000;
  const maxWallMs = opts.maxWallMs ?? 45_000;
  const shouldStop = opts.shouldStop ?? (() => false);
  const roundSilenceMs = opts.roundSilenceMs ?? 5_000;
  const onProgress = opts.onProgress ?? ((): void => {});
  const subscribe = deps.subscribe ?? defaultSubscribe;
  const makeDecoder = deps.makeDecoder ?? defaultMakeDecoder;
  const collector = new VoicedCollector(targetVoicedMs);
  const deadline = Date.now() + maxWallMs;
  let rounds = 0;

  while (!collector.done && Date.now() < deadline && !shouldStop()) {
    rounds++;
    const gotAudio = await new Promise<boolean>((resolve) => {
      let received = false;
      const opus = subscribe(connection, userId);
      const decoder = makeDecoder();
      // CRÍTICO: `stream.pipe()` NÃO propaga destroy() da fonte para o destino — é
      // Readable→Writable de baixo nível, sem a limpeza do stream.pipeline(). Se só
      // destruíssemos `opus`, o `decoder` nunca emitia 'end'/'close' e a Promise da
      // ronda ficava PENDENTE PARA SEMPRE (bug real: era por isto que nem o botão
      // "Parar" nem o guarda-tempo de silêncio funcionavam — a gravação simplesmente
      // não parava). Por isso destruímos SEMPRE os dois em conjunto.
      const stopBoth = (): void => {
        opus.destroy();
        decoder.destroy();
      };
      // Guarda-tempo da RONDA: se o user não falar de todo, o AfterSilence nunca arma
      // (só conta após o 1.º pacote nalgumas versões) — corta a ronda ao fim de
      // `roundSilenceMs`. Também faz poll do shouldStop (botão "Parar") para fechar a
      // ronda em curso ~200ms depois.
      const roundTimer = setTimeout(stopBoth, roundSilenceMs);
      const stopPoll = setInterval(() => {
        if (shouldStop()) stopBoth();
      }, 200);
      opus.pipe(decoder);
      decoder.on('data', (chunk: Buffer) => {
        received = true;
        const done = collector.push(chunk);
        onProgress(collector.voicedMs); // feedback ao vivo (o chamador faz throttle)
        if (done) stopBoth(); // alvo atingido -> fecha já
      });
      const finish = (): void => {
        clearTimeout(roundTimer);
        clearInterval(stopPoll);
        decoder.removeAllListeners();
        // Destruir SEMPRE a fonte: um erro do lado do decoder chega aqui sem passar pelo
        // stopBoth, e sem isto a subscription do receiver (opus) ficava viva (leak).
        // Idempotente — quando `finish` vem de stopBoth, o opus já está destruído.
        opus.destroy();
        resolve(received);
      };
      decoder.once('end', finish);
      decoder.once('close', finish);
      decoder.once('error', finish);
      opus.once('error', stopBoth);
    });
    // Ronda sem um único frame (user calado): espera um nadinha antes de re-subscrever
    // para não fazer busy-loop de subscribe/destroy.
    if (!gotAudio && !collector.done && !shouldStop()) await new Promise((r) => setTimeout(r, 400));
  }

  const rms = collector.rmsStats();
  return {
    pcm: collector.pcm(),
    voicedMs: collector.voicedMs,
    diag: {
      framesSeen: collector.framesSeen,
      framesVoiced: collector.framesVoiced,
      rmsMin: rms.min,
      rmsMedian: rms.median,
      rmsMax: rms.max,
      rounds,
      threshold: collector.threshold,
    },
  };
}

const FF_TIMEOUT_MS = 20_000;

export interface PcmToWavDeps {
  ffmpegPath?: string | null;
  spawnImpl?: typeof spawn;
}

/**
 * Converte o PCM cru (s16le 48k estéreo) num WAV 24kHz mono — o formato de referência
 * do motor de cloning — e grava-o em `outPath` (cria o diretório). Mesmo padrão de
 * runner ffmpeg do resto do pipeline: temp dir, timeout+kill, cleanup best-effort.
 */
export function pcmToWavFile(
  pcm: Buffer,
  outPath: string,
  deps: PcmToWavDeps = {},
): Promise<string> {
  const ff = (deps.ffmpegPath ?? (ffmpegStatic as unknown as string | null)) as string | null;
  const spawnImpl = deps.spawnImpl ?? spawn;
  if (!ff) return Promise.reject(new Error('recorder: ffmpeg-static not found'));

  const workDir = mkdtempSync(join(tmpdir(), 'vozen-rec-'));
  const rawPath = join(workDir, 'in.raw');
  const wavPath = join(workDir, 'out.wav');
  try {
    writeFileSync(rawPath, pcm);
  } catch (err) {
    rmDirSafe(workDir);
    throw err;
  }
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    's16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-i',
    rawPath,
    '-ar',
    '24000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    wavPath,
    '-y',
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawnImpl(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // já morto
      }
      reject(new Error(`recorder: ffmpeg excedeu ${FF_TIMEOUT_MS}ms`));
      rmDirSafe(workDir);
    }, FF_TIMEOUT_MS);
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`recorder: falha ao iniciar ffmpeg: ${err.message}`));
      rmDirSafe(workDir);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`recorder: ffmpeg saiu com ${code}: ${stderr.trim()}`));
        rmDirSafe(workDir);
        return;
      }
      try {
        mkdirSync(dirname(outPath), { recursive: true });
        copyFileSync(wavPath, outPath);
        resolve(outPath);
      } catch (err) {
        reject(err as Error);
      } finally {
        rmDirSafe(workDir);
      }
    });
  });
}
