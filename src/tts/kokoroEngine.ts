// src/tts/kokoroEngine.ts
//
// Motor TTS KOKORO (kokoro-onnx, ONNX/CPU) via um sidecar Python persistente
// (tools/kokoro_server.py). É um motor-FOLHA: quando falha (sidecar em baixo,
// timeout, língua não mapeada) LANÇA — de propósito, para o RouterEngine que o
// envolve cair no gTTS. NÃO faz fallback interno (ao contrário do CloneEngine, que
// embrulha a voz normal). Gestão de processo espelhada do cloneEngine, mas SÉRIE
// (o sidecar lê o stdin uma linha de cada vez), sem serialização de GPU.
//
// Cache própria (namespace 'kokoro'): a mesma frase/voz é reutilizada; a LRU limpa.

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { AudioCache, cacheKey } from './cache';
import { lowerAllCapsRuns } from './deCaps';
import type { SynthRequest, TTSEngine } from './engine';
import { parseCommand } from './cloneEngine';
import { langKeyOfModel } from '../language/spokenPhrases';
import { log } from '../logging/logger';

/** Tempo máximo por síntese (a inferência é ~1s; teto generoso mas finito). */
const SYNTH_TIMEOUT_MS = 30_000;
/** Tempo máximo à espera do {ready} do warmup (load do modelo ~1s em CPU). */
const READY_TIMEOUT_MS = 30_000;

/**
 * Mapa língua -> (código de lang do Kokoro, voz). As CHAVES são o que
 * `langKeyOfModel` devolve (o prefixo antes do '_': en, pt, es, ...). Só as
 * línguas VALIDADAS no spike da Fase 0 entram aqui; o Mandarim ('zh') precisa de
 * `misaki[zh]` (o backend espeak não o faz) e fica de fora por agora. Uma língua
 * ausente daqui => synth LANÇA => o router cai no gTTS.
 */
export const KOKORO_VOICES: Record<string, { lang: string; voice: string }> = {
  en: { lang: 'en-us', voice: 'af_heart' },
  es: { lang: 'es', voice: 'ef_dora' },
  fr: { lang: 'fr-fr', voice: 'ff_siwis' },
  hi: { lang: 'hi', voice: 'hf_alpha' },
  it: { lang: 'it', voice: 'if_sara' },
  pt: { lang: 'pt-br', voice: 'pf_dora' },
  ja: { lang: 'ja', voice: 'jf_alpha' },
};

/**
 * Resolve o comando do sidecar: usa KOKORO_CMD se dado, senão AUTO-DETETA o venv +
 * o server + o modelo + as vozes em tools/. Devolve null se algo faltar (=> o motor
 * fica inerte; em createPerUserEngine o caminho 'kokoro' passa a ser o próprio gTTS).
 */
export function resolveKokoroCmd(
  explicit: string | undefined,
): { exe: string; args: string[] } | null {
  if (explicit && explicit.trim()) return parseCommand(explicit.trim());
  // O python do venv fica em Scripts/python.exe (Windows) ou bin/python (Linux/macOS) —
  // tenta os dois para o sidecar auto-detetar em qualquer plataforma (o VPS e Linux).
  const venvPy = [
    join(process.cwd(), 'tools', 'kokoro-venv', 'Scripts', 'python.exe'),
    join(process.cwd(), 'tools', 'kokoro-venv', 'bin', 'python'),
  ].find((p) => existsSync(p));
  const server = join(process.cwd(), 'tools', 'kokoro_server.py');
  const model = join(process.cwd(), 'tools', 'kokoro-v1.0.onnx');
  const voices = join(process.cwd(), 'tools', 'voices-v1.0.bin');
  if (venvPy && existsSync(server) && existsSync(model) && existsSync(voices)) {
    return { exe: venvPy, args: [server] };
  }
  return null;
}

interface Job {
  line: string;
  outPath: string;
  resolve: (p: string) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class KokoroEngine implements TTSEngine {
  private child: ChildProcess | null = null;
  private readonly queue: Job[] = [];
  private active: Job | null = null;
  private buffer = '';
  private ready = false;
  private starting = false;
  private tmpSeq = 0;
  private warmupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly cache: AudioCache,
    private readonly cmd: { exe: string; args: string[] } | null,
    // Injeção do spawn para testes (default: child_process.spawn real).
    private readonly spawnImpl: typeof spawn = spawn,
    // Deadline do warmup injetável para testes.
    private readonly readyTimeoutMs: number = READY_TIMEOUT_MS,
  ) {}

