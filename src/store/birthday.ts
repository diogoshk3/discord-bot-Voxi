import type Database from 'better-sqlite3';

// Aniversário por-(guild,user): mês + dia (SEM ano — só interessa o dia do ano). Quando a
// pessoa ENTRA na call do Voxi no seu dia de anos, o Voxi diz "Parabéns {nome}" em vez da
// saudação normal (reaproveita o greetOnJoin — sem agendador). Ausente => sem parabéns.

export interface Birthday {
  month: number; // 1-12
  day: number; // 1-31 (validado contra o mês)
}

/** Dias máximos por mês (1-based). Fevereiro = 29 para permitir aniversários em 29/02. */
const MAX_DAY = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Data (mês/dia) válida como dia de aniversário? Ignora o ano (29/02 é aceite). PURA. */
export function isValidBirthday(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= MAX_DAY[month];
}

/** É hoje (mês/dia de `now`) o dia de anos `bd`? PURA — `now` injetável para testes. */
export function isBirthdayToday(bd: Birthday, now: Date): boolean {
  return bd.month === now.getMonth() + 1 && bd.day === now.getDate();
}

export function getBirthday(db: Database.Database, guildId: string, userId: string): Birthday | null {
  const row = db
    .prepare('SELECT month, day FROM user_birthday WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as { month: number; day: number } | undefined;
  if (!row || !isValidBirthday(row.month, row.day)) return null;
  return { month: row.month, day: row.day };
}

export function setBirthday(
  db: Database.Database,
  guildId: string,
  userId: string,
  month: number,
  day: number,
): void {
  db.prepare(
    `INSERT INTO user_birthday (guild_id, user_id, month, day)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET month = excluded.month, day = excluded.day`,
  ).run(guildId, userId, month, day);
}

export function clearBirthday(db: Database.Database, guildId: string, userId: string): void {
  db.prepare('DELETE FROM user_birthday WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}
