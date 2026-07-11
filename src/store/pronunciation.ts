import type Database from 'better-sqlite3';
import type { PronunciationEntry } from '../textCleaning/pronunciation';
// Tabela CACHEADA (lida a cada mensagem): todo o setter TEM de chamar invalidate.
import { cached, invalidate } from './cache';

// Dois dicionários de pronúncia:
//  • PESSOAL (/pronunciation, tabela pronunciation_user): só afeta as mensagens do
//    próprio autor; global (segue o user); limite 3 Free / 50 Premium.
//  • SERVIDOR (/serverpronunciation, tabela pronunciation): afeta TODA a guild (admin);
//    limite 3 Free / 50 com a guild Premium. No pipeline aplica-se a PESSOAL primeiro
//    (o termo do user ganha) e depois a de servidor.

/** Limites de pronúncias pessoais por plano. */
export const USER_PRON_LIMIT_FREE = 3;
export const USER_PRON_LIMIT_PREMIUM = 50;
/** Limites de pronúncias do SERVIDOR por plano da guild. */
export const SERVER_PRON_LIMIT = 3;
export const SERVER_PRON_LIMIT_PREMIUM = 50;

export type AddPronResult = 'ok' | 'limit';

// ── Dicionário de SERVIDOR (/serverpronunciation, admin) ──────────────────────────────

export function getServerPronunciations(
  db: Database.Database,
  guildId: string,
): PronunciationEntry[] {
  const rows = cached(db, 'pronunciation', guildId, () => {
    return db
      .prepare('SELECT term, replacement FROM pronunciation WHERE guild_id = ? ORDER BY term ASC')
      .all(guildId) as PronunciationEntry[];
  });
  return rows.map((e) => ({ ...e }));
}

/** Adiciona/edita uma pronúncia de servidor. Editar não conta para o limite (é UPDATE). */
export function addServerPronunciation(
  db: Database.Database,
  guildId: string,
  term: string,
  replacement: string,
  limit: number,
): AddPronResult {
  const exists = db
    .prepare('SELECT 1 FROM pronunciation WHERE guild_id = ? AND term = ?')
    .get(guildId, term);
  if (!exists) {
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM pronunciation WHERE guild_id = ?')
      .get(guildId) as { n: number };
    if (row.n >= limit) return 'limit';
  }
  db.prepare(
    `INSERT INTO pronunciation (guild_id, term, replacement) VALUES (?, ?, ?)
     ON CONFLICT(guild_id, term) DO UPDATE SET replacement = excluded.replacement`,
  ).run(guildId, term, replacement);
  invalidate(db, 'pronunciation', guildId);
  return 'ok';
}

/** Remove uma pronúncia de servidor. Devolve true se existia. */
export function removeServerPronunciation(
  db: Database.Database,
  guildId: string,
  term: string,
): boolean {
  const res = db
    .prepare('DELETE FROM pronunciation WHERE guild_id = ? AND term = ?')
    .run(guildId, term);
  if (res.changes > 0) invalidate(db, 'pronunciation', guildId);
  return res.changes > 0;
}

// ── Dicionário PESSOAL (/pronunciation) ───────────────────────────────────────────────

export function getUserPronunciations(db: Database.Database, userId: string): PronunciationEntry[] {
  const rows = cached(db, 'pronunciation_user', userId, () => {
    return db
      .prepare(
        'SELECT term, replacement FROM pronunciation_user WHERE user_id = ? ORDER BY term ASC',
      )
      .all(userId) as PronunciationEntry[];
  });
  return rows.map((e) => ({ ...e }));
}

export type AddUserPronResult = 'ok' | 'limit';

/**
 * Adiciona/edita uma pronúncia pessoal. EDITAR um termo existente nunca conta para o
 * limite (é UPDATE); só entradas NOVAS são bloqueadas quando o utilizador já está no cap.
 */
export function addUserPronunciation(
  db: Database.Database,
  userId: string,
  term: string,
  replacement: string,
  limit: number,
): AddUserPronResult {
  const exists = db
    .prepare('SELECT 1 FROM pronunciation_user WHERE user_id = ? AND term = ?')
    .get(userId, term);
  if (!exists) {
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM pronunciation_user WHERE user_id = ?')
      .get(userId) as { n: number };
    if (row.n >= limit) return 'limit';
  }
  db.prepare(
    `INSERT INTO pronunciation_user (user_id, term, replacement) VALUES (?, ?, ?)
     ON CONFLICT(user_id, term) DO UPDATE SET replacement = excluded.replacement`,
  ).run(userId, term, replacement);
  invalidate(db, 'pronunciation_user', userId);
  return 'ok';
}

/** Remove uma pronúncia pessoal. Devolve true se existia. */
export function removeUserPronunciation(
  db: Database.Database,
  userId: string,
  term: string,
): boolean {
  const res = db
    .prepare('DELETE FROM pronunciation_user WHERE user_id = ? AND term = ?')
    .run(userId, term);
  if (res.changes > 0) invalidate(db, 'pronunciation_user', userId);
  return res.changes > 0;
}
