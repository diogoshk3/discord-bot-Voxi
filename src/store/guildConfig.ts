import type Database from 'better-sqlite3';
import { DEFAULT_LOCALE } from '../i18n/index';
// Tabela CACHEADA (lida a cada mensagem): todo o setter TEM de chamar invalidate.
import { cached, invalidate } from './cache';

export interface GuildConfig {
  ttsChannelId: string | null;
  autoread: boolean;
  defaultVoice: string;
  maxChars: number;
  ratePerMin: number;
  enabled: boolean;
  ttsRoleId: string | null;
  // Idioma da INTERFACE (texto) por guild. 'en' = default/base. Independente do
  // idioma da VOZ/TTS. Ver src/i18n. P16.1: coluna + storage; o comando de troca
  // e P16.3.
  locale: string;
  // xsaid: anunciar "{nome} disse" antes de cada mensagem lida (quem falou). LIGADO
  // por defeito (decisão do Diogo); desligável com /config xsaid. O anúncio é
  // localizado na língua da voz (spokenPhrases.said).
  xsaid: boolean;
  // autojoin: o Vozen entra sozinho no canal de voz do autor quando chega uma mensagem
  // para ler e ele ainda não está numa call. DESLIGADO por defeito (opt-in).
  autojoin: boolean;
  // readBots: ler mensagens de OUTROS bots/webhooks (ex.: bridges, notificações).
  // DESLIGADO por defeito (comportamento histórico: ignora bots). O próprio Vozen NUNCA
  // se lê a si mesmo, independentemente disto (anti-loop).
  readBots: boolean;
  // textInVoice: ler também as mensagens do chat de texto EMBUTIDO no canal de voz onde
  // o Vozen está (o texto dos canais de voz do Discord). DESLIGADO por defeito.
  textInVoice: boolean;
  // greetOnJoin: o Vozen diz "Olá {nome}" quando alguém ENTRA no canal de voz onde ele
  // está. LIGADO por defeito (desligável com /config greet). greetLocale = língua da
  // saudação (a principal é sempre inglês, 'en').
  greetOnJoin: boolean;
  greetLocale: string;
}

const DEFAULTS: GuildConfig = {
  ttsChannelId: null,
  autoread: false,
  // Vazio = a guild nao definiu voz default; a precedencia em resolveSynth cai
  // entao para config.defaultVoice (.env). Ver /config default-voice.
  defaultVoice: '',
  maxChars: 300,
  ratePerMin: 5,
  enabled: true,
  ttsRoleId: null,
  locale: DEFAULT_LOCALE, // 'en' — ingles como idioma da interface por defeito
  xsaid: true, // anunciar "{nome} disse" LIGADO por defeito
  autojoin: false, // entrar sozinho na call DESLIGADO por defeito (opt-in)
  readBots: false, // NÃO ler outros bots por defeito (comportamento histórico)
  textInVoice: false, // NÃO ler o chat-em-voz por defeito (opt-in)
  greetOnJoin: true, // saudar quem entra na call LIGADO por defeito
  greetLocale: DEFAULT_LOCALE, // 'en' — inglês como língua da saudação por defeito
};

interface GuildConfigRow {
  guild_id: string;
  tts_channel_id: string | null;
  autoread: number;
  default_voice: string;
  max_chars: number;
  rate_per_min: number;
  enabled: number;
  tts_role_id: string | null;
  locale: string | null;
  xsaid: number | null;
  autojoin: number | null;
  read_bots: number | null;
  text_in_voice: number | null;
  greet_on_join: number | null;
  greet_locale: string | null;
}

type SqlValue = string | number | null;

/**
 * Descritor de UMA coluna de guild_config. ACRESCENTAR UM CAMPO NOVO =
 *   1) uma entrada aqui,
 *   2) o campo em `GuildConfig`,
 *   3) o campo em `GuildConfigRow`,
 *   4) o default em `DEFAULTS`,
 *   5) a coluna no CREATE TABLE de `db.ts`.
 * Os testes de paridade em tests/store.test.ts rebentam se algum dos cinco
 * faltar — é esse o objetivo. A migração idempotente (ALTER) e o UPSERT são
 * DERIVADOS deste array; não há SQL escrito à mão por campo.
 */
interface GuildConfigColumn {
  /** nome da propriedade em GuildConfig */
  prop: keyof GuildConfig;
  /** nome da coluna SQL */
  column: string;
  /** tipo+constraints para o ALTER de migração (idêntico ao CREATE TABLE) */
  sqlType: string;
  /** JS -> SQL (booleans viram 1/0; strings/números/null passam tal e qual) */
  toDb: (v: unknown) => SqlValue;
  /** SQL -> JS com o fallback defensivo por-coluna (DBs antigas podem ter null) */
  fromDb: (raw: unknown) => unknown;
}

const asBool = (v: unknown): SqlValue => (v ? 1 : 0);
const asIs = (v: unknown): SqlValue => v as SqlValue;

