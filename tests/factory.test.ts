// tests/factory.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine, selectEngine } from '../src/tts/factory';
import { AudioCache } from '../src/tts/cache';
import { PiperEngine } from '../src/tts/piper';
import { NeuralEngine } from '../src/tts/neural';
import { MultiSegmentEngine } from '../src/tts/multiSegment';
import type { TTSEngine } from '../src/tts/engine';
import type { AppConfig } from '../src/config/index';

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    token: 'tok',
    clientId: 'cid',
    piperPath: 'piper',
    modelsDir: './models',
    dbPath: './tts.db',
    defaultVoice: 'en_US-amy-medium',
    defaultSpeed: 1,
    messageLeadMs: 200,
    inactivityMs: 300000,
    queueCap: 20,
    maxChars: 300,
    ratePerMin: 5,
    ttsEngine: 'piper',
    openaiApiKey: undefined,
    multilingualSegments: false,
    topggWebhookAllowInsecure: false,
    // Campos obrigatórios do AppConfig que o typecheck dos testes passou a exigir.
    noiseScale: 0.667,
    noiseW: 0.8,
    sentenceSilence: 0.2,
    gttsBreakerThreshold: 3,
    gttsBreakerCooldownMs: 60_000,
    supportUrl: 'https://discord.gg/V6PZYZmhcQ',
    ...overrides,
  };
}

describe('createEngine', () => {
  let dir: string;
  let cache: AudioCache;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'factorycache-'));
    cache = new AudioCache(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('default (piper) -> PiperEngine', () => {
    const engine = createEngine(baseConfig({ ttsEngine: 'piper' }), cache);
    expect(engine).toBeInstanceOf(PiperEngine);
  });

  it('neural + key -> NeuralEngine', () => {
    const engine = createEngine(
      baseConfig({ ttsEngine: 'neural', openaiApiKey: 'sk-test' }),
      cache,
    );
    expect(engine).toBeInstanceOf(NeuralEngine);
  });

  it('neural sem key -> lanca erro claro (fail-fast)', () => {
    expect(() =>
      createEngine(baseConfig({ ttsEngine: 'neural', openaiApiKey: undefined }), cache),
    ).toThrow(/TTS_ENGINE=neural requer OPENAI_API_KEY/);
  });
});

// P14.4 — selectEngine: prova EXECUTAVEL da invariante do caminho OFF (o motor
// base e devolvido INTACTO) e do wiring ON (embrulha em MultiSegmentEngine).
describe('selectEngine (flag MULTILINGUAL_SEGMENTS)', () => {
  let dir: string;
  let cache: AudioCache;
  // motor base falso (basta o contrato synth): so nos interessa a SELECAO.
  const base: TTSEngine = { synth: async () => '/tmp/x.wav' };
  const AVAILABLE = ['en_US-amy-medium', 'ru_RU-denis-medium'];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'selcache-'));
    cache = new AudioCache(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('flag OFF (forcada via env) -> devolve o motor base TAL E QUAL (identidade ===)', () => {
    const engine = selectEngine(base, baseConfig({ multilingualSegments: false }), AVAILABLE, cache);
    expect(engine).toBe(base);
  });

  it('flag ON (default) -> embrulha o base num MultiSegmentEngine', () => {
    const engine = selectEngine(base, baseConfig({ multilingualSegments: true }), AVAILABLE, cache);
    expect(engine).toBeInstanceOf(MultiSegmentEngine);
    expect(engine).not.toBe(base);
  });
});
