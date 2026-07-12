import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GCloudEngine, bcp47OfModel, type GcloudUsage, type GcloudLimits } from '../src/tts/gcloud';
import { AudioCache } from '../src/tts/cache';
import { metrics } from '../src/metrics';
import type { SynthRequest } from '../src/tts/engine';

// Um "WAV" de brincadeira: os bytes não importam para o teste (não os reproduzimos),
// só que o que a Google devolve em base64 aterra intacto em disco.
const FAKE_WAV = Buffer.from('RIFF....WAVEfake-linear16-pcm');

/** fetch falso que devolve { audioContent } (base64) com 200, e regista o body enviado. */
function okFetch(audio: Buffer): {
  impl: typeof fetch;
  calls: Array<{ url: string; body: unknown }>;
} {
  const calls: Array<{ url: string; body: unknown }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return { audioContent: audio.toString('base64') };
      },
      async text() {
        return '';
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

let dir: string;
let cache: AudioCache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gcloud-test-'));
  cache = new AudioCache(dir, 0); // 0 = sem evict, isolado por teste
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const req = (over: Partial<SynthRequest> = {}): SynthRequest => ({
  text: 'olá mundo',
  model: 'pt_PT-tuga-medium',
  speed: 1,
  engine: 'gcloud',
  ...over,
});

describe('bcp47OfModel — id de modelo Piper -> languageCode BCP-47', () => {
  it('pt_PT-... -> pt-PT', () => expect(bcp47OfModel('pt_PT-tuga-medium')).toBe('pt-PT'));
  it('en_US-amy-medium -> en-US', () => expect(bcp47OfModel('en_US-amy-medium')).toBe('en-US'));
  it('es_ES-... -> es-ES', () => expect(bcp47OfModel('es_ES-mls-medium')).toBe('es-ES'));
  it('ja_JP-... -> ja-JP', () => expect(bcp47OfModel('ja_JP-x-medium')).toBe('ja-JP'));
  it('sem locale reconhecível -> en-US (fallback seguro)', () =>
    expect(bcp47OfModel('weird')).toBe('en-US'));
});

describe('GCloudEngine — síntese via API oficial Google Cloud TTS', () => {
  it('POST synthesize; grava o WAV do audioContent base64; devolve caminho', async () => {
    const { impl, calls } = okFetch(FAKE_WAV);
    const eng = new GCloudEngine('KEY', cache, { fetchImpl: impl });
    const out = await eng.synth(req());
    expect(out.endsWith('.wav')).toBe(true);
    expect(readFileSync(out).equals(FAKE_WAV)).toBe(true);
    // 1 pedido, ao endpoint certo, com a API key no header X-Goog-Api-Key.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('texttospeech.googleapis.com');
    // Corpo: LINEAR16 + languageCode derivado do modelo.
    const body = calls[0].body as {
      audioConfig: { audioEncoding: string };
      voice: { languageCode: string };
      input: { text: string };
    };
    expect(body.audioConfig.audioEncoding).toBe('LINEAR16');
    expect(body.voice.languageCode).toBe('pt-PT');
  });

  it('lê da cache no 2.º pedido igual (sem 2.ª chamada à Google)', async () => {
    const { impl, calls } = okFetch(FAKE_WAV);
    const eng = new GCloudEngine('KEY', cache, { fetchImpl: impl });
    const a = await eng.synth(req());
    const b = await eng.synth(req());
    expect(a).toBe(b);
    expect(calls).toHaveLength(1); // cache hit no 2.º
  });

  it('MAIÚSCULAS em runs de 2+ são baixadas no input (não soletra)', async () => {
    const { impl, calls } = okFetch(FAKE_WAV);
    const eng = new GCloudEngine('KEY', cache, { fetchImpl: impl });
    await eng.synth(req({ text: 'VOLTEI já' }));
    const body = calls[0].body as { input: { text: string } };
    expect(body.input.text).toBe('voltei já');
  });

  it('HTTP != ok -> throw (para o RouterEngine cair no gTTS)', async () => {
    const impl = (async () =>
      ({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        async text() {
          return 'API key invalid';
        },
      }) as unknown as Response) as unknown as typeof fetch;
    const eng = new GCloudEngine('KEY', cache, { fetchImpl: impl });
    await expect(eng.synth(req())).rejects.toThrow(/403/);
  });

  it('audioContent vazio -> throw', async () => {
    const impl = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
          return { audioContent: '' };
        },
      }) as unknown as Response) as unknown as typeof fetch;
    const eng = new GCloudEngine('KEY', cache, { fetchImpl: impl });
    await expect(eng.synth(req())).rejects.toThrow();
  });
});

