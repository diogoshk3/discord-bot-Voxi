import type Database from 'better-sqlite3';

// "Tagarelas do servidor": conta quantas mensagens de cada pessoa o Vozen LEU (auto-read)
// por-(guild,user) e um STREAK de dias seguidos com pelo menos uma mensagem lida. Alimenta
// o /topspeakers. O streak baseia-se no dia LOCAL do servidor (chave 'YYYY-MM-DD').

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

/** Chave de dia LOCAL 'YYYY-MM-DD' de uma Date. PURA. */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Chave do dia ANTERIOR a `d` (DST-safe: usa componentes, não subtração de ms). PURA. */
export function prevDateKey(d: Date): string {
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
}

/**
 * Regista UMA mensagem lida de `userId` no dia `now`: +1 na contagem e atualiza o streak
 * — mantém-se se já falou hoje, +1 se falou ontem, reinicia a 1 caso contrário. Atualiza
 * também o melhor streak. UPSERT (cria a linha na primeira mensagem). `now` injetável.
 */
export function bumpTalk(db: Database.Database, guildId: string, userId: string, now: Date): void {
  const today = dateKey(now);
  const yesterday = prevDateKey(now);
  const row = db
    .prepare('SELECT spoken_count, streak, best_streak, last_date FROM talk_stats WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as Omit<DbRow, 'user_id'> | undefined;

  if (!row) {
    db.prepare(
      `INSERT INTO talk_stats (guild_id, user_id, spoken_count, streak, best_streak, last_date)
       VALUES (?, ?, 1, 1, 1, ?)`,
    ).run(guildId, userId, today);
    return;
  }

  let streak: number;
  if (row.last_date === today) streak = row.streak; // já contou hoje
  else if (row.last_date === yesterday) streak = row.streak + 1; // dia seguido
  else streak = 1; // houve um intervalo (ou datas do futuro) -> recomeça
  const best = Math.max(row.best_streak, streak);

  db.prepare(
    `UPDATE talk_stats
     SET spoken_count = spoken_count + 1, streak = ?, best_streak = ?, last_date = ?
     WHERE guild_id = ? AND user_id = ?`,
  ).run(streak, best, today, guildId, userId);
}

/** Top `limit` tagarelas desta guild por contagem (desc), depois melhor streak (desc). */
export function getTopSpeakers(db: Database.Database, guildId: string, limit = 10): TalkRow[] {
  const rows = db
    .prepare(
      `SELECT user_id, spoken_count, streak, best_streak FROM talk_stats
       WHERE guild_id = ?
       ORDER BY spoken_count DESC, best_streak DESC
       LIMIT ?`,
    )
    .all(guildId, limit) as DbRow[];
  return rows.map((r) => ({
    userId: r.user_id,
    count: r.spoken_count,
    streak: r.streak,
    bestStreak: r.best_streak,
  }));
}
