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
        enabled        INTEGER NOT NULL DEFAULT 1,
        tts_role_id    TEXT,
        locale         TEXT NOT NULL DEFAULT 'en'
      );

      CREATE TABLE IF NOT EXISTS blocklist (
        guild_id TEXT NOT NULL,
        word     TEXT NOT NULL,
        PRIMARY KEY (guild_id, word)
      );

      CREATE TABLE IF NOT EXISTS pronunciation (
        guild_id    TEXT NOT NULL,
        term        TEXT NOT NULL,
        replacement TEXT NOT NULL,
        PRIMARY KEY (guild_id, term)
      );

      CREATE TABLE IF NOT EXISTS tts_optout (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS user_abbreviation (
        user_id     TEXT NOT NULL,
        term        TEXT NOT NULL,
        replacement TEXT NOT NULL,
        PRIMARY KEY (user_id, term)
      );

      -- Toggle da DETECAO AUTOMATICA de lingua por-(guild,user). Espelha tts_optout:
      -- a deteccao esta LIGADA por defeito, por isso so guardamos os utilizadores que
      -- a DESLIGARAM (uma linha aqui => deteccao OFF; sem linha => ON).
      CREATE TABLE IF NOT EXISTS tts_lang_detect_off (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
    `);

    // Migracao idempotente para DBs criadas antes da coluna tts_role_id existir.
    // O CREATE TABLE IF NOT EXISTS acima nao altera tabelas ja existentes, por isso
    // verificamos o esquema e adicionamos a coluna so quando falta (no-op em DBs novas).
    const cols = db.pragma('table_info(guild_config)') as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'tts_role_id')) {
      db.exec('ALTER TABLE guild_config ADD COLUMN tts_role_id TEXT');
    }
    // Migracao idempotente da coluna `locale` (P16.1): idioma da INTERFACE por
    // guild. DEFAULT 'en' faz as linhas antigas lerem 'en' (ingles como base),
    // nao NULL — ao contrario da migracao tts_role_id (que quer NULL). No-op em
    // DBs novas (o CREATE TABLE ja inclui a coluna).
    if (!cols.some((c) => c.name === 'locale')) {
      db.exec("ALTER TABLE guild_config ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'");
    }

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