// Fase 3 — allowances/contadores no CHOKEPOINT. Com `limits`+`usage`, o motor conta os
// chars SÓ na chamada real (cache-miss) e RECUSA (throw -> o RouterEngine cai no gTTS)
// quando: não há orçamento (fail-safe), o texto excede maxChars, o pool mensal esgota, ou
// o backstop global/dia estoura. Sem `limits` (Fase 1) nada disto se aplica.
function memUsage(): GcloudUsage & { store: Map<string, number> } {
  const store = new Map<string, number>();
  const k = (s: string, key: string, mo: string) => `${s}|${key}|${mo}`;
  return {
    store,
    getMonthly: (s, key, mo) => store.get(k(s, key, mo)) ?? 0,
    addMonthly: (s, key, mo, c) => store.set(k(s, key, mo), (store.get(k(s, key, mo)) ?? 0) + c),
  };
}
const LIMITS: GcloudLimits = {
  maxChars: 10,
  plusMonthly: 100,
  pass3Monthly: 400,
  pass8Monthly: 1000,
  dailyBudget: 500,
};
const FIXED_NOW = () => Date.UTC(2026, 6, 15, 12); // 2026-07-15 (mês '2026-07')

describe('GCloudEngine — allowances no chokepoint (Fase 3)', () => {
  beforeEach(() => metrics.reset());

  function eng(usage: GcloudUsage, over: Partial<GcloudLimits> = {}) {
    const { impl, calls } = okFetch(FAKE_WAV);
    return {
      engine: new GCloudEngine('KEY', cache, {
        fetchImpl: impl,
        usage,
        limits: { ...LIMITS, ...over },
        now: FIXED_NOW,
      }),
      calls,
    };
  }
  const budgeted = (over: Partial<SynthRequest> = {}): SynthRequest =>
    req({ text: 'ola', gcloudBudget: { scope: 'user', key: 'u1' }, ...over });

  it('gcloud SEM orçamento + limits presentes -> throw (fail-safe), NÃO chama a Google', async () => {
    const u = memUsage();
    const { engine, calls } = eng(u);
    await expect(engine.synth(req({ text: 'ola' }))).rejects.toThrow(); // sem gcloudBudget
    expect(calls).toHaveLength(0);
    expect(metrics.snapshot().gcloudFallbacks).toBe(1);
  });

  it('texto acima de maxChars -> throw, NÃO chama a Google', async () => {
    const u = memUsage();
    const { engine, calls } = eng(u);
    await expect(engine.synth(budgeted({ text: 'x'.repeat(11) }))).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('sob o limite mensal -> sintetiza e CONTA os chars no pool certo', async () => {
    const u = memUsage();
    const { engine, calls } = eng(u);
    await engine.synth(budgeted({ text: 'ola' })); // 3 chars
    expect(calls).toHaveLength(1);
    expect(u.getMonthly('user', 'u1', '2026-07')).toBe(3);
    expect(metrics.snapshot().gcloudChars).toBe(3);
    expect(metrics.snapshot().gcloudSynths).toBe(1);
  });

  it('pool mensal ESGOTADO -> throw, NÃO chama a Google', async () => {
    const u = memUsage();
    u.addMonthly('user', 'u1', '2026-07', 99); // limite plus = 100; sobra 1
    const { engine, calls } = eng(u);
    await expect(engine.synth(budgeted({ text: 'ola' }))).rejects.toThrow(); // 3 > 1 -> recusa
    expect(calls).toHaveLength(0);
    expect(metrics.snapshot().gcloudFallbacks).toBe(1);
  });

  it('cache-hit NÃO conta (sem custo Google no 2.º pedido igual)', async () => {
    const u = memUsage();
    const { engine, calls } = eng(u);
    await engine.synth(budgeted({ text: 'ola' }));
    await engine.synth(budgeted({ text: 'ola' })); // cache-hit
    expect(calls).toHaveLength(1);
    expect(u.getMonthly('user', 'u1', '2026-07')).toBe(3); // contou 1 vez só
  });

  it('pool do PASSE usa o tier pelos seats (3 servidores -> pass3Monthly)', async () => {
    const u = memUsage();
    u.addMonthly('pass', 'owner-1', '2026-07', 399); // pass3 = 400; sobra 1
    const { engine, calls } = eng(u);
    const r = req({ text: 'ola', gcloudBudget: { scope: 'pass', key: 'owner-1', seats: 3 } });
    await expect(engine.synth(r)).rejects.toThrow(); // 3 > 1 -> recusa (tier de 3s)
    expect(calls).toHaveLength(0);
  });

  it('backstop GLOBAL/dia estoura -> throw mesmo com pool mensal disponível', async () => {
    const u = memUsage();
    const { engine, calls } = eng(u, { dailyBudget: 2 }); // teto diário baixo
    await expect(engine.synth(budgeted({ text: 'ola' }))).rejects.toThrow(); // 3 > 2 diário
    expect(calls).toHaveLength(0);
  });
});
