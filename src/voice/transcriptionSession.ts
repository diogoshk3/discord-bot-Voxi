// src/voice/transcriptionSession.ts
//
// Orquestra a TRANSCRIÇÃO ao vivo de um canal de voz (Fase 4). Para cada locutor que
// começa a falar: (1) GATE consent-first — só quem consentiu neste servidor é captado;
// (2) capta a utterance (silêncio de 800ms fecha-a); (3) WAV -> sidecar Whisper -> texto;
// (4) posta "**Nome:** texto" no canal (se não for ruído vazio). A CAPTURA em si (plumbing
// Opus do receiver) fica num helper à parte (`makeReceiverCapture`) — cola de integração
// espelhada do recorder — para a ORQUESTRAÇÃO acima ser pura e testável com fakes.
//
// Serialização de transcrição = a do próprio WhisperTranscriber (cap=1); aqui só evitamos
// captar o MESMO locutor duas vezes em simultâneo.

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import type { Readable, Duplex } from 'node:stream';
import { EndBehaviorType, type VoiceConnection } from '@discordjs/voice';
import prism from 'prism-media';
import { UtteranceCollector, type UtteranceOpts } from './utteranceCollector';
import { isTranscribable, formatTranscript } from './transcriptRouting';
import type { Transcript } from './whisperTranscriber';
import { log } from '../logging/logger';

/** Capta UMA vez de fala de um locutor; chama `onUtterance` por cada utterance fechada. */
export type CaptureFn = (
  userId: string,
  onUtterance: (pcm: Buffer) => void,
  isStopped: () => boolean,
) => Promise<void>;

export interface TranscriptionSessionDeps {
  /** GATE: a pessoa consentiu ser transcrita neste servidor? (hasSttConsent ligado à guild) */
  hasConsent: (userId: string) => boolean;
  /** Nome a mostrar no canal para um locutor. */
  displayName: (userId: string) => string;
  /** Transcreve um WAV (WhisperTranscriber.transcribe). */
  transcribe: (wavPath: string) => Promise<Transcript>;
  /** Posta a linha no canal (deve usar allowedMentions:{parse:[]}). */
  post: (text: string) => Promise<void>;
  /** PCM cru -> ficheiro WAV (pcmToWavFile). */
  toWav: (pcm: Buffer, outPath: string) => Promise<string>;
  /** Capta a fala de um locutor (default: makeReceiverCapture; testes injetam um fake). */
  capture: CaptureFn;
  /** Dir temp para os WAV efémeros (default: os.tmpdir()). */
  tmpDir?: string;
}

export class TranscriptionSession {
  private stopped = false;
  private readonly active = new Set<string>();
  private seq = 0;
  // Componente aleatório por-instância: sem isto, duas sessões concorrentes (guildas
  // diferentes) geravam o MESMO nome de ficheiro temporário (só o pid+seq variavam, e o
  // seq de cada instância recomeça em 0) e podiam pisar-se a escrever o WAV uma da outra.
  private readonly id = Math.random().toString(36).slice(2, 8);

  constructor(private readonly deps: TranscriptionSessionDeps) {}

  /** Reage a um locutor que começou a falar. Aplica o gate e capta+transcreve o turno. */
  async onSpeakingStart(userId: string): Promise<void> {
    if (this.stopped) return;
    if (!this.deps.hasConsent(userId)) return; // consent-first: não-consentido nunca é captado
    if (this.active.has(userId)) return; // já a captar este locutor
    this.active.add(userId);
    const pending: Promise<void>[] = [];
    try {
      await this.deps.capture(
        userId,
        (pcm) => pending.push(this.handleUtterance(userId, pcm)),
        () => this.stopped,
      );
      await Promise.allSettled(pending);
    } catch (err) {
      log.warn(`[stt] capture failed (user ${userId}):`, err);
    } finally {
      this.active.delete(userId);
    }
  }

  /** Marca a sessão como parada: novos speaking-start passam a ser ignorados. */
  stop(): void {
    this.stopped = true;
  }

