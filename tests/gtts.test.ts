import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  gttsLangOfModel,
  chunkText,
  deCapsForGoogle,
  GTTSEngine,
  retryAsync,
  isRetryableStatus,
} from '../src/tts/gtts';
import { createEngine } from '../src/tts/factory';
import { AudioCache } from '../src/tts/cache';
import type { AppConfig } from '../src/config/index';

/** Erro etiquetado como no gtts.ts (retryable = transitório). */
function tagged(msg: string, retryable: boolean): Error {
  const e = new Error(msg) as Error & { retryable: boolean };
  e.retryable = retryable;
  return e;
}
const noSleep = async () => {};

describe('gttsLangOfModel — id de modelo Piper -> código tl do gTTS', () => {
  it('usa o prefixo antes do "_" (ISO-639-1)', () => {
    expect(gttsLangOfModel('pt_BR-cadu-medium')).toBe('pt'); // pt = Brasil no Google
    expect(gttsLangOfModel('en_US-amy-medium')).toBe('en');
    expect(gttsLangOfModel('es_ES-davefx-medium')).toBe('es');
    expect(gttsLangOfModel('fr_FR-siwis-medium')).toBe('fr');
    expect(gttsLangOfModel('ru_RU-denis-medium')).toBe('ru');
    // Voz sintetica SO-gTTS do japones (sem modelo Piper): tem de mapear tl=ja.
    expect(gttsLangOfModel('ja_JP-google-medium')).toBe('ja');
  });

  it('override do chinês (zh -> zh-CN) e fallback para inglês', () => {
    expect(gttsLangOfModel('zh_CN-chaowen-medium')).toBe('zh-CN');
    expect(gttsLangOfModel('semunderscore')).toBe('en');
    expect(gttsLangOfModel('')).toBe('en');
  });
});

describe('chunkText — parte por palavra respeitando o limite', () => {
  it('texto curto -> 1 pedaço', () => {
    expect(chunkText('ola amigos hello guys', 200)).toEqual(['ola amigos hello guys']);
  });

  it('texto vazio/só-espaços -> []', () => {
    expect(chunkText('', 200)).toEqual([]);
    expect(chunkText('   ', 200)).toEqual([]);
  });

  it('parte em fronteira de palavra e cada pedaço <= max', () => {
    const words = Array.from({ length: 60 }, (_, i) => `palavra${i}`).join(' ');
    const chunks = chunkText(words, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(40);
    // Reconstrução por espaços preserva todas as palavras (nenhuma perdida/cortada).
    expect(chunks.join(' ').split(/\s+/)).toEqual(words.split(' '));
  });

  it('palavra maior que max é cortada à força', () => {
    const giant = 'x'.repeat(90);
    const chunks = chunkText(giant, 40);
    expect(chunks).toEqual(['x'.repeat(40), 'x'.repeat(40), 'x'.repeat(10)]);
  });

  it('palavra gigante com surrogates: corta por CODE POINT (encodeURIComponent nunca lança)', () => {
    // O 'a' inicial DESALINHA as fronteiras (cada emoji = 2 unidades UTF-16), por isso
    // um slice por unidade UTF-16 deixaria um surrogate solitário -> encodeURIComponent
    // lançava URIError (o bug). Cortar por code point (Array.from) evita-o.
    const giant = 'a' + '😀'.repeat(250);
    const chunks = chunkText(giant, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(() => encodeURIComponent(c)).not.toThrow(); // cada pedaço é texto válido
    }
    expect(chunks.join('')).toBe(giant); // reconstrói a palavra inteira
  });
});

// Bug (relatado pelo Diogo, confirmado empíricamente em 22 línguas): o Google
// translate_tts SOLETRA palavras todo-maiúsculas ("VOLTEI" -> "V O L T E I"). Baixamos
// runs de 2+ maiúsculas para minúsculas antes de enviar à Google, para as LER.
describe('deCapsForGoogle — evita que a Google soletre TODO-MAIÚSCULAS', () => {
  it('baixa palavra todo-maiúsculas para minúsculas', () => {
    expect(deCapsForGoogle('VOLTEI')).toBe('voltei');
    expect(deCapsForGoogle('olá VOLTEI aqui')).toBe('olá voltei aqui');
    expect(deCapsForGoogle('NASA')).toBe('nasa');
    expect(deCapsForGoogle('OK')).toBe('ok');
  });

  it('NÃO toca em minúsculas, Title-Case, nem numa única maiúscula', () => {
    expect(deCapsForGoogle('voltei')).toBe('voltei');
    expect(deCapsForGoogle('Voltei')).toBe('Voltei'); // só o "V" — 1 maiúscula
    expect(deCapsForGoogle('I am a Robot')).toBe('I am a Robot'); // "I" fica
    expect(deCapsForGoogle('iPhone')).toBe('iPhone'); // sem run de 2+
  });

  it('lida com acentos e dígitos', () => {
    expect(deCapsForGoogle('ÁGUA')).toBe('água'); // maiúsculas acentuadas
    expect(deCapsForGoogle('COVID19')).toBe('covid19'); // run de letras + dígitos
    expect(deCapsForGoogle('GRITO!!!')).toBe('grito!!!'); // pontuação intacta
  });

  it('vazio -> vazio', () => {
    expect(deCapsForGoogle('')).toBe('');
  });
});

describe('GTTSEngine.synth — envia o texto SEM todo-maiúsculas à Google', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('o q= do pedido usa a versão minúscula de uma palavra caps', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gtts-caps-'));
    let capturedUrl = '';
    const fetchImpl = vi.fn(async (url: string | URL) => {
      capturedUrl = String(url);
      throw tagged('stop-after-capture', false); // não-retryable: pára após capturar
    });
    const engine = new GTTSEngine(new AudioCache(dir), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    await engine.synth({ text: 'olá VOLTEI', model: 'es_ES-davefx-medium', speed: 1 }).catch(() => {});
    // O parâmetro q (já descodificado por URLSearchParams) tem a palavra em minúsculas.
    const q = new URL(capturedUrl).searchParams.get('q');
    expect(q).toBe('olá voltei');
  });
});

