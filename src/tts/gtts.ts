// src/tts/gtts.ts — motor TTS GRATUITO via Google Translate TTS ("gTTS").
//
// Porquê: o Piper (self-host) lê palavras estrangeiras de forma mecânica. As vozes
// da Google (neurais, multilingues) leem texto MISTO com naturalidade numa só voz —
// é o que o Discord-TTS usa por defeito. Este motor traz essa qualidade ao Voxi SEM
// API key nem custo, atrás da flag TTS_ENGINE=gtts.
//
// AVISO (fragilidade honesta): o endpoint translate_tts é NÃO-OFICIAL. A Google
// pode limitar por IP (HTTP 429) ou mudá-lo sem aviso. Por isso é OPT-IN e o Piper
// continua o default/fallback. Cada request tem um limite de ~200 caracteres, por
// isso texto longo é partido em pedaços, sintetizado e concatenado.
//
// Formato: o gTTS devolve MP3; convertemo-lo para WAV 22050Hz mono 16-bit (o MESMO
// do Piper) via ffmpeg-static, para encaixar sem atrito no pipeline (cache,
// leadSilenceMs, player).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import type { SynthRequest, TTSEngine } from './engine';
import { AudioCache, cacheKey } from './cache';
import { concatWavs, silenceWav } from './wavConcat';
import { log } from '../logging/logger';

const GTTS_URL = 'https://translate.google.com/translate_tts';
const GTTS_TIMEOUT_MS = 15000;
/** Limite prático de caracteres por request do endpoint translate_tts. */
const GTTS_MAX_CHARS = 200;
/** Tentativas EXTRA por pedido quando o erro é TRANSITÓRIO (rede/5xx/429). Default 2. */
const GTTS_DEFAULT_RETRIES = 2;
/** Espera base entre tentativas (backoff linear: 300ms, 600ms, …). */
const GTTS_RETRY_BASE_MS = 300;

/** Erro etiquetado com se vale a pena repetir (transitório) ou não (falha dura). */
type TaggedError = Error & { retryable?: boolean };
function taggedError(message: string, retryable: boolean): TaggedError {
  const e = new Error(message) as TaggedError;
  e.retryable = retryable;
  return e;
}

/**
 * Um estado HTTP é TRANSITÓRIO (vale a pena repetir) quando é 429 (limite momentâneo
 * da Google) ou 5xx (erro do servidor). 403 e outros 4xx são falhas DURAS (repetir não
 * ajuda — ex.: bloqueio). PURA.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Corre `fn`, repetindo-a até `retries` vezes SÓ quando o erro está etiquetado como
 * `retryable` (transitório), com backoff linear (`baseDelayMs` × tentativa). Um erro
 * não-retryable (ex.: timeout, 403) falha IMEDIATAMENTE — evita empilhar esperas. O
 * `sleep` é injetável para testes. PURA (sem estado global). Propaga o último erro.
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  opts: {
    retries: number;
    sleep: (ms: number) => Promise<void>;
    baseDelayMs?: number;
    onRetry?: (err: unknown, attempt: number) => void;
  },
): Promise<T> {
  const base = opts.baseDelayMs ?? GTTS_RETRY_BASE_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = (err as TaggedError).retryable === true;
      if (!retryable || attempt === opts.retries) throw err;
      opts.onRetry?.(err, attempt);
      await opts.sleep(base * (attempt + 1));
    }
  }
  throw lastErr;
}
/** A Google rejeita o User-Agent default do fetch; finge um browser. */
const GTTS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/**
 * Código de língua para o gTTS a partir de um id de modelo Piper. O `tl` do
 * translate_tts é ISO-639-1 (ex. 'pt', 'en', 'es') — que é exatamente o prefixo do
 * id do modelo antes do '_' (pt_BR -> 'pt', en_US -> 'en'). Alguns precisam de
 * override (zh -> zh-CN). Sem '_' ou desconhecido -> 'en'. NOTA: 'pt' no Google é
 * português do Brasil por defeito, que é o que queremos. PURA.
 */
export function gttsLangOfModel(model: string): string {
  const us = model.indexOf('_');
  const prefix = (us === -1 ? '' : model.slice(0, us)).toLowerCase();
  if (!prefix) return 'en';
  const override: Record<string, string> = { zh: 'zh-CN' };
  return override[prefix] ?? prefix;
}

/**
 * Parte `text` em pedaços de <= `max` caracteres, quebrando em fronteiras de PALAVRA
 * (nunca a meio de uma). Uma palavra maior que `max` é cortada à força (raro). Texto
 * vazio -> []. PURA e determinística.
 */
