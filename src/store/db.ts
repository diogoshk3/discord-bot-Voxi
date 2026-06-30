import Database from 'better-sqlite3';

export function initDb(path: string): Database.Database {
  let db: Database.Database | undefined;
  try {
    // O try cobre ABRIR e o schema inicial: um ficheiro corrompido/que-nao-e-DB
    // deixa `new Database()` passar (validacao lazy) e so rebenta em db.exec com
    // "file is not a database". Sem isto, esse caso daria stack trace cru.
    db = new Database(path);
    db.pragma('journal_mode = WAL');

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
  } catch (err) {
    // Se abrimos o handle antes de o schema falhar, fechamo-lo para nao deixar o
    // ficheiro bloqueado (Windows) nem o handle pendurado.
    try {
      db?.close();
    } catch {
      // ignorar
    }
    // Mensagem clara em vez de stack trace cru (caminho invalido/sem permissoes,
    // ou ficheiro existente que nao e uma base de dados SQLite valida).
    throw new Error(`Falha ao abrir a base de dados em ${path}: ${(err as Error).message}`);
  }
}
