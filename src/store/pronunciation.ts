import type Database from 'better-sqlite3';
import type { PronunciationEntry } from '../textCleaning/pronunciation';
// Tabela CACHEADA (lida a cada mensagem): todo o setter TEM de chamar invalidate.
import { cached, invalidate } from './cache';

export function getPronunciations(db: Database.Database, guildId: string): PronunciationEntry[] {
  const rows = cached(db, 'pronunciation', guildId, () => {
    return db
      .prepare('SELECT term, replacement FROM pronunciation WHERE guild_id = ? ORDER BY term ASC')
      .all(guildId) as PronunciationEntry[];
  });
  return rows.map((e) => ({ ...e })); // cópia: o chamador não deve mutar o cacheado
}

export function addPronunciation(
  db: Database.Database,
  guildId: string,
  term: string,
  replacement: string,
): void {
  // Re-adicionar um termo existente edita o replacement (UPDATE, nao NOTHING como
  // na blocklist, que nao tem payload).
  db.prepare(
    `INSERT INTO pronunciation (guild_id, term, replacement) VALUES (?, ?, ?)
     ON CONFLICT(guild_id, term) DO UPDATE SET replacement = excluded.replacement`,
  ).run(guildId, term, replacement);
  invalidate(db, 'pronunciation', guildId);
}

export function removePronunciation(db: Database.Database, guildId: string, term: string): void {
  db.prepare('DELETE FROM pronunciation WHERE guild_id = ? AND term = ?').run(guildId, term);
  invalidate(db, 'pronunciation', guildId);
}

// ── Pronúncias PESSOAIS (/pronunciation) ──────────────────────────────────────────────
// Só se aplicam às mensagens do PRÓPRIO autor (aplicadas antes do dicionário da guild —
// como applyPronunciation corre por ordem, o termo do user ganha ao da guild). Globais:
// seguem o utilizador para qualquer servidor, como as user_abbreviation. Limite (3 Free /
// 50 Premium) decidido no handler e imposto aqui via parâmetro.

/** Limites de pronúncias pessoais por plano. */
export const USER_PRON_LIMIT_FREE = 3;
export const USER_PRON_LIMIT_PREMIUM = 50;

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
