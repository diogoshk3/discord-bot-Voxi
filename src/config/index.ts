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
  presenceText?: string;
  healthPort?: number;
  shards?: string;
  // P11.5 — webhook top.gg OPCIONAL. Porta ausente => sem servidor (default).
  // Secret ausente => webhook sem auth (inseguro; recomenda-se sempre defini-lo).
  topggWebhookPort?: number;
  topggWebhookSecret?: string;
  // P14.4 — flag EXPERIMENTAL (default OFF). Quando ON, textos com mais do que
  // uma lingua sao sintetizados POR-SEGMENTO (voz certa por lingua) e os WAVs
  // concatenados. OFF => comportamento inalterado (voz unica por frase).
  multilingualSegments: boolean;
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
 * Numero OPCIONAL: ausente/vazio => undefined (ao contrario de numEnv, que tem
 * sempre fallback). Valor nao-numerico tambem => undefined — a escolha
 * defensiva, consistente com o resto do modulo: nao arrancamos um servidor por
 * causa de um typo na env. Usado por HEALTH_PORT (sem porta => sem servidor).
 */
function numEnvOptional(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Flag booleana OPT-IN: default `false`. So o valor exato 'true' (case-insensitive)
 * liga; qualquer outra coisa (ausente, vazio, '1', 'yes', typo) fica `false`.
 * Escolha conservadora — uma feature experimental so liga com intencao explicita.
 */
function boolEnv(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return raw.trim().toLowerCase() === 'true';
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
    // P9.3 — texto opcional da presenca; vazio/ausente => undefined e buildPresence
    // usa o seu default de marca. Override exato quando definido.
    presenceText: strEnv('PRESENCE_TEXT', '') || undefined,
    // P9.7 — porta OPCIONAL do health endpoint HTTP (uptime monitors). Ausente
    // => undefined => NAO arranca servidor nenhum (default). Definida => numero.
    healthPort: numEnvOptional('HEALTH_PORT'),
    // P11.4 — valor CRU do BOT_SHARDS (opt-in de sharding). Ausente/vazio =>
    // undefined => single-process (default). A interpretacao (auto / N / single) e
    // feita por resolveShardCount no launcher src/shard.ts — aqui so transportamos
    // a string.
    // NB: a env chama-se BOT_SHARDS e NAO `SHARDS` de proposito. `SHARDS` (e
    // `SHARD_COUNT`) sao reservadas: o construtor do Client do discord.js le-as
    // diretamente de process.env. Num arranque single-process (`npm start`),
    // `SHARDS=auto` faria `JSON.parse('auto')` crashar o Client, e `SHARDS=N`
    // configuraria o processo como um shard isolado — partindo o default. Manter
    // o nome distinto isola o opt-in do mecanismo interno do discord.js.
    shards: strEnv('BOT_SHARDS', '') || undefined,
    // P11.5 — webhook top.gg OPCIONAL. TOPGG_WEBHOOK_PORT ausente/vazio/invalido
    // => undefined => NAO arranca servidor de webhook (default), igual ao
    // HEALTH_PORT. TOPGG_WEBHOOK_SECRET ausente/vazio => undefined => webhook sem
    // auth (inseguro; ver startVoteWebhookServer, que avisa nesse caso). Porta
    // dedicada, separada do HEALTH_PORT de proposito.
    topggWebhookPort: numEnvOptional('TOPGG_WEBHOOK_PORT'),
    topggWebhookSecret: strEnv('TOPGG_WEBHOOK_SECRET', '') || undefined,
    // P14.4 — sintese multi-lingua por-segmento (EXPERIMENTAL). Default OFF: sem
    // esta env (ou != 'true'), o comportamento e exatamente o de hoje (voz unica).
    multilingualSegments: boolEnv('MULTILINGUAL_SEGMENTS'),
  };
}
