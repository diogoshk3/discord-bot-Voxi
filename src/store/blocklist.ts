import type Database from 'better-sqlite3';
// Tabela CACHEADA (lida a cada mensagem): todo o setter TEM de chamar invalidate.
import { cached, invalidate } from './cache';

interface WordRow {
  word: string;
}

/** Teto de palavras bloqueadas por guild — limita crescimento e o custo de leitura por
 *  mensagem (cada palavra e um scan; ver moderation/filter). Admin-gated, mas nao ilimitado. */
export const MAX_BLOCKWORDS = 500;

export function getBlocklist(db: Database.Database, guildId: string): string[] {
  const words = cached(db, 'blocklist', guildId, () => {
    const rows = db
      .prepare('SELECT word FROM blocklist WHERE guild_id = ? ORDER BY word ASC')
      .all(guildId) as WordRow[];
    return rows.map((r) => r.word);
  });
  return [...words]; // cópia: o chamador não deve mutar o array cacheado
}

export function addBlockword(db: Database.Database, guildId: string, word: string): 'ok' | 'limit' {
  const { c } = db
    .prepare('SELECT COUNT(*) AS c FROM blocklist WHERE guild_id = ?')
    .get(guildId) as { c: number };
  if (c >= MAX_BLOCKWORDS) return 'limit';
  db.prepare(
    `INSERT INTO blocklist (guild_id, word) VALUES (?, ?)
     ON CONFLICT(guild_id, word) DO NOTHING`,
  ).run(guildId, word);
  invalidate(db, 'blocklist', guildId);
  return 'ok';
}

export function removeBlockword(db: Database.Database, guildId: string, word: string): void {
  db.prepare('DELETE FROM blocklist WHERE guild_id = ? AND word = ?').run(guildId, word);
  invalidate(db, 'blocklist', guildId);
}
