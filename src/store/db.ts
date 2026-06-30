import Database from 'better-sqlite3';

export function initDb(path: string): Database.Database {
  let db: Database.Database;
  try {
    db = new Database(path);
    db.pragma('journal_mode = WAL');
  } catch (err) {
    // Mensagem clara em vez de stack trace cru (ex.: caminho invalido/sem permissoes).
    throw new Error(`Falha ao abrir a base de dados em ${path}: ${(err as Error).message}`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_voice (
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      voice_model TEXT NOT NULL,
      speed       REAL NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id       TEXT PRIMARY KEY,
      tts_channel_id TEXT,
      autoread       INTEGER NOT NULL DEFAULT 0,
      default_voice  TEXT NOT NULL DEFAULT 'en_US-amy-medium',
      max_chars      INTEGER NOT NULL DEFAULT 300,
      rate_per_min   INTEGER NOT NULL DEFAULT 5,
      enabled        INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS blocklist (
      guild_id TEXT NOT NULL,
      word     TEXT NOT NULL,
      PRIMARY KEY (guild_id, word)
    );
  `);

  return db;
}
