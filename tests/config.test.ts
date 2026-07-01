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
      HEALTH_PORT: undefined,
      TOPGG_WEBHOOK_PORT: undefined,
      TOPGG_WEBHOOK_SECRET: undefined,
      BOT_SHARDS: undefined,
      MULTILINGUAL_SEGMENTS: undefined,
      NOISE_SCALE: undefined,
      NOISE_W: undefined,
      SENTENCE_SILENCE: undefined,
      // tambem limpamos a env reservada do discord.js para o teste de regressao
      // partir de um estado conhecido (so um teste a define de proposito).
      SHARDS: undefined,
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

  // P9.7 — HEALTH_PORT opcional: ausente/vazio => undefined (sem servidor);
  // definido => numero. Valor invalido cai em undefined (defensivo).
  it('leaves healthPort undefined when HEALTH_PORT missing', () => {
    setEnv(REQUIRED);
    expect(loadConfig().healthPort).toBeUndefined();
  });

  it('parses HEALTH_PORT as a number when set', () => {
    setEnv({ ...REQUIRED, HEALTH_PORT: '8080' });
    expect(loadConfig().healthPort).toBe(8080);
  });

  it('leaves healthPort undefined on invalid HEALTH_PORT', () => {
    setEnv({ ...REQUIRED, HEALTH_PORT: 'abc' });
    expect(loadConfig().healthPort).toBeUndefined();
  });

  // P11.5 — TOPGG_WEBHOOK_PORT opcional: ausente/vazio => undefined (sem servidor
  // de webhook); definido => numero; invalido => undefined (defensivo, igual ao
  // HEALTH_PORT). TOPGG_WEBHOOK_SECRET opcional: ausente/vazio => undefined.
  it('leaves topggWebhookPort/Secret undefined when env missing', () => {
    setEnv(REQUIRED);
    const cfg = loadConfig();
    expect(cfg.topggWebhookPort).toBeUndefined();
    expect(cfg.topggWebhookSecret).toBeUndefined();
  });

  it('parses TOPGG_WEBHOOK_PORT as a number when set', () => {
    setEnv({ ...REQUIRED, TOPGG_WEBHOOK_PORT: '8081' });
    expect(loadConfig().topggWebhookPort).toBe(8081);
  });

  it('leaves topggWebhookPort undefined on invalid TOPGG_WEBHOOK_PORT', () => {
    setEnv({ ...REQUIRED, TOPGG_WEBHOOK_PORT: 'abc' });
    expect(loadConfig().topggWebhookPort).toBeUndefined();
  });

  it('reads TOPGG_WEBHOOK_SECRET from env', () => {
    setEnv({ ...REQUIRED, TOPGG_WEBHOOK_SECRET: 's3cr3t' });
    expect(loadConfig().topggWebhookSecret).toBe('s3cr3t');
  });

  // P11.4 — BOT_SHARDS opcional: ausente/vazio => undefined (single-process
  // default); presente => string CRUA passada a resolveShardCount no launcher. O
  // config so transporta o valor; a interpretacao (auto/N/single) vive em
  // src/sharding.ts. NB: a env e BOT_SHARDS, NAO `SHARDS` — esta ultima colide com
  // uma env reservada lida pelo Client do discord.js e partiria o `npm start`.
  it('leaves shards undefined when BOT_SHARDS missing', () => {
    setEnv(REQUIRED);
    expect(loadConfig().shards).toBeUndefined();
  });

  it('leaves shards undefined when BOT_SHARDS is empty', () => {
    setEnv({ ...REQUIRED, BOT_SHARDS: '' });
    expect(loadConfig().shards).toBeUndefined();
  });

  it('reads BOT_SHARDS raw value from env', () => {
    setEnv({ ...REQUIRED, BOT_SHARDS: 'auto' });
    expect(loadConfig().shards).toBe('auto');
  });

  it('reads numeric BOT_SHARDS as the raw string', () => {
    setEnv({ ...REQUIRED, BOT_SHARDS: '4' });
    expect(loadConfig().shards).toBe('4');
  });

  // P11.4 (regressao) — a env reservada `SHARDS` do discord.js NAO deve influenciar
  // config.shards. Se um utilizador definir SHARDS por engano, o nosso opt-in
  // (BOT_SHARDS) continua a mandar — e fica undefined, ou seja single-process.
  it('ignores the reserved SHARDS env (only BOT_SHARDS controls sharding)', () => {
    setEnv({ ...REQUIRED, SHARDS: 'auto', BOT_SHARDS: undefined });
    expect(loadConfig().shards).toBeUndefined();
  });

  // P14.4 — MULTILINGUAL_SEGMENTS (flag EXPERIMENTAL, default OFF). Ausente/vazio
  // => false (comportamento inalterado: voz unica por frase). 'true' => true.
  // Parsing booleano tolerante como as outras flags do modulo.
  it('multilingualSegments defaults to false when MULTILINGUAL_SEGMENTS missing', () => {
    setEnv(REQUIRED);
    expect(loadConfig().multilingualSegments).toBe(false);
  });

  it('multilingualSegments false when MULTILINGUAL_SEGMENTS empty', () => {
    setEnv({ ...REQUIRED, MULTILINGUAL_SEGMENTS: '' });
    expect(loadConfig().multilingualSegments).toBe(false);
  });

  it('reads MULTILINGUAL_SEGMENTS=true as true', () => {
    setEnv({ ...REQUIRED, MULTILINGUAL_SEGMENTS: 'true' });
    expect(loadConfig().multilingualSegments).toBe(true);
  });

  it('MULTILINGUAL_SEGMENTS is case-insensitive (TRUE / True -> true)', () => {
    setEnv({ ...REQUIRED, MULTILINGUAL_SEGMENTS: 'TRUE' });
    expect(loadConfig().multilingualSegments).toBe(true);
    setEnv({ ...REQUIRED, MULTILINGUAL_SEGMENTS: 'True' });
    expect(loadConfig().multilingualSegments).toBe(true);
  });

  it('MULTILINGUAL_SEGMENTS with a non-true value (e.g. "1"/"yes") stays false (only "true" enables)', () => {
    setEnv({ ...REQUIRED, MULTILINGUAL_SEGMENTS: '1' });
    expect(loadConfig().multilingualSegments).toBe(false);
    setEnv({ ...REQUIRED, MULTILINGUAL_SEGMENTS: 'yes' });
    expect(loadConfig().multilingualSegments).toBe(false);
  });

  // Params de qualidade Piper (noiseScale/noiseW/sentenceSilence). Defaults
  // IGUAIS aos defaults do proprio Piper => sem qualquer mudanca audivel. Env
  // opcional e numerica (numEnv: invalido/ausente => fallback ao default).
  it('applies Piper synth-quality defaults when env missing (0.667 / 0.8 / 0.2)', () => {
    setEnv(REQUIRED);
    const cfg = loadConfig();
    expect(cfg.noiseScale).toBe(0.667);
    expect(cfg.noiseW).toBe(0.8);
    expect(cfg.sentenceSilence).toBe(0.2);
  });

  it('parses NOISE_SCALE / NOISE_W / SENTENCE_SILENCE overrides from env', () => {
    setEnv({ ...REQUIRED, NOISE_SCALE: '0.5', NOISE_W: '0.9', SENTENCE_SILENCE: '0.4' });
    const cfg = loadConfig();
    expect(cfg.noiseScale).toBe(0.5);
    expect(cfg.noiseW).toBe(0.9);
    expect(cfg.sentenceSilence).toBe(0.4);
  });

  it('falls back to defaults when synth-quality env is not a number', () => {
    setEnv({ ...REQUIRED, NOISE_SCALE: 'abc', NOISE_W: '', SENTENCE_SILENCE: 'xyz' });
    const cfg = loadConfig();
    expect(cfg.noiseScale).toBe(0.667);
    expect(cfg.noiseW).toBe(0.8);
    expect(cfg.sentenceSilence).toBe(0.2);
  });
});