  private async handleUtterance(userId: string, pcm: Buffer): Promise<void> {
    if (this.stopped) return;
    const out = join(
      this.deps.tmpDir ?? tmpdir(),
      `vozen-stt-${process.pid}-${this.id}-${this.seq++}.wav`,
    );
    try {
      const wav = await this.deps.toWav(pcm, out);
      const { text } = await this.deps.transcribe(wav);
      if (!this.stopped && isTranscribable(text)) {
        await this.deps.post(formatTranscript(this.deps.displayName(userId), text));
      }
    } catch (err) {
      log.warn(`[stt] transcription failed (user ${userId}):`, err);
    } finally {
      try {
        rmSync(out, { force: true });
      } catch {
        // best-effort
      }
    }
  }
}

/** Nome dos WAV temporários de STT: prefixo próprio do bot -> seguro varrer por padrão. */
const STT_TMP_RE = /^vozen-stt-[\w-]+\.wav$/;
/** Idade mínima para considerar um temp órfão (um WAV vivo é apagado em ~2s). */
const STT_ORPHAN_MIN_AGE_MS = 5 * 60_000;

/**
 * Reconciliação de arranque (DATA-hygiene): apaga WAV temporários de STT que ficaram
 * ÓRFÃOS no tmpdir. handleUtterance apaga cada WAV no `finally`, mas um SIGKILL (OOM/deploy)
 * entre o `toWav` e o `finally`, ou um `rmSync` bloqueado no Windows, deixa gravação
 * consentida no disco além do "apagado imediatamente" prometido na PRIVACY §2.4 — a mesma
 * classe de falha que o sweep de clones (voiceCloneSweep) cobre e este não cobria.
 *
 * Seguro por dois motivos: (1) o prefixo `vozen-stt-` é do próprio bot; (2) o guard de
 * idade (>5 min) nunca apanha um WAV vivo, mesmo que outro processo Vozen partilhe o tmpdir.
 * Corre no ClientReady (antes de qualquer sessão STT), best-effort. Devolve o nº apagado.
 */
export function sweepOrphanSttTemps(dir: string = tmpdir(), now: number = Date.now()): number {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0; // tmpdir inacessível — no-op
  }
  let removed = 0;
  for (const f of entries) {
    if (!STT_TMP_RE.test(f)) continue;
    const p = join(dir, f);
    try {
      if (now - statSync(p).mtimeMs < STT_ORPHAN_MIN_AGE_MS) continue; // recente -> pode estar vivo
      unlinkSync(p);
      removed++;
    } catch {
      // best-effort: já removido / bloqueado
    }
  }
  return removed;
}

// ── Captura real (integração — plumbing Opus do receiver, espelhado do recorder) ──────────
export interface ReceiverCaptureDeps {
  subscribe?: (connection: VoiceConnection, userId: string) => Readable;
  makeDecoder?: () => Duplex;
  collectorOpts?: UtteranceOpts;
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
 * Constrói a CaptureFn de produção sobre uma VoiceConnection: subscreve o SSRC do locutor
 * (AfterSilence 800ms), descodifica opus->PCM 48k estéreo, agrupa em utterances com o
 * UtteranceCollector e emite cada uma. Resolve quando o Discord fecha o stream (o locutor
 * parou). O próximo speaking-start re-subscreve.
 */
export function makeReceiverCapture(
  connection: VoiceConnection,
  deps: ReceiverCaptureDeps = {},
): CaptureFn {
  const subscribe = deps.subscribe ?? defaultSubscribe;
  const makeDecoder = deps.makeDecoder ?? defaultMakeDecoder;
  return (_userId, onUtterance, isStopped) =>
    new Promise<void>((resolve) => {
      const opus = subscribe(connection, _userId);
      const decoder = makeDecoder();
      const collector = new UtteranceCollector(deps.collectorOpts);
      const stopBoth = (): void => {
        opus.destroy();
        decoder.destroy();
      };
      const poll = setInterval(() => {
        if (isStopped()) stopBoth();
      }, 200);
      opus.pipe(decoder);
      decoder.on('data', (chunk: Buffer) => {
        const u = collector.push(chunk);
        if (u) onUtterance(u.pcm);
      });
      const finish = (): void => {
        clearInterval(poll);
        const last = collector.flush();
        if (last) onUtterance(last.pcm);
        decoder.removeAllListeners();
        // Destruir SEMPRE a fonte: um erro do lado do decoder chega aqui sem passar pelo
        // stopBoth, e sem isto a subscription do receiver (opus) ficava viva (leak).
        opus.destroy();
        resolve();
      };
      decoder.once('end', finish);
      decoder.once('close', finish);
      decoder.once('error', finish);
      opus.once('error', stopBoth);
    });
}
