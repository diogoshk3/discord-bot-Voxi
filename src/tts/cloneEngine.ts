// src/tts/cloneEngine.ts
//
// Motor de CLONE DE VOZ: envolve o motor normal por FORA (como o EffectEngine) e, quando
// o utilizador tem clone LIGADO (req.cloneRef presente), sintetiza a fala na voz clonada
// via um sidecar Python persistente (tools/clone_server.py — Chatterbox, GPU). QUALQUER
// falha (sidecar em baixo, timeout, erro do modelo) cai na voz NORMAL — nunca silêncio.
//
// Cache própria (namespace 'clone', keyed por cacheKey+refBasename): a mesma frase na
// mesma voz clonada é reutilizada; a LRU limpa. O sidecar corre 1 pedido de cada vez
// (GPU): serializamos com uma fila FIFO interna.

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { AudioCache, cacheKey } from './cache';
import type { SynthRequest, TTSEngine } from './engine';
import { langKeyOfModel } from '../language/spokenPhrases';
import { log } from '../logging/logger';

/** Tempo máximo por síntese clonada (o 1.º pedido carrega o modelo — daí generoso). */
const SYNTH_TIMEOUT_MS = 60_000;

interface Job {
  line: string;
  outPath: string;
  resolve: (p: string) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Divide um comando "python.exe script.py --flag" em [exe, ...args] respeitando aspas
 * do path (Windows: "C:\Program Files\..."). PURA.
 */
export function parseCommand(cmd: string): { exe: string; args: string[] } {
  const parts = cmd.match(/"[^"]+"|\S+/g) ?? [];
  const clean = parts.map((p) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p));
  return { exe: clean[0] ?? '', args: clean.slice(1) };
}

/**
 * Resolve o comando do sidecar: usa CLONE_CMD se dado, senão AUTO-DETETA o venv em
 * tools/clone-venv (criado por setup-clone). Devolve null se nada estiver instalado
 * (=> o motor de clone fica inerte e serve sempre a voz normal).
 */
export function resolveCloneCmd(explicit: string | undefined): { exe: string; args: string[] } | null {
  if (explicit && explicit.trim()) return parseCommand(explicit.trim());
  const venvPy = join(process.cwd(), 'tools', 'clone-venv', 'Scripts', 'python.exe');
  const server = join(process.cwd(), 'tools', 'clone_server.py');
  if (existsSync(venvPy) && existsSync(server)) return { exe: venvPy, args: [server] };
  return null;
}

export class CloneEngine implements TTSEngine {
  private child: ChildProcess | null = null;
  private readonly queue: Job[] = [];
  private active: Job | null = null;
  private buffer = '';
  private ready = false;
  private starting = false;
  private tmpSeq = 0;

  constructor(
    private readonly inner: TTSEngine,
    private readonly cache: AudioCache,
    private readonly cmd: { exe: string; args: string[] } | null,
    // Injeção do spawn para testes (default: child_process.spawn real).
    private readonly spawnImpl: typeof spawn = spawn,
  ) {}

  /** Há motor de clone instalado nesta instância? */
  get available(): boolean {
    return this.cmd !== null;
  }

  async synth(req: SynthRequest): Promise<string> {
    // Sem clone pedido, ou sem motor -> voz normal (o caminho de sempre).
    if (!req.cloneRef || !this.cmd) return this.inner.synth(req);

    // cacheKey já inclui o cloneRef (basename versionado) — re-gravar dá chave nova.
    const key = cacheKey(req);
    const hit = this.cache.get(key);
    if (hit) return hit;

    let tmp: string | null = null;
    try {
      const lang = langCode(req.model);
      tmp = await this.enqueue(req.text, req.cloneRef, lang);
      return this.cache.put(key, tmp); // copia para a cache (chave estável)
    } catch (err) {
      log.warn('[clone] síntese clonada falhou, a servir voz normal:', err);
      return this.inner.synth(req); // NUNCA silêncio
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

  private enqueue(text: string, ref: string, lang: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // O sidecar escreve o WAV neste temp; o cache.put copia-o e depois apagamo-lo.
      const outPath = join(tmpdir(), `voxi-clone-${process.pid}-${this.tmpSeq++}.wav`);
      const line = JSON.stringify({ text, ref, out: outPath, lang }) + '\n';
      this.queue.push({ line, outPath, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    if (!this.ensureChild()) {
      const err = new Error('clone: sidecar indisponível');
      for (const j of this.queue.splice(0)) j.reject(err);
      return;
    }
    if (!this.ready) return; // à espera do warmup; onLine chama pump() quando ready
    const job = this.queue.shift()!;
    this.active = job;
    job.timer = setTimeout(() => {
      if (this.active !== job) return;
      this.active = null;
      job.reject(new Error(`clone: timeout ${SYNTH_TIMEOUT_MS}ms`));
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
      const child = this.spawnImpl(this.cmd.exe, this.cmd.args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      child.stdout!.on('data', (c: Buffer) => this.onData(c));
      child.stderr!.on('data', (c: Buffer) => log.info(`[clone-py] ${c.toString().trim()}`));
      child.on('exit', (code) => {
        log.warn(`[clone] sidecar saiu (code ${code})`);
        this.teardown();
      });
      child.on('error', (err) => {
        log.warn('[clone] falha no sidecar:', err);
        this.teardown();
      });
      // Warmup: carrega o modelo já; o onLine liga this.ready e faz pump().
      child.stdin!.write(JSON.stringify({ warmup: true }) + '\n');
      return true;
    } catch (err) {
      log.warn('[clone] não consegui arrancar o sidecar:', err);
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
      this.ready = true;
      this.starting = false;
      log.info('[clone] sidecar pronto');
      this.pump();
      return;
    }
    const job = this.active;
    if (!job) return;
    this.active = null;
    if (job.timer) clearTimeout(job.timer);
    if (msg.ok && msg.out) job.resolve(msg.out);
    else job.reject(new Error(msg.error || 'clone: erro desconhecido'));
    this.pump();
  }

  private teardown(): void {
    const err = new Error('clone: sidecar morreu');
    this.ready = false;
    this.starting = false;
    this.child = null;
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

/** Código de língua ('pt','en',...) a partir do id do modelo, para o sidecar multilíngue. */
function langCode(model: string): string {
  return langKeyOfModel(model).slice(0, 2).toLowerCase() || 'en';
}
