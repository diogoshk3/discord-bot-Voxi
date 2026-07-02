// src/tts/piperPool.ts
//
// Pool de processos piper.exe PERSISTENTES (spec T2.1) para eliminar o overhead de
// spawn+carregamento-de-modelo (~372ms medidos) por sintese. Cada sintese de hoje
// arranca um piper.exe fresco; aqui mantemos processos LONGOS reutilizados.
//
// PROTOCOLO (validado empiricamente contra o piper.exe real):
//  - `piper.exe --model M --json-input` fica vivo a ler UM objeto JSON por LINHA no
//    stdin: {"text":"...","output_file":"ABS\\PATH.wav"}.
//  - Por cada utterance concluida, o piper imprime o `output_file` terminado no
//    STDOUT, uma linha por pedido, em ordem FIFO ESTRITA. Essa linha E o sinal de
//    conclusao — lemos o stdout linha-a-linha; a N-esima linha = N-esimo pedido.
//  - O modelo carrega UMA vez ao arranque (~0.4s); utterances seguintes sao so
//    inferencia (~0.1-0.3s). E esse o ganho.
//  - Os params por-linha (length_scale/noise) sao IGNORADOS por este build — a
//    qualidade tem de vir de flags CLI no spawn. Por isso um processo quente tem
//    params FIXOS -> a chave do pool inclui model + length_scale.
import { log } from '../logging/logger';

/**
 * Interface MINIMA de um processo-filho, suficiente para (a) injetar um fake nos
 * testes e (b) aceitar um `child_process.ChildProcess` real (via cast no wrapper de
 * spawn). So expomos o que o protocolo precisa: escrever/fechar o stdin, ler o
 * stdout linha-a-linha, ouvir exit/error e matar o processo.
 */
export interface ChildLike {
  stdin: { write(s: string): void; end(): void };
  stdout: { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown };
  on(event: 'exit' | 'error', cb: (arg?: unknown) => void): unknown;
  kill(signal?: string): void;
}

/** Uma utterance em curso: o path esperado, os callbacks e o timer de timeout. */
interface Pending {
  outPath: string;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Envolve UM processo-filho piper para um par (model, args) FIXO. O construtor
 * recebe um child ja spawnado (injetavel nos testes) + um callback `onExit(self)`
 * que o pool usa para remover este processo do mapa quando morre.
 */
export class PiperProcess {
  private readonly child: ChildLike;
  private readonly onExit: (self: PiperProcess) => void;
  // Fila FIFO das utterances em curso — o piper resolve por ordem de entrada.
  private readonly queue: Pending[] = [];
  private buffer = '';
  private _dead = false;
  private exitNotified = false;

  constructor(child: ChildLike, onExit: (self: PiperProcess) => void) {
    this.child = child;
    this.onExit = onExit;

    // Lê o stdout como stream: acumula chunks, parte em '\n'; cada linha completa =
    // um output_file terminado -> resolve a cabeca da FIFO (ordem estrita do piper).
    this.child.stdout.on('data', (chunk: Buffer | string) => {
      this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim(); // trim mata o \r do Windows
        this.buffer = this.buffer.slice(nl + 1);
        if (line.length === 0) continue; // ignora linhas vazias/tail
        this.onLine(line);
      }
    });

    this.child.on('exit', () => this.die(new Error('Processo piper terminou')));
    this.child.on('error', (err) =>
      this.die(new Error(`Erro no processo piper: ${(err as Error)?.message ?? err}`)),
    );
  }

  get dead(): boolean {
    return this._dead;
  }

