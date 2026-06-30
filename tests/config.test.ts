import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config/index';

const REQUIRED = {
  DISCORD_TOKEN: 'tok-123',
  CLIENT_ID: 'client-123',
};

function setEnv(env: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('loadConfig', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    setEnv({
      DISCORD_TOKEN: undefined,
      CLIENT_ID: undefined,
      PIPER_PATH: undefined,
      MODELS_DIR: undefined,
      DB_PATH: undefined,
      DEFAULT_VOICE: undefined,
      DEFAULT_SPEED: undefined,
      INACTIVITY_MS: undefined,
      QUEUE_CAP: undefined,
      MAX_CHARS: undefined,
      RATE_PER_MIN: undefined,
      TTS_ENGINE: undefined,
      OPENAI_API_KEY: undefined,
      PRESENCE_TEXT: undefined,
    });
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('throws when DISCORD_TOKEN is missing', () => {
    setEnv({ ...REQUIRED, DISCORD_TOKEN: undefined });
    expect(() => loadConfig()).toThrow(/DISCORD_TOKEN/);
  });

  it('throws when CLIENT_ID is missing', () => {
    setEnv({ ...REQUIRED, CLIENT_ID: undefined });
    expect(() => loadConfig()).toThrow(/CLIENT_ID/);
  });

  it('returns required fields when present', () => {
    setEnv(REQUIRED);
    const cfg = loadConfig();
    expect(cfg.token).toBe('tok-123');
    expect(cfg.clientId).toBe('client-123');
  });

  it('applies string defaults when optionals missing', () => {
    setEnv(REQUIRED);
    const cfg = loadConfig();
    expect(cfg.piperPath).toBe('piper');
    expect(cfg.modelsDir).toBe('./models');
    expect(cfg.dbPath).toBe('./tts.db');
    expect(cfg.defaultVoice).toBe('en_US-amy-medium');
  });

  it('applies numeric defaults when optionals missing', () => {
    setEnv(REQUIRED);
    const cfg = loadConfig();
    expect(cfg.defaultSpeed).toBe(1);
    expect(cfg.inactivityMs).toBe(300000);
    expect(cfg.queueCap).toBe(20);
    expect(cfg.maxChars).toBe(300);
    expect(cfg.ratePerMin).toBe(5);
  });

  it('parses numeric env overrides', () => {
    setEnv({
      ...REQUIRED,
      DEFAULT_SPEED: '1.5',
      INACTIVITY_MS: '60000',
      QUEUE_CAP: '10',
      MAX_CHARS: '500',
      RATE_PER_MIN: '3',
    });
    const cfg = loadConfig();
    expect(cfg.defaultSpeed).toBe(1.5);
    expect(cfg.inactivityMs).toBe(60000);
    expect(cfg.queueCap).toBe(10);
    expect(cfg.maxChars).toBe(500);
    expect(cfg.ratePerMin).toBe(3);
  });

  it('falls back to default when numeric env is not a number', () => {
    setEnv({ ...REQUIRED, MAX_CHARS: 'abc' });
    const cfg = loadConfig();
    expect(cfg.maxChars).toBe(300);
  });

  it('uses string overrides', () => {
    setEnv({ ...REQUIRED, DEFAULT_VOICE: 'pt_PT-tugão-medium' });
    const cfg = loadConfig();
    expect(cfg.defaultVoice).toBe('pt_PT-tugão-medium');
  });

  // P7.3 — DEFAULT_VOICE regional: um valor de locale (pt_PT, pt_BR, de_DE...)
  // e aceite tal e qual via env, sem mexer no default de fabrica do codigo.
  // (O beforeEach limpa DEFAULT_VOICE entre testes, por isso o "default de
  //  fabrica" e provado pelo teste 'applies string defaults' acima.)
  it('aceita DEFAULT_VOICE regional via env (pt_BR)', () => {
    setEnv({ ...REQUIRED, DEFAULT_VOICE: 'pt_BR-faber-medium' });
    expect(loadConfig().defaultVoice).toBe('pt_BR-faber-medium');
  });

  it('default de fabrica do DEFAULT_VOICE permanece en_US-amy-medium (nao regional)', () => {
    setEnv(REQUIRED);
    expect(loadConfig().defaultVoice).toBe('en_US-amy-medium');
  });

  it('defaults ttsEngine to piper and leaves openaiApiKey undefined', () => {
    setEnv(REQUIRED);
    const cfg = loadConfig();
    expect(cfg.ttsEngine).toBe('piper');
    expect(cfg.openaiApiKey).toBeUndefined();
  });

  it('reads TTS_ENGINE=neural and OPENAI_API_KEY', () => {
    setEnv({ ...REQUIRED, TTS_ENGINE: 'neural', OPENAI_API_KEY: 'sk-abc' });
    const cfg = loadConfig();
    expect(cfg.ttsEngine).toBe('neural');
    expect(cfg.openaiApiKey).toBe('sk-abc');
  });

  it('falls back to piper on invalid TTS_ENGINE', () => {
    setEnv({ ...REQUIRED, TTS_ENGINE: 'bogus' });
    const cfg = loadConfig();
    expect(cfg.ttsEngine).toBe('piper');
  });

  // P9.3 — PRESENCE_TEXT opcional: ausente/vazio => undefined (buildPresence usa
  // o seu default de marca); presente => override exato passado a buildPresence.
  it('leaves presenceText undefined when PRESENCE_TEXT missing', () => {
    setEnv(REQUIRED);
    expect(loadConfig().presenceText).toBeUndefined();
  });

  it('reads PRESENCE_TEXT override from env', () => {
    setEnv({ ...REQUIRED, PRESENCE_TEXT: 'type it, hear it. • /invite' });
    expect(loadConfig().presenceText).toBe('type it, hear it. • /invite');
  });
});
