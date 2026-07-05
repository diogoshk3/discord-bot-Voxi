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
        engine      TEXT NOT NULL DEFAULT 'google',
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
        locale         TEXT NOT NULL DEFAULT 'en',
        xsaid          INTEGER NOT NULL DEFAULT 1,
        autojoin       INTEGER NOT NULL DEFAULT 0,
        read_bots      INTEGER NOT NULL DEFAULT 0,
        text_in_voice  INTEGER NOT NULL DEFAULT 0,
        greet_on_join  INTEGER NOT NULL DEFAULT 1,
        greet_locale   TEXT NOT NULL DEFAULT 'en'
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

      -- (LEGADO) Tabela antiga do toggle de deteccao quando o default era ON: guardava
      -- quem a DESLIGOU. Ja NAO e lida (ver tts_lang_detect_on abaixo). Mantida so para
      -- nao falhar em DBs antigas; pode ser removida numa limpeza futura.
      CREATE TABLE IF NOT EXISTS tts_lang_detect_off (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      -- Toggle da DETECAO AUTOMATICA de lingua por-(guild,user). O DEFAULT passou a
      -- OFF (voz UNICA fixa para todas as linguas — a pessoa parece a mesma). Por isso
      -- guardamos agora quem a LIGOU (opt-in): uma linha aqui => deteccao ON (voz
      -- nativa por lingua, pode trocar de locutor); sem linha => OFF (voz fixa).
      CREATE TABLE IF NOT EXISTS tts_lang_detect_on (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      -- Apelido FONETICO por-(guild,user) para o xsaid: como a pessoa quer ser CHAMADA
      -- em voz alta (nomes com emojis/simbolos sao ilegiveis). Sem linha => usa o
      -- displayName sanitizado. Ver /voice nickname.
      CREATE TABLE IF NOT EXISTS user_nickname (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        nickname TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      -- Leaderboard dos minijogos (/game) por-(guild,user). A coluna points acumula os
      -- pontos ganhos em todas as partidas; wins conta quantas PARTIDAS a pessoa venceu
      -- (foi a que mais pontuou nessa partida). Tabela NOVA: o CREATE IF NOT EXISTS cobre
      -- tanto DBs novas como antigas (sem coluna a migrar), por isso nao ha ALTER abaixo.
      CREATE TABLE IF NOT EXISTS game_score (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        points   INTEGER NOT NULL DEFAULT 0,
        wins     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );

      -- Persona de fala por-(guild,user): estilo com que o Voxi le as mensagens da pessoa
      -- (pirate/uwu/yoda/cowboy/medieval). Sem linha => 'none' (leitura normal). Tabela
      -- NOVA: o CREATE IF NOT EXISTS cobre DBs novas e antigas, sem coluna a migrar.
      CREATE TABLE IF NOT EXISTS user_persona (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        persona  TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      -- Aniversário por-(guild,user): mês + dia (sem ano). Quando a pessoa entra na call
      -- do Voxi no seu dia de anos, ele diz "Parabéns {nome}". Tabela NOVA (CREATE IF NOT
      -- EXISTS cobre DBs novas e antigas).
      CREATE TABLE IF NOT EXISTS user_birthday (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        month    INTEGER NOT NULL,
        day      INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      -- "Tagarelas": quantas mensagens de cada pessoa o Voxi leu (auto-read) + streak de
      -- dias seguidos. Alimenta o /topspeakers. last_date = chave 'YYYY-MM-DD' do dia local
      -- da última mensagem. Tabela NOVA (CREATE IF NOT EXISTS cobre DBs novas e antigas).
      CREATE TABLE IF NOT EXISTS talk_stats (
        guild_id     TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        spoken_count INTEGER NOT NULL DEFAULT 0,
        streak       INTEGER NOT NULL DEFAULT 0,
        best_streak  INTEGER NOT NULL DEFAULT 0,
        last_date    TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (guild_id, user_id)
      );

      -- Voxi Premium por-servidor: expira em expires_at (unix ms). Sem linha OU expirado
      -- => Free. source regista a origem (redeem/kofi/manual). Só features NOVAS sao
      -- gated por isto; nada do que ja e gratis passa a pago.
      CREATE TABLE IF NOT EXISTS premium_guild (
        guild_id   TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        source     TEXT NOT NULL DEFAULT ''
      );

      -- Voxi Plus por-utilizador (perks pessoais que seguem a pessoa entre servidores).
      CREATE TABLE IF NOT EXISTS premium_user (
        user_id    TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        source     TEXT NOT NULL DEFAULT ''
      );

      -- Códigos de resgate (Ko-fi/Patreon): gerados offline, resgatados 1x com /redeem.
      -- kind = 'guild'|'user'; days = duração; used_by/used_at NULL enquanto por usar.
      CREATE TABLE IF NOT EXISTS redeem_code (
        code       TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        days       INTEGER NOT NULL,
        used_by    TEXT,
        used_at    INTEGER,
        created_at INTEGER NOT NULL
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
    // Migracao idempotente do `xsaid` (Vaga 1): anuncia "{nome} disse" antes de cada
    // mensagem. DEFAULT 1 (LIGADO) — e o ADD COLUMN com default CONSTANTE faz o SQLite
    // preencher TODAS as linhas existentes com 1 (backfill), por isso as guilds atuais
    // ficam com xsaid ON, nao NULL. No-op em DBs novas (o CREATE TABLE ja tem a coluna).
    if (!cols.some((c) => c.name === 'xsaid')) {
      db.exec('ALTER TABLE guild_config ADD COLUMN xsaid INTEGER NOT NULL DEFAULT 1');
    }
    // Migracao idempotente do `autojoin` (Vaga 2): o bot entra sozinho na call quando
    // chega mensagem para ler. DEFAULT 0 (DESLIGADO) — opt-in, para nao surpreender
    // (o bot so entra se o admin quiser). No-op em DBs novas.
    if (!cols.some((c) => c.name === 'autojoin')) {
      db.exec('ALTER TABLE guild_config ADD COLUMN autojoin INTEGER NOT NULL DEFAULT 0');
    }
    // Migracao idempotente do `read_bots` (Vaga 2): ler mensagens de outros bots/
    // webhooks. DEFAULT 0 (NAO ler bots — o comportamento historico). No-op em DBs novas.
    if (!cols.some((c) => c.name === 'read_bots')) {
      db.exec('ALTER TABLE guild_config ADD COLUMN read_bots INTEGER NOT NULL DEFAULT 0');
    }
    // Migracao idempotente do `text_in_voice` (Vaga 2): ler tambem as mensagens do chat
    // de texto DENTRO do canal de voz onde o Voxi esta. DEFAULT 0 (desligado). No-op novas.
    if (!cols.some((c) => c.name === 'text_in_voice')) {
      db.exec('ALTER TABLE guild_config ADD COLUMN text_in_voice INTEGER NOT NULL DEFAULT 0');
    }
    // Saudacao de voz ao entrar na call. DEFAULT 1 (LIGADO — pedido do Diogo: vem
    // ligada por defeito, desligavel). greet_locale = lingua da saudacao (DEFAULT 'en',
    // a principal e sempre ingles). ADD COLUMN com default constante backfilla as linhas
    // existentes. No-op em DBs novas (o CREATE ja inclui as colunas).
    if (!cols.some((c) => c.name === 'greet_on_join')) {
      db.exec('ALTER TABLE guild_config ADD COLUMN greet_on_join INTEGER NOT NULL DEFAULT 1');
    }
    if (!cols.some((c) => c.name === 'greet_locale')) {
      db.exec("ALTER TABLE guild_config ADD COLUMN greet_locale TEXT NOT NULL DEFAULT 'en'");
    }
    // Migracao idempotente do `engine` no user_voice: motor por-utilizador (google/piper).
    // DEFAULT 'google' -> as vozes ja gravadas ficam no motor Google (backfill). No-op novas.
    const uvCols = db.pragma('table_info(user_voice)') as Array<{ name: string }>;
    if (!uvCols.some((c) => c.name === 'engine')) {
      db.exec("ALTER TABLE user_voice ADD COLUMN engine TEXT NOT NULL DEFAULT 'google'");
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