export function chunkText(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const chunks: string[] = [];
  let cur = '';
  for (const w of words) {
    if (w.length > max) {
      // Palavra gigante: fecha o atual e corta a palavra em bocados de `max`.
      if (cur) {
        chunks.push(cur);
        cur = '';
      }
      for (let i = 0; i < w.length; i += max) chunks.push(w.slice(i, i + max));
      continue;
    }
    if (cur.length === 0) {
      cur = w;
    } else if (cur.length + 1 + w.length <= max) {
      cur += ` ${w}`;
    } else {
      chunks.push(cur);
      cur = w;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export interface GttsOptions {
  /** fetch injetável (testes). Default: o `fetch` global. */
  fetchImpl?: typeof fetch;
  /** sleep injetável (testes deterministicos). Default: setTimeout real. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** tentativas EXTRA por pedido para erros transitórios. Default GTTS_DEFAULT_RETRIES. */
  retries?: number;
}

export class GTTSEngine implements TTSEngine {
  private readonly cache: AudioCache;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retries: number;

  constructor(cache: AudioCache, opts: GttsOptions = {}) {
    this.cache = cache;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.retries = opts.retries ?? GTTS_DEFAULT_RETRIES;
  }

  async synth(req: SynthRequest): Promise<string> {
    const key = cacheKey(req);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const lang = gttsLangOfModel(req.model);
    const chunks = chunkText(req.text, GTTS_MAX_CHARS);
    if (chunks.length === 0) {
      throw new Error('gTTS: texto vazio');
    }

    // Um MP3 por pedaço; concatenam-se os bytes (frames MP3 do mesmo formato) e o
    // ffmpeg demuxa o stream inteiro de uma vez.
    const mp3s: Buffer[] = [];
    for (const c of chunks) {
      mp3s.push(await this.fetchChunk(c, lang));
    }
    const mp3 = Buffer.concat(mp3s);

    let wav = await mp3ToWav(mp3, req.speed);
    // Silêncio de arranque (mesma semântica do Piper): PREPENDido ao WAV.
    if (req.leadSilenceMs && req.leadSilenceMs > 0) {
      wav = concatWavs([silenceWav(req.leadSilenceMs), wav], { silenceMs: 0 });
    }

    const workDir = mkdtempSync(join(tmpdir(), 'gtts-'));
    const outPath = join(workDir, 'out.wav');
    try {
      writeFileSync(outPath, wav);
      return this.cache.put(key, outPath);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Busca UM pedaço, com RETRY para falhas TRANSITÓRIAS (rede intermitente, 5xx, 429
   * momentâneo) — a Google translate_tts é um endpoint não-oficial e falha às vezes por
   * um instante. NÃO repete timeouts (evita empilhar 15s×N) nem 403/bloqueios (repetir
   * não ajuda). Mantém a MESMA voz da Google — não muda de motor.
   */
  private async fetchChunk(text: string, lang: string): Promise<Buffer> {
    return retryAsync(() => this.fetchChunkOnce(text, lang), {
      retries: this.retries,
      sleep: this.sleep,
      onRetry: (err, attempt) =>
        log.warn(
          `[gtts] tentativa ${attempt + 1} falhou (${(err as Error).message}) — a repetir…`,
        ),
    });
  }

  /** Uma tentativa de busca. Lança um erro ETIQUETADO (retryable) para o retry decidir. */
  private async fetchChunkOnce(text: string, lang: string): Promise<Buffer> {
    const url =
      `${GTTS_URL}?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}` +
      `&q=${encodeURIComponent(text)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GTTS_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { 'User-Agent': GTTS_UA },
        signal: controller.signal,
      });
    } catch (err) {
      const isTimeout = (err as Error)?.name === 'AbortError';
      const reason = isTimeout ? `timeout (${GTTS_TIMEOUT_MS}ms)` : (err as Error).message;
      // Timeout NÃO é retryable (não empilhar esperas de 15s); outra falha de rede é transitória.
      throw taggedError(`gTTS: falha de rede (${reason})`, !isTimeout);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // 429 = rate-limit da Google (o preço de um endpoint não-oficial); 5xx = erro do
      // servidor. Ambos transitórios -> retry. 403/outros 4xx -> falha dura.
      throw taggedError(
        `gTTS: HTTP ${res.status} ${res.statusText} (429 = limite da Google)`,
        isRetryableStatus(res.status),
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw taggedError('gTTS: resposta vazia', false);
    return buf;
  }
}

/**
 * Converte um buffer MP3 em WAV 22050Hz mono 16-bit (formato do Piper) via
 * ffmpeg-static. `speed` != 1 aplica o filtro `atempo` (0.5–2.0). Usa ficheiros
 * temporários (mesmo padrão do resto do pipeline). Rejeita em erro do ffmpeg.
 */
function mp3ToWav(mp3: Buffer, speed: number): Promise<Buffer> {
  const ff = ffmpegPath as unknown as string | null;
  if (!ff) {
    return Promise.reject(new Error('gTTS: ffmpeg-static não encontrado (corre o install.js)'));
  }
  const workDir = mkdtempSync(join(tmpdir(), 'gtts-conv-'));
  const inPath = join(workDir, 'in.mp3');
  const outPath = join(workDir, 'out.wav');
  writeFileSync(inPath, mp3);

  const args = ['-hide_banner', '-loglevel', 'error', '-i', inPath];
  if (speed > 0 && Math.abs(speed - 1) > 1e-6) {
    const s = Math.min(2.0, Math.max(0.5, speed));
    args.push('-filter:a', `atempo=${s}`);
  }
  args.push('-ar', '22050', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', outPath, '-y');

  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      rmSync(workDir, { recursive: true, force: true });
      reject(new Error(`gTTS: falha ao iniciar ffmpeg: ${err.message}`));
    });
    child.on('close', (code) => {
      try {
        if (code === 0) {
          resolve(readFileSync(outPath));
        } else {
          reject(new Error(`gTTS: ffmpeg saiu com ${code}: ${stderr.trim()}`));
        }
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    });
  });
}
