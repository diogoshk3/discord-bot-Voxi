// src/voice/whisperTranscriber.ts
//
// Cliente do SIDECAR de STT (tools/whisper_sidecar.py) — processo Python PERSISTENTE que
// carrega o modelo faster-whisper UMA vez e transcreve N pedidos. Gestão de processo
// espelhada do KokoroEngine, com dois desvios do protocolo do Kokoro:
//   (1) o sidecar imprime {"ready":true} SOZINHO ao arrancar (não há mensagem de warmup a
//       enviar — ele carrega o modelo e anuncia);
//   (2) 1 pedido = 1 LINHA com o caminho de um WAV; resposta = {"text","lang"} ou {"error"}.
// É SÉRIE (uma linha de cada vez no stdin) => dá de graça o "cap de 1 transcrição
// concorrente" que o spike pediu para não saturar o CPU partilhado com o Piper.
//
// Falhar é seguro: sem sidecar instalado `available=false` e o STT fica inerte (o comando
// /transcribe responde "indisponível"). Um pedido preso mata e reinicia o sidecar.

import { spawn, type ChildProcess } from 'node:child_process';
import { log } from '../logging/logger';

/** Teto por transcrição (o spike deu ~2.2s p/ 13.6s de fala; teto generoso mas finito). */
const TRANSCRIBE_TIMEOUT_MS = 30_000;
/** Teto à espera do {ready} (load do modelo `base` ~1-2s em CPU; 1.ª vez descarrega ~140MB). */
const READY_TIMEOUT_MS = 120_000;

export interface Transcript {
  text: string;
  lang: string;
}

interface Job {
  path: string;
  resolve: (t: Transcript) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class WhisperTranscriber {
  private child: ChildProcess | null = null;
  private readonly queue: Job[] = [];
  private active: Job | null = null;
  private buffer = '';
  private ready = false;
  private starting = false;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly cmd: { exe: string; args: string[] } | null,
    // Injeção do spawn para testes (default: child_process.spawn real).
    private readonly spawnImpl: typeof spawn = spawn,
    private readonly readyTimeoutMs: number = READY_TIMEOUT_MS,
  ) {}

  /** Há sidecar Whisper instalado nesta instância? */
  get available(): boolean {
    return this.cmd !== null;
  }

  /** Arranca o sidecar já (carrega o modelo antes do 1.º pedido). */
  prewarm(): void {
    if (this.cmd) this.ensureChild();
  }

  /** Transcreve um ficheiro WAV. Rejeita se o sidecar não existir, der erro ou expirar. */
  transcribe(wavPath: string): Promise<Transcript> {
    return new Promise<Transcript>((resolve, reject) => {
      if (!this.cmd) {
        reject(new Error('whisper: sidecar indisponível'));
        return;
      }
      this.queue.push({ path: wavPath, resolve, reject });
      this.pump();
    });
  }

  /** Mata o sidecar e rejeita o que estiver pendente (chamar ao parar a transcrição). */
  dispose(): void {
    this.restart();
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    if (!this.ensureChild()) {
      const err = new Error('whisper: sidecar indisponível');
      for (const j of this.queue.splice(0)) j.reject(err);
      return;
    }
    if (!this.ready) return; // à espera do {ready}; onLine chama pump() quando ficar pronto
    const job = this.queue.shift()!;
    this.active = job;
    job.timer = setTimeout(() => {
      if (this.active !== job) return;
      this.active = null;
      job.reject(new Error(`whisper: timeout ${TRANSCRIBE_TIMEOUT_MS}ms`));
      this.restart(); // um pedido preso mata o sidecar -> reinicia limpo
    }, TRANSCRIBE_TIMEOUT_MS);
    try {
      this.child!.stdin!.write(job.path + '\n');
    } catch (e) {
      if (job.timer) clearTimeout(job.timer);
      this.active = null;
      job.reject(e as Error);
      this.restart();
    }
  }

  private ensureChild(): boolean {
    if (this.child || this.starting) return true;
    if (!this.cmd) return false;
    try {
      this.starting = true;
      const child = this.spawnImpl(this.cmd.exe, this.cmd.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      child.stdout!.on('data', (c: Buffer) => this.onData(c));
      child.stderr!.on('data', (c: Buffer) => log.info(`[whisper-py] ${c.toString().trim()}`));
      child.on('exit', (code) => {
        if (this.child !== child) return; // evento de um child JÁ substituído — ignora
        log.warn(`[whisper] sidecar saiu (code ${code})`);
        this.teardown();
      });
      child.on('error', (err) => {
        if (this.child !== child) return; // evento de um child JÁ substituído — ignora
        log.warn('[whisper] falha no sidecar:', err);
        this.teardown();
      });
      this.readyTimer = setTimeout(() => {
        this.readyTimer = null;
        if (this.ready) return; // corrida benigna
        log.warn(`[whisper] sidecar não ficou pronto em ${this.readyTimeoutMs}ms — a reiniciar`);
        this.restart();
      }, this.readyTimeoutMs);
      this.readyTimer.unref?.();
      return true;
    } catch (err) {
      log.warn('[whisper] não consegui arrancar o sidecar:', err);
      this.starting = false;
      this.child = null;
      return false;
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    let msg: { ready?: boolean; text?: string; lang?: string; error?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // linha não-protocolo (log solto) — ignora
    }
    if (msg.ready) {
      if (this.readyTimer) {
        clearTimeout(this.readyTimer);
        this.readyTimer = null;
      }
      this.ready = true;
      this.starting = false;
      log.info('[whisper] sidecar pronto');
      this.pump();
      return;
    }
    const job = this.active;
    if (!job) return;
    this.active = null;
    if (job.timer) clearTimeout(job.timer);
    if (msg.error !== undefined) job.reject(new Error(`whisper: ${msg.error}`));
    else job.resolve({ text: msg.text ?? '', lang: msg.lang ?? '' });
    this.pump();
  }

  private teardown(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    const err = new Error('whisper: sidecar morreu');
    this.ready = false;
    this.starting = false;
    this.child = null;
    // Descarta bytes parciais do processo morto: senão colam-se à 1.ª linha do sidecar
    // respawnado e partem o JSON.parse (pior caso: corrompem o {ready}).
    this.buffer = '';
    if (this.active) {
      if (this.active.timer) clearTimeout(this.active.timer);
      this.active.reject(err);
      this.active = null;
    }
    for (const j of this.queue.splice(0)) j.reject(err);
  }

  private restart(): void {
    try {
      this.child?.kill('SIGKILL');
    } catch {
      // já morto
    }
    this.teardown();
  }
}
