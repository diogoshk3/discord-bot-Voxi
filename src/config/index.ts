import 'dotenv/config';
import { log } from '../logging/logger';

export type TtsEngineKind = 'piper' | 'neural';

export interface AppConfig {
  token: string;
  clientId: string;
  piperPath: string;
  modelsDir: string;
  dbPath: string;
  defaultVoice: string;
  defaultSpeed: number;
  inactivityMs: number;
  queueCap: number;
  maxChars: number;
  ratePerMin: number;
  ttsEngine: TtsEngineKind;
  openaiApiKey?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function strEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  return value;
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Le TTS_ENGINE. Default 'piper'. Valor invalido (que nao 'piper'/'neural')
 * cai em 'piper' com um aviso no stderr — o Piper e o default seguro e nunca
 * precisa de API key, por isso degradar para ele e preferivel a crashar o
 * arranque por um typo na env. (A combinacao 'neural' sem OPENAI_API_KEY essa
 * sim falha rapido — ver createEngine.)
 */
function engineEnv(): TtsEngineKind {
  const raw = process.env.TTS_ENGINE;
  if (raw === undefined || raw.trim() === '') return 'piper';
  const value = raw.trim().toLowerCase();
  if (value === 'piper' || value === 'neural') return value;
  log.warn(
    `[config] TTS_ENGINE invalido: "${raw}". Valores aceites: piper | neural. A usar 'piper'.`,
  );
  return 'piper';
}

export function loadConfig(): AppConfig {
  return {
    token: requireEnv('DISCORD_TOKEN'),
    clientId: requireEnv('CLIENT_ID'),
    piperPath: strEnv('PIPER_PATH', 'piper'),
    modelsDir: strEnv('MODELS_DIR', './models'),
    dbPath: strEnv('DB_PATH', './tts.db'),
    defaultVoice: strEnv('DEFAULT_VOICE', 'en_US-amy-medium'),
    defaultSpeed: numEnv('DEFAULT_SPEED', 1),
    inactivityMs: numEnv('INACTIVITY_MS', 300000),
    queueCap: numEnv('QUEUE_CAP', 20),
    maxChars: numEnv('MAX_CHARS', 300),
    ratePerMin: numEnv('RATE_PER_MIN', 5),
    ttsEngine: engineEnv(),
    openaiApiKey: strEnv('OPENAI_API_KEY', '') || undefined,
  };
}