  /** Há sidecar Kokoro instalado nesta instância? */
  get available(): boolean {
    return this.cmd !== null;
  }

  /** Arranca o sidecar e carrega o modelo já (evita pagar o cold-load na 1.ª msg). */
  prewarm(): void {
    if (this.cmd) this.ensureChild();
  }

  async synth(req: SynthRequest): Promise<string> {
    if (!this.cmd) throw new Error('kokoro: sidecar indisponível');
    const m = KOKORO_VOICES[langKeyOfModel(req.model)];
    if (!m) throw new Error(`kokoro: língua não suportada (${langKeyOfModel(req.model)})`);

    const key = cacheKey(req);
    const hit = this.cache.get(key);
    if (hit) return hit;

    let tmp: string | null = null;
    try {
      // lowerAllCapsRuns: sem isto, um "grito" em MAIÚSCULAS podia sair SOLETRADO no
      // G2P do Kokoro (ver deCaps.ts). A chave de cache usa o req ORIGINAL (acima).
      tmp = await this.enqueue(lowerAllCapsRuns(req.text), m.lang, m.voice, req.speed);
      return this.cache.put(key, tmp);
    } finally {
      if (tmp) {
        try {
          rmSync(tmp, { force: true });
        } catch {
          // best-effort
        }
      }
    }
  }

  private enqueue(text: string, lang: string, voice: string, speed: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const outPath = join(tmpdir(), `vozen-kokoro-${process.pid}-${this.tmpSeq++}.wav`);
      const line = JSON.stringify({ text, out: outPath, lang, voice, speed }) + '\n';
      this.queue.push({ line, outPath, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    if (!this.ensureChild()) {
      const err = new Error('kokoro: sidecar indisponível');
      for (const j of this.queue.splice(0)) j.reject(err);
      return;
    }
    if (!this.ready) return; // à espera do warmup; onLine chama pump() quando ready
    const job = this.queue.shift()!;
    this.active = job;
    job.timer = setTimeout(() => {
      if (this.active !== job) return;
      this.active = null;
      job.reject(new Error(`kokoro: timeout ${SYNTH_TIMEOUT_MS}ms`));
      this.restart(); // um pedido preso mata o sidecar -> reinicia limpo
    }, SYNTH_TIMEOUT_MS);
    try {
      this.child!.stdin!.write(job.line);
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
      child.stderr!.on('data', (c: Buffer) => log.info(`[kokoro-py] ${c.toString().trim()}`));
      child.on('exit', (code) => {
        if (this.child !== child) return; // evento de um child JÁ substituído — ignora
        log.warn(`[kokoro] sidecar saiu (code ${code})`);
        this.teardown();
      });
      child.on('error', (err) => {
        if (this.child !== child) return; // evento de um child JÁ substituído — ignora
        log.warn('[kokoro] falha no sidecar:', err);
        this.teardown();
      });
      child.stdin!.write(JSON.stringify({ warmup: true }) + '\n');
      this.warmupTimer = setTimeout(() => {
        this.warmupTimer = null;
        if (this.ready) return; // corrida benigna: ficou pronto entretanto
        log.warn(`[kokoro] sidecar não ficou pronto em ${this.readyTimeoutMs}ms — a reiniciar`);
        this.restart();
      }, this.readyTimeoutMs);
      this.warmupTimer.unref?.();
      return true;
    } catch (err) {
      log.warn('[kokoro] não consegui arrancar o sidecar:', err);
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
    let msg: { ok?: boolean; ready?: boolean; out?: string; error?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // linha não-protocolo (log solto) — ignora
    }
    if (msg.ready) {
      if (this.warmupTimer) {
        clearTimeout(this.warmupTimer);
        this.warmupTimer = null;
      }
      this.ready = true;
      this.starting = false;
      log.info('[kokoro] sidecar pronto');
      this.pump();
      return;
    }
    const job = this.active;
    if (!job) return;
    this.active = null;
    if (job.timer) clearTimeout(job.timer);
    if (msg.ok && msg.out) job.resolve(msg.out);
    else job.reject(new Error(msg.error || 'kokoro: erro desconhecido'));
    this.pump();
  }

  private teardown(): void {
    if (this.warmupTimer) {
      clearTimeout(this.warmupTimer);
      this.warmupTimer = null;
    }
    const err = new Error('kokoro: sidecar morreu');
    this.ready = false;
    this.starting = false;
    this.child = null;
    // Descarta bytes parciais do processo morto: senão colam-se à 1.ª linha do
    // sidecar respawnado e partem o JSON.parse (pior caso: corrompem o `ready`).
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
