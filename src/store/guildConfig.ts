import type Database from 'better-sqlite3';

export interface GuildConfig {
  ttsChannelId: string | null;
  autoread: boolean;
  defaultVoice: string;
  maxChars: number;
  ratePerMin: number;
  enabled: boolean;
  ttsRoleId: string | null;
}

const DEFAULTS: GuildConfig = {
  ttsChannelId: null,
  autoread: false,
  defaultVoice: 'en_US-amy-medium',
  maxChars: 300,
  ratePerMin: 5,
  enabled: true,
  ttsRoleId: null,
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
  };
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
       (guild_id, tts_channel_id, autoread, default_voice, max_chars, rate_per_min, enabled, tts_role_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       tts_channel_id = excluded.tts_channel_id,
       autoread       = excluded.autoread,
       default_voice  = excluded.default_voice,
       max_chars      = excluded.max_chars,
       rate_per_min   = excluded.rate_per_min,
       enabled        = excluded.enabled,
       tts_role_id    = excluded.tts_role_id`,
  ).run(
    guildId,
    next.ttsChannelId,
    next.autoread ? 1 : 0,
    next.defaultVoice,
    next.maxChars,
    next.ratePerMin,
    next.enabled ? 1 : 0,
    next.ttsRoleId,
  );
}
