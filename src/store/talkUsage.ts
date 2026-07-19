import type Database from 'better-sqlite3';
import type { UserEngine } from './userVoice';

// Aggregate-only usage for the owner dashboard. No message content is stored: one counter per
// (guild, user, voice locale, resolved engine). It complements talk_stats, whose unit is also one
// message accepted by the anti-inflation count gate.

const VALID_ENGINES = new Set<UserEngine>(['google', 'piper', 'kokoro', 'gcloud']);
const DEFAULT_MODEL = 'en_US-amy-medium';

function normalizeEngine(engine: string | null | undefined): UserEngine {
  return VALID_ENGINES.has(engine as UserEngine) ? (engine as UserEngine) : 'google';
}

/** Locale embedded in a voice id (`pt_PT-tugao-medium` -> `pt_PT`). */
export function voiceLocale(model: string): string {
  const locale = (model || '').split('-', 1)[0]?.trim();
  return locale || 'unknown';
}

/** Records the resolved base language + engine for one message counted in talk_stats. */
export function bumpTalkUsage(
  db: Database.Database,
  guildId: string,
  userId: string,
  model: string,
  engine: UserEngine,
): void {
  db.prepare(
    `INSERT INTO talk_usage (guild_id, user_id, language, engine, spoken_count)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(guild_id, user_id, language, engine)
     DO UPDATE SET spoken_count = spoken_count + 1`,
  ).run(guildId, userId, voiceLocale(model), normalizeEngine(engine));
}

export interface DominantTalkUsage {
  language: string | null;
  engine: UserEngine | null;
}

type UsageRow = {
  guild_id: string;
  user_id: string;
  language: string;
  engine: string;
  spoken_count: number;
};

type LegacyRow = {
  guild_id: string;
  user_id: string;
  spoken_count: number;
  tracked_count: number;
  voice_model: string;
  engine: string;
};

function addCount<T extends string>(map: Map<T, number>, key: T, count: number): void {
  map.set(key, (map.get(key) ?? 0) + count);
}

function winner<T extends string>(counts: Map<T, number>): T | null {
  let best: T | null = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount || (count === bestCount && (best === null || key < best))) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Dominant language and engine for each requested user, aggregated across every guild.
 *
 * `talk_usage` is exact from the migration onwards. Older talk_stats rows predate that counter;
 * their remaining count is attributed to the user's current per-guild voice (or guild/default
 * voice) so the existing top 10 is useful immediately. As new messages arrive, the exact rows
 * replace that legacy estimate one-for-one (`spoken_count - tracked_count`).
 */
export function getDominantTalkUsage(
  db: Database.Database,
  userIds: string[],
): Map<string, DominantTalkUsage> {
  const ids = [...new Set(userIds)].filter(Boolean);
  const result = new Map<string, DominantTalkUsage>();
  if (ids.length === 0) return result;

  const placeholders = ids.map(() => '?').join(',');
  const usage = db
    .prepare(
      `SELECT guild_id, user_id, language, engine, spoken_count
       FROM talk_usage WHERE user_id IN (${placeholders})`,
    )
    .all(...ids) as UsageRow[];

  const legacy = db
    .prepare(
      `SELECT ts.guild_id, ts.user_id, ts.spoken_count,
              COALESCE(tracked.total, 0) AS tracked_count,
              COALESCE(uv.voice_model, gc.default_voice, ?) AS voice_model,
              COALESCE(uv.engine, 'google') AS engine
       FROM talk_stats ts
       LEFT JOIN (
         SELECT guild_id, user_id, SUM(spoken_count) AS total
         FROM talk_usage GROUP BY guild_id, user_id
       ) tracked ON tracked.guild_id = ts.guild_id AND tracked.user_id = ts.user_id
       LEFT JOIN user_voice uv ON uv.guild_id = ts.guild_id AND uv.user_id = ts.user_id
       LEFT JOIN guild_config gc ON gc.guild_id = ts.guild_id
       WHERE ts.user_id IN (${placeholders})`,
    )
    .all(DEFAULT_MODEL, ...ids) as LegacyRow[];

  const languages = new Map<string, Map<string, number>>();
  const engines = new Map<string, Map<UserEngine, number>>();
  const buckets = (userId: string) => {
    let lang = languages.get(userId);
    if (!lang) languages.set(userId, (lang = new Map()));
    let engine = engines.get(userId);
    if (!engine) engines.set(userId, (engine = new Map()));
    return { lang, engine };
  };

  for (const row of usage) {
    const count = Math.max(0, Number(row.spoken_count) || 0);
    const b = buckets(row.user_id);
    addCount(b.lang, row.language, count);
    addCount(b.engine, normalizeEngine(row.engine), count);
  }

  for (const row of legacy) {
    const remaining = Math.max(
      0,
      (Number(row.spoken_count) || 0) - (Number(row.tracked_count) || 0),
    );
    if (remaining === 0) continue;
    const b = buckets(row.user_id);
    addCount(b.lang, voiceLocale(row.voice_model), remaining);
    addCount(b.engine, normalizeEngine(row.engine), remaining);
  }

  for (const userId of ids) {
    result.set(userId, {
      language: winner(languages.get(userId) ?? new Map()),
      engine: winner(engines.get(userId) ?? new Map()),
    });
  }
  return result;
}
