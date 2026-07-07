import Database from 'better-sqlite3';
import { GUILD_CONFIG_COLUMNS } from './guildConfig';

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

      -- Aniversário por-(guild,user): mês + dia (sem ano). Quando a pessoa entra na call
      -- do Vozen no seu dia de anos, ele diz "Parabéns {nome}". Tabela NOVA (CREATE IF NOT
      -- EXISTS cobre DBs novas e antigas).
      CREATE TABLE IF NOT EXISTS user_birthday (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        month    INTEGER NOT NULL,
        day      INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      -- "Tagarelas": quantas mensagens de cada pessoa o Vozen leu (auto-read) + streak de
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

      -- Vozen Premium por-servidor: expira em expires_at (unix ms). Sem linha OU expirado
      -- => Free. source regista a origem (redeem/kofi/manual). Só features NOVAS sao
      -- gated por isto; nada do que ja e gratis passa a pago.
      CREATE TABLE IF NOT EXISTS premium_guild (
        guild_id   TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        source     TEXT NOT NULL DEFAULT ''
      );

      -- Vozen Plus por-utilizador (perks pessoais que seguem a pessoa entre servidores).
      CREATE TABLE IF NOT EXISTS premium_user (
        user_id    TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        source     TEXT NOT NULL DEFAULT ''
      );

      -- Efeito de voz por-(guild,user): filtro ffmpeg aplicado ao TTS da pessoa (premium,
      -- com 2 amostras gratis). Sem linha => 'none' (voz limpa). Tabela NOVA.
      CREATE TABLE IF NOT EXISTS user_effect (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        effect   TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      -- Clone de voz por-UTILIZADOR (global). O DONO (user_id) e quem gravou e vai FALAR
      -- com esta voz; target_id e a pessoa cuja VOZ foi gravada (== user_id num auto-clone;
      -- diferente quando A grava a voz de B com o consentimento de B). consent_at regista o
      -- consentimento. O dono usa/apaga o seu clone; ALEM disso, a pessoa gravada (target_id)
      -- pode SEMPRE revogar (apagar) qualquer clone feito a partir da sua voz (RGPD).
      CREATE TABLE IF NOT EXISTS user_clone (
        user_id     TEXT PRIMARY KEY,
        sample_path TEXT NOT NULL,
        consent_at  INTEGER NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 0,
        target_id   TEXT NOT NULL DEFAULT ''
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

    // Migracoes idempotentes de guild_config GUIADAS PELO DESCRITOR
    // (GUILD_CONFIG_COLUMNS em ./guildConfig): qualquer coluna do descritor que falte
    // numa DB antiga e adicionada com o MESMO tipo/default do CREATE TABLE — o ALTER com
    // default CONSTANTE backfilla TODAS as linhas existentes (ex.: xsaid=1, autojoin=0).
    // As 6 colunas originais estao sempre presentes -> essas iteracoes sao no-op. Acrescentar
    // um campo novo ao descritor passa a migrar-se sozinho (era ~1 bloco if por campo).
    const cols = db.pragma('table_info(guild_config)') as Array<{ name: string }>;
    for (const col of GUILD_CONFIG_COLUMNS) {
      if (!cols.some((c) => c.name === col.column)) {
        db.exec(`ALTER TABLE guild_config ADD COLUMN ${col.column} ${col.sqlType}`);
      }
    }
    // Migracao idempotente do `engine` no user_voice: motor por-utilizador (google/piper).
    // DEFAULT 'google' -> as vozes ja gravadas ficam no motor Google (backfill). No-op novas.
    const uvCols = db.pragma('table_info(user_voice)') as Array<{ name: string }>;
    if (!uvCols.some((c) => c.name === 'engine')) {
      db.exec("ALTER TABLE user_voice ADD COLUMN engine TEXT NOT NULL DEFAULT 'google'");
    }
    // Migracao idempotente do `target_id` no user_clone (Fase 2 de compliance): a pessoa
    // cuja voz foi gravada pode revogar o clone. Nas linhas ANTIGAS nao sabiamos o alvo,
    // por isso o backfill assume auto-clone (target_id = user_id) — o dono continua a poder
    // apagar, e como target == dono a revogacao coincide. No-op em DBs novas (CREATE ja tem).
    const ucCols = db.pragma('table_info(user_clone)') as Array<{ name: string }>;
    if (!ucCols.some((c) => c.name === 'target_id')) {
      db.exec("ALTER TABLE user_clone ADD COLUMN target_id TEXT NOT NULL DEFAULT ''");
      db.exec("UPDATE user_clone SET target_id = user_id WHERE target_id = ''");
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
    throw new Error(`Falha ao abrir a base de dados em ${path}: ${(err as Error).message}`, {
      cause: err,
    });
  }
}
