import type Database from 'better-sqlite3';
import type { PronunciationEntry } from '../textCleaning/pronunciation';

export function getPronunciations(db: Database.Database, guildId: string): PronunciationEntry[] {
  const rows = db
    .prepare('SELECT term, replacement FROM pronunciation WHERE guild_id = ? ORDER BY term ASC')
    .all(guildId) as PronunciationEntry[];
  return rows;
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
}

export function removePronunciation(db: Database.Database, guildId: string, term: string): void {
  db.prepare('DELETE FROM pronunciation WHERE guild_id = ? AND term = ?').run(guildId, term);
}
