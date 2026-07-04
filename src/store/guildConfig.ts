import type Database from 'better-sqlite3';
import { DEFAULT_LOCALE } from '../i18n/index';

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
  // autojoin: o Voxi entra sozinho no canal de voz do autor quando chega uma mensagem
  // para ler e ele ainda não está numa call. DESLIGADO por defeito (opt-in).
  autojoin: boolean;
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
}

export function getGuildConfig(db: Database.Database, guildId: string): GuildConfig {
  const row = db
    .prepare('SELECT * FROM guild_config WHERE guild_id = ?')
    .get(guildId) as GuildConfigRow | undefined;
  if (!row) return { ...DEFAULTS };
  return {
    ttsChannelId: row.tts_channel_id,
    autoread: row.autoread === 1,
    defaultVoice: row.default_voice,
    maxChars: row.max_chars,
    ratePerMin: row.rate_per_min,
    enabled: row.enabled === 1,
    ttsRoleId: row.tts_role_id,
    // Belt-and-suspenders: a coluna e NOT NULL DEFAULT 'en', mas se por algum
    // motivo vier null (ex. migracao antiga) caimos no default.
    locale: row.locale ?? DEFAULT_LOCALE,
    // NOT NULL DEFAULT 1; null defensivo (DB antiga) => default ON.
    xsaid: row.xsaid == null ? DEFAULTS.xsaid : row.xsaid === 1,
    // NOT NULL DEFAULT 0; null defensivo (DB antiga) => default OFF.
    autojoin: row.autojoin == null ? DEFAULTS.autojoin : row.autojoin === 1,
  };
}

export function resetGuildConfig(db: Database.Database, guildId: string): void {
  db.prepare('DELETE FROM guild_config WHERE guild_id = ?').run(guildId);
}

export function setGuildConfig(
  db: Database.Database,
  guildId: string,
  patch: Partial<GuildConfig>,
): void {
  const current = getGuildConfig(db, guildId);
  const next: GuildConfig = { ...current, ...patch };
  db.prepare(
    `INSERT INTO guild_config
       (guild_id, tts_channel_id, autoread, default_voice, max_chars, rate_per_min, enabled, tts_role_id, locale, xsaid, autojoin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       tts_channel_id = excluded.tts_channel_id,
       autoread       = excluded.autoread,
       default_voice  = excluded.default_voice,
       max_chars      = excluded.max_chars,
       rate_per_min   = excluded.rate_per_min,
       enabled        = excluded.enabled,
       tts_role_id    = excluded.tts_role_id,
       locale         = excluded.locale,
       xsaid          = excluded.xsaid,
       autojoin       = excluded.autojoin`,
  ).run(
    guildId,
    next.ttsChannelId,
    next.autoread ? 1 : 0,
    next.defaultVoice,
    next.maxChars,
    next.ratePerMin,
    next.enabled ? 1 : 0,
    next.ttsRoleId,
    next.locale,
    next.xsaid ? 1 : 0,
    next.autojoin ? 1 : 0,
  );
}
