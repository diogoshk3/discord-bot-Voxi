import type Database from 'better-sqlite3';

// "Server chatterboxes": counts how many messages from each person Vozen has READ (auto-read)
// per-(guild,user) and a STREAK of consecutive days with at least one message read. Feeds
// /topspeakers. The streak is based on the server's LOCAL day (key 'YYYY-MM-DD').

export interface TalkRow {
  userId: string;
  count: number;
  streak: number;
  bestStreak: number;
}

interface DbRow {
  user_id: string;
  spoken_count: number;
  streak: number;
  best_streak: number;
  last_date: string;
}

/** LOCAL day key 'YYYY-MM-DD' from a Date. PURE. */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Key of the day `n` days BEFORE `d` (DST-safe: uses components, not ms subtraction). PURE. */
export function dayKeyMinus(d: Date, n: number): string {
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));
}

/** Key of the day BEFORE `d` (DST-safe). PURE. */
export function prevDateKey(d: Date): string {
  return dayKeyMinus(d, 1);
}

/**
 * LIVE streak on the reference day `now` (Duolingo-style rules). The stored `streak` is only
 * updated when the person speaks (`bumpTalk`), so between messages it stays STATIC —
 * this function corrects it to today's REAL value:
 *  - spoke today, yesterday OR the day before (1 missed day, within the "freeze") => streak intact;
 *  - 3+ days without speaking (2 CONSECUTIVE missed days) => 0 (lost forever).
 * Symmetric with `bumpTalk`: this one continues the streak for gaps <= 2 and resets for gaps >= 3.
 * PURE.
 */
export function effectiveStreak(lastDate: string, storedStreak: number, now: Date): number {
  const today = dateKey(now);
  const y1 = dayKeyMinus(now, 1);
  const y2 = dayKeyMinus(now, 2);
  return lastDate === today || lastDate === y1 || lastDate === y2 ? storedStreak : 0;
}

/** Result of `bumpTalk`: whether this was the FIRST message of the day (for the streak 🔥
 * notice) and the CURRENT streak of consecutive days. */
export interface TalkBump {
  firstOfDay: boolean;
  streak: number;
}

/**
 * Records ONE read message from `userId` on day `now`: +1 to the count and updates the streak
 * — stays the same if already spoke today, +1 if spoke yesterday, resets to 1 otherwise. Also
 * updates the best streak. UPSERT (creates the row on the first message). `now` injectable.
 * Returns `{ firstOfDay, streak }` — the caller uses it for the streak notice (only on the 1st
 * message of each day).
 */
export function bumpTalk(
  db: Database.Database,
  guildId: string,
  userId: string,
  now: Date,
): TalkBump {
  const today = dateKey(now);
  const y1 = dayKeyMinus(now, 1); // yesterday
  const y2 = dayKeyMinus(now, 2); // day before yesterday (== 1 missed day -> freeze)
  const row = db
    .prepare(
      'SELECT spoken_count, streak, best_streak, last_date FROM talk_stats WHERE guild_id = ? AND user_id = ?',
    )
    .get(guildId, userId) as Omit<DbRow, 'user_id'> | undefined;

  if (!row) {
    db.prepare(
      `INSERT INTO talk_stats (guild_id, user_id, spoken_count, streak, best_streak, last_date)
       VALUES (?, ?, 1, 1, 1, ?)`,
    ).run(guildId, userId, today);
    return { firstOfDay: true, streak: 1 };
  }

  // firstOfDay = had not yet spoken TODAY (the last message is from another day).
  const firstOfDay = row.last_date !== today;
  // Duolingo rules: missing 1 day does NOT break the streak (freeze — the missed day doesn't
  // count, but today adds +1); missing 2 CONSECUTIVE days (gap >= 3) loses everything -> restarts at 1.
  let streak: number;
  if (row.last_date === today)
    streak = row.streak; // already counted today
  else if (row.last_date === y1 || row.last_date === y2)
    streak = row.streak + 1; // consecutive day OR 1 missed day (freeze) -> continues
  else streak = 1; // 2+ consecutive missed days (or future dates) -> loses
  const best = Math.max(row.best_streak, streak);

  db.prepare(
    `UPDATE talk_stats
     SET spoken_count = spoken_count + 1, streak = ?, best_streak = ?, last_date = ?
     WHERE guild_id = ? AND user_id = ?`,
  ).run(streak, best, today, guildId, userId);
  return { firstOfDay, streak };
}

/**
 * Top `limit` of this guild's leaderboard: ranked by MESSAGE COUNT (`spoken_count`) desc,
 * tie-broken by DAYS of LIVE streak (`effectiveStreak` at `now`) desc. The count is the
 * headline ("who talks the most"); the streak is kept as decoration (the 🔥) and the
 * tiebreaker. The live streak is still computed per row so the UI can show it and a DEAD
 * streak (3+ days silent) renders as 0. Fetches all rows of the guild and sorts in JS (the
 * live streak depends on `now`, can't be sorted in SQL). `now` injectable for tests.
 */
export function getTopSpeakers(
  db: Database.Database,
  guildId: string,
  now: Date,
  limit = 10,
): TalkRow[] {
  const rows = db
    .prepare(
      `SELECT user_id, spoken_count, streak, best_streak, last_date FROM talk_stats
       WHERE guild_id = ?`,
    )
    .all(guildId) as DbRow[];
  return rows
    .map((r) => ({
      userId: r.user_id,
      count: r.spoken_count,
      streak: effectiveStreak(r.last_date, r.streak, now),
      bestStreak: r.best_streak,
    }))
    .sort((a, b) => b.count - a.count || b.streak - a.streak)
    .slice(0, limit);
}
