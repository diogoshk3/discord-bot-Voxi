// tests/factory.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../src/tts/factory';
import { AudioCache } from '../src/tts/cache';
import { PiperEngine } from '../src/tts/piper';
import { NeuralEngine } from '../src/tts/neural';
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
    inactivityMs: 300000,
    queueCap: 20,
    maxChars: 300,
    ratePerMin: 5,
    ttsEngine: 'piper',
    openaiApiKey: undefined,
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
