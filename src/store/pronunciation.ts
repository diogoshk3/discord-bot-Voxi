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