// Ordem = ordem das colunas no CREATE TABLE (sem `guild_id`, que é a PK e é
// tratada à parte no INSERT/migração). Manter a ordem para diffs legíveis.
export const GUILD_CONFIG_COLUMNS: GuildConfigColumn[] = [
  { prop: 'ttsChannelId', column: 'tts_channel_id', sqlType: 'TEXT', toDb: asIs, fromDb: (r) => r },
  {
    prop: 'autoread',
    column: 'autoread',
    sqlType: 'INTEGER NOT NULL DEFAULT 0',
    toDb: asBool,
    fromDb: (r) => r === 1,
  },
  {
    prop: 'defaultVoice',
    column: 'default_voice',
    sqlType: "TEXT NOT NULL DEFAULT 'en_US-amy-medium'",
    toDb: asIs,
    fromDb: (r) => r,
  },
  {
    prop: 'maxChars',
    column: 'max_chars',
    sqlType: 'INTEGER NOT NULL DEFAULT 300',
    toDb: asIs,
    fromDb: (r) => r,
  },
  {
    prop: 'ratePerMin',
    column: 'rate_per_min',
    sqlType: 'INTEGER NOT NULL DEFAULT 5',
    toDb: asIs,
    fromDb: (r) => r,
  },
  {
    prop: 'enabled',
    column: 'enabled',
    sqlType: 'INTEGER NOT NULL DEFAULT 1',
    toDb: asBool,
    fromDb: (r) => r === 1,
  },
  { prop: 'ttsRoleId', column: 'tts_role_id', sqlType: 'TEXT', toDb: asIs, fromDb: (r) => r },
  {
    prop: 'locale',
    column: 'locale',
    sqlType: "TEXT NOT NULL DEFAULT 'en'",
    toDb: asIs,
    fromDb: (r) => r ?? DEFAULT_LOCALE,
  },
  {
    prop: 'xsaid',
    column: 'xsaid',
    sqlType: 'INTEGER NOT NULL DEFAULT 1',
    toDb: asBool,
    fromDb: (r) => (r == null ? DEFAULTS.xsaid : r === 1),
  },
  {
    prop: 'autojoin',
    column: 'autojoin',
    sqlType: 'INTEGER NOT NULL DEFAULT 0',
    toDb: asBool,
    fromDb: (r) => (r == null ? DEFAULTS.autojoin : r === 1),
  },
  {
    prop: 'readBots',
    column: 'read_bots',
    sqlType: 'INTEGER NOT NULL DEFAULT 0',
    toDb: asBool,
    fromDb: (r) => (r == null ? DEFAULTS.readBots : r === 1),
  },
  {
    prop: 'textInVoice',
    column: 'text_in_voice',
    sqlType: 'INTEGER NOT NULL DEFAULT 0',
    toDb: asBool,
    fromDb: (r) => (r == null ? DEFAULTS.textInVoice : r === 1),
  },
  {
    prop: 'greetOnJoin',
    column: 'greet_on_join',
    sqlType: 'INTEGER NOT NULL DEFAULT 1',
    toDb: asBool,
    fromDb: (r) => (r == null ? DEFAULTS.greetOnJoin : r === 1),
  },
  {
    prop: 'greetLocale',
    column: 'greet_locale',
    sqlType: "TEXT NOT NULL DEFAULT 'en'",
    toDb: asIs,
    fromDb: (r) => r ?? DEFAULTS.greetLocale,
  },
];

// UPSERT derivado do descritor (construído uma vez). Escreve TODAS as colunas em
// cada set — a semântica byte-a-byte do handwritten anterior: cada coluna via
// excluded.<coluna>, booleans já serializados a 1/0 pelo toDb.
const UPSERT_SQL = (() => {
  const cols = GUILD_CONFIG_COLUMNS.map((c) => c.column);
  const placeholders = ['?', ...cols.map(() => '?')].join(', ');
  const sets = cols.map((c) => `${c} = excluded.${c}`).join(',\n       ');
  return `INSERT INTO guild_config
       (guild_id, ${cols.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT(guild_id) DO UPDATE SET
       ${sets}`;
})();

export function getGuildConfig(db: Database.Database, guildId: string): GuildConfig {
  // Cópia rasa do valor cacheado: o chamador (ex.: setGuildConfig, /config show) não
  // deve mutar o objeto guardado na cache. O loader devolve o objeto imutável.
  return { ...cached(db, 'guild_config', guildId, () => loadGuildConfig(db, guildId)) };
}

function loadGuildConfig(db: Database.Database, guildId: string): GuildConfig {
  const row = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId) as
    GuildConfigRow | undefined;
  if (!row) return { ...DEFAULTS };
  // Mapeamento row->objeto guiado pelo descritor: cada coluna aplica o seu
  // fromDb (com o fallback defensivo por-coluna para DBs antigas com null).
  const out = {} as Record<string, unknown>;
  const raw = row as unknown as Record<string, unknown>;
  for (const col of GUILD_CONFIG_COLUMNS) {
    out[col.prop] = col.fromDb(raw[col.column]);
  }
  return out as unknown as GuildConfig;
}

export function resetGuildConfig(db: Database.Database, guildId: string): void {
  db.prepare('DELETE FROM guild_config WHERE guild_id = ?').run(guildId);
  invalidate(db, 'guild_config', guildId);
}

export function setGuildConfig(
  db: Database.Database,
  guildId: string,
  patch: Partial<GuildConfig>,
): void {
  const current = getGuildConfig(db, guildId);
  const next: GuildConfig = { ...current, ...patch };
  // Args na ordem do descritor (= ordem das colunas no UPSERT_SQL). O toDb de
  // cada coluna serializa (booleans -> 1/0; resto tal e qual).
  db.prepare(UPSERT_SQL).run(guildId, ...GUILD_CONFIG_COLUMNS.map((c) => c.toDb(next[c.prop])));
  invalidate(db, 'guild_config', guildId);
}