  /**
   * Sintetiza `text` para `outPath`. Escreve uma linha JSON no stdin e devolve uma
   * promise que resolve quando o piper imprimir o path concluido no stdout (FIFO).
   * Timeout por-utterance: se `timeoutMs` passar sem conclusao, o processo e tratado
   * como encravado -> mata-se, marca-se dead e rejeitam-se as restantes.
   */
  synth(text: string, outPath: string, timeoutMs: number): Promise<void> {
    if (this._dead) {
      return Promise.reject(new Error('Processo piper morto — nao aceita trabalho'));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Timeout = processo encravado. Mata + rejeita esta e todas as restantes.
        log.warn(`[piperPool] utterance timeout (${timeoutMs}ms) — a matar processo`);
        this.kill();
        this.die(new Error(`Piper pool timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      this.queue.push({ outPath, resolve, reject, timer });

      // JSON.stringify trata aspas/newlines/backslashes com seguranca.
      const line = JSON.stringify({ text, output_file: outPath }) + '\n';
      try {
        this.child.stdin.write(line);
      } catch (err) {
        // Escrita sincrona pode lancar se o stream ja estiver destruido.
        this.die(new Error(`Falha ao escrever no stdin do piper: ${(err as Error).message}`));
      }
    });
  }

  /** Mata o processo-filho (best-effort). Nao dispara onExit sozinho. */
  kill(): void {
    try {
      this.child.kill();
    } catch {
      // best-effort — o processo pode ja ter morrido.
    }
  }

  /** Resolve a cabeca da FIFO para uma linha de stdout (path concluido). */
  private onLine(line: string): void {
    const head = this.queue.shift();
    if (!head) {
      // Linha de stdout sem utterance pendente — diagnostico do piper, ignorar.
      return;
    }
    clearTimeout(head.timer);
    // Sanity-check opcional: o piper e estritamente sequencial, resolvemos SEMPRE a
    // cabeca; so avisamos se o basename impresso nao bater certo com o esperado.
    if (basename(line) !== basename(head.outPath)) {
      log.warn(`[piperPool] path do stdout ('${line}') != esperado ('${head.outPath}')`);
    }
    head.resolve();
  }

  /**
   * Marca o processo morto, rejeita TODAS as utterances pendentes (limpando os seus
   * timers) e notifica o pool via onExit — UMA so vez (guard). Chamado em
   * exit/error/timeout/falha-de-stdin.
   */
  private die(err: Error): void {
    this._dead = true;
    while (this.queue.length > 0) {
      const p = this.queue.shift()!;
      clearTimeout(p.timer);
      p.reject(err);
    }
    if (this.exitNotified) return;
    this.exitNotified = true;
    this.onExit(this);
  }
}

/** basename cross-platform (o piper imprime paths Windows com '\\'). */
function basename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/** Uma entrada do pool: o processo + o seu timer de idle. */
interface PoolEntry {
  proc: PiperProcess;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Pool de processos piper quentes, keyed por `key` (= `model|lengthScale`). Guarda
 * no maximo `maxWarm` processos; ao registar uma key NOVA que excede o limite,
 * evicta o processo LEAST-RECENTLY-USED (a ordem de insercao do Map da-nos o LRU).
 * Cada processo tem um timer de idle: apos `idleMs` sem trabalho, fecha-se para
 * libertar RAM.
 */
export class PiperPool {
  private readonly maxWarm: number;
  private readonly idleMs: number;
  private readonly spawn: (args: string[]) => ChildLike;
  // Map preserva ordem de insercao -> a primeira key e a LRU. Ao aceder, movemos a
  // key para o fim (delete+set) para a marcar most-recently-used.
  private readonly map = new Map<string, PoolEntry>();

  constructor(opts: { maxWarm: number; idleMs: number; spawn: (args: string[]) => ChildLike }) {
    this.maxWarm = Math.max(1, Math.floor(opts.maxWarm));
    this.idleMs = opts.idleMs;
    this.spawn = opts.spawn;
  }

  /**
   * Sintetiza via um processo quente para `key`. Se nao existir (ou estiver morto),
   * spawna um novo (evictando a LRU se necessario). Marca `key` como
   * most-recently-used, reinicia o timer de idle e delega no processo.
   */
  synth(key: string, args: string[], text: string, outPath: string, timeoutMs: number): Promise<void> {
    let entry = this.map.get(key);
    if (!entry || entry.proc.dead) {
      if (entry) this.remove(key, entry); // limpa a entrada morta
      entry = this.register(key, args);
    }
    // Marca most-recently-used: reinsere no fim da ordem do Map.
    this.map.delete(key);
    this.map.set(key, entry);
    this.resetIdle(key, entry);
    return entry.proc.synth(text, outPath, timeoutMs);
  }

  /** Mata e limpa todos os processos (chamar no shutdown central). */
  shutdown(): void {
    for (const [key, entry] of this.map) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.proc.kill();
      this.map.delete(key);
    }
  }

  /** Spawna e regista um novo processo para `key`, evictando a LRU se cheio. */
  private register(key: string, args: string[]): PoolEntry {
    if (this.map.size >= this.maxWarm) {
      // Evicta a LRU (primeira key na ordem de insercao) ANTES de inserir a nova.
      const lruKey = this.map.keys().next().value as string | undefined;
      if (lruKey !== undefined) {
        const lru = this.map.get(lruKey)!;
        this.remove(lruKey, lru);
      }
    }
    const child = this.spawn(args);
    const entry: PoolEntry = { proc: undefined as unknown as PiperProcess, idleTimer: null };
    // onExit remove a entrada SO se ainda for este processo (guard de identidade:
    // a key pode ja ter sido re-spawnada para outro processo).
    entry.proc = new PiperProcess(child, (self) => {
      const cur = this.map.get(key);
      if (cur && cur.proc === self) this.remove(key, cur);
    });
    this.map.set(key, entry);
    return entry;
  }

  /** Reinicia o timer de idle de uma entrada: apos idleMs sem trabalho, fecha-a. */
  private resetIdle(key: string, entry: PoolEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      const cur = this.map.get(key);
      if (cur === entry) this.remove(key, entry);
    }, this.idleMs);
    // Nao segura o event loop (processo pode encerrar mesmo com pools quentes).
    if (typeof entry.idleTimer.unref === 'function') entry.idleTimer.unref();
  }

  /** Mata o processo, limpa o timer de idle e remove a entrada do mapa. */
  private remove(key: string, entry: PoolEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    entry.proc.kill();
    // So apaga se a entrada no mapa ainda for esta (evita apagar um substituto vivo).
    if (this.map.get(key) === entry) this.map.delete(key);
  }
}