describe('isRetryableStatus — 429/5xx transitório; 403/4xx falha dura', () => {
  it('429 e 5xx -> retryable', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });
  it('403 e outros 4xx -> NÃO retryable', () => {
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
  });
});

describe('retryAsync — repete só erros transitórios, com limite', () => {
  it('erro transitório 1x depois sucesso -> devolve o resultado (repetiu)', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n++;
      if (n === 1) throw tagged('blip', true);
      return 'ok';
    });
    const out = await retryAsync(fn, { retries: 2, sleep: noSleep });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('erro NÃO-retryable (ex.: timeout/403) -> falha JÁ, sem repetir', async () => {
    const fn = vi.fn(async () => {
      throw tagged('timeout', false);
    });
    await expect(retryAsync(fn, { retries: 2, sleep: noSleep })).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(1); // sem retries
  });

  it('erro transitório persistente -> esgota as tentativas e propaga o último', async () => {
    const fn = vi.fn(async () => {
      throw tagged('429', true);
    });
    await expect(retryAsync(fn, { retries: 2, sleep: noSleep })).rejects.toThrow('429');
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });
});

describe('GTTSEngine.fetchChunk — retry no fetch (via fetchImpl injetado)', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('um 503 momentâneo é recuperado na 2ª tentativa (mesma voz Google)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gtts-retry-'));
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 503, statusText: 'Service Unavailable' } as Response;
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } as Response;
    });
    const engine = new GTTSEngine(new AudioCache(dir), { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: noSleep });
    // synth chama fetchChunk; com 1 pedaço curto, o ffmpeg converte os bytes. Aqui só
    // exercitamos que NÃO rebenta no 503 e que o fetch foi chamado 2x (recuperou).
    await engine.synth({ text: 'ola', model: 'pt_BR-cadu-medium', speed: 1 }).catch(() => {});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('um 403 (bloqueio) NÃO é repetido — falha dura', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gtts-403-'));
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, statusText: 'Forbidden' }) as Response);
    const engine = new GTTSEngine(new AudioCache(dir), { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: noSleep });
    await expect(
      engine.synth({ text: 'ola', model: 'pt_BR-cadu-medium', speed: 1 }),
    ).rejects.toThrow(/403/);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // sem retry
  });
});

describe('createEngine — TTS_ENGINE=gtts seleciona o GTTSEngine', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  it('devolve um GTTSEngine (sem API key, sem Piper path)', () => {
    dir = mkdtempSync(join(tmpdir(), 'gttscache-'));
    const cache = new AudioCache(dir);
    const cfg = { ttsEngine: 'gtts', openaiApiKey: undefined } as unknown as AppConfig;
    expect(createEngine(cfg, cache)).toBeInstanceOf(GTTSEngine);
  });
});
