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
        rate_per_min   INTEGER NOT NULL DEFAULT 8,
        enabled        INTEGER NOT NULL DEFAULT 1,
        tts_role_id    TEXT,
        locale         TEXT NOT NULL DEFAULT 'en',
        xsaid          INTEGER NOT NULL DEFAULT 1,
        autojoin       INTEGER NOT NULL DEFAULT 0,
        read_bots      INTEGER NOT NULL DEFAULT 0,
        text_in_voice  INTEGER NOT NULL DEFAULT 0,
        greet_on_join  INTEGER NOT NULL DEFAULT 1,
        greet_locale   TEXT NOT NULL DEFAULT 'en',
        antispam       INTEGER NOT NULL DEFAULT 0,
        stay_in_call   INTEGER NOT NULL DEFAULT 0,
        streak_announce INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS blocklist (
        guild_id TEXT NOT NULL,
        word     TEXT NOT NULL,
        PRIMARY KEY (guild_id, word)
      );

      -- Dicionário de pronúncia por-SERVIDOR (/serverpronunciation, admin): aplica-se
      -- a toda a guild. Limite fixo 3. (O dicionário PESSOAL vive em pronunciation_user.)
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

      -- Pronuncias PESSOAIS (/pronunciation): so se aplicam as mensagens do proprio
      -- autor, em qualquer servidor (globais, como user_abbreviation). Limite imposto
      -- no handler: 3 Free / 50 Premium (Plus ou servidor Premium).
      CREATE TABLE IF NOT EXISTS pronunciation_user (
        user_id     TEXT NOT NULL,
        term        TEXT NOT NULL,
        replacement TEXT NOT NULL,
        PRIMARY KEY (user_id, term)
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

      -- PASSE Vozen Premium por-UTILIZADOR: uma compra de Premium (guild) dá à pessoa um
      -- passe com N "licenças" (seats) e uma DATA DE FIM ABSOLUTA (expires_at, unix ms). O
      -- relógio corre no passe: ativar/desativar um servidor não pausa nem estende a data.
      -- A pessoa gasta uma licença num servidor com /premium activate (ver premium_pass_
      -- activation); renovar (webhook) só estende expires_at e os servidores ativos herdam
      -- a nova data em tempo real (isGuildPremium lê o passe). source = kofi|discord|manual.
      CREATE TABLE IF NOT EXISTS premium_pass (
        user_id    TEXT PRIMARY KEY,
        seats      INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        source     TEXT NOT NULL DEFAULT ''
      );

      -- Que servidores é que o dono de um passe ativou (1 linha = 1 licença gasta). O nº de
      -- linhas por user_id nunca passa premium_pass.seats. Um servidor é Premium enquanto
      -- existir aqui uma ativação cujo passe (premium_pass) ainda não expirou. idx por guild
      -- para o isGuildPremium ser rápido.
      CREATE TABLE IF NOT EXISTS premium_pass_activation (
        user_id      TEXT NOT NULL,
        guild_id     TEXT NOT NULL,
        activated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, guild_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pass_activation_guild
        ON premium_pass_activation (guild_id);

      -- Mapa HASH(email)->Discord ID para o webhook do Ko-fi. O comprador escreve o Discord
      -- ID na 1.ª compra (guardado aqui, indexado pelo HASH do email); nas RENOVAÇÕES o Ko-fi
      -- já não reenvia a mensagem, por isso reencontramos o Discord ID pelo hash do email.
      -- NUNCA guardamos o email em claro (minimização de PII) — ver hashKofiEmail.
      CREATE TABLE IF NOT EXISTS kofi_supporter (
        email_hash TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Ledger de transações Ko-fi processadas (IDEMPOTÊNCIA do webhook). O Ko-fi
      -- reenvia entregas em timeout/não-2xx; sem este ledger um retry re-aplicava o
      -- grant — e como grantUserPremium/grantGuildPass ACUMULAM expiry, a mesma compra
      -- pagava dias a dobrar. Renovações legítimas trazem kofi_transaction_id DISTINTO,
      -- por isso nunca são bloqueadas por engano.
      CREATE TABLE IF NOT EXISTS kofi_transaction (
        transaction_id TEXT PRIMARY KEY,
        processed_at   INTEGER NOT NULL
      );

      -- 24/7 in-call (Premium): canal de voz onde o bot estava, por guild. Guardado ao
      -- entrar numa call (só servidores Premium) e apagado no /leave e no guildDelete —
      -- NÃO no funil genérico removePlayer nem no shutdown, para SOBREVIVER a um restart
      -- (deploy). No arranque (ClientReady) o bot repõe-se nestes canais se ainda for
      -- Premium; as linhas não-Premium são limpas aí como rede de segurança.
      CREATE TABLE IF NOT EXISTS voice_presence (
        guild_id   TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Códigos de presente (gift codes): o dono gera com /gencode (owner-only) e a
      -- pessoa resgata com /redeem. USO ÚNICO — redeemed_by/redeemed_at ficam NULL até
      -- ser resgatado (o resgate é atómico, ver store/premiumCode.ts). plan = premium|
      -- plus; seats só conta para premium; expires_at é a validade do CÓDIGO (não do
      -- premium), NULL = nunca expira.
      CREATE TABLE IF NOT EXISTS premium_code (
        code        TEXT PRIMARY KEY,
        plan        TEXT NOT NULL,
        days        INTEGER NOT NULL,
        seats       INTEGER NOT NULL,
        created_by  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER,
        redeemed_by TEXT,
        redeemed_at INTEGER
      );

      -- Marca de SAÍDA do bot de um servidor (conformidade §5(b): não reter dados além
      -- do necessário). Escrita no guildDelete REAL (não em outages); apagada no
      -- guildCreate (re-convite). Um job diário purga os dados dos servidores cuja saída
      -- foi há mais de 30 dias (grace period p/ re-convite). Ver store/guildDeparted.ts.
      CREATE TABLE IF NOT EXISTS guild_departed (
        guild_id TEXT PRIMARY KEY,
        left_at  INTEGER NOT NULL
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
    // Migracao idempotente: kofi_supporter passou a indexar por HASH do email (minimizacao
    // de PII). A coluna antiga `email` (email em claro) renomeia-se para `email_hash`. Em DBs
    // novas o CREATE ja tem email_hash (no-op). A tabela e uma cache reconstruivel (o Ko-fi
    // reenvia o email nas renovacoes), por isso linhas antigas em claro que sobrem sao inertes
    // (o lookup passa a ser por hash e nunca casa com um email em claro).
    const ksCols = db.pragma('table_info(kofi_supporter)') as Array<{ name: string }>;
    if (ksCols.some((c) => c.name === 'email') && !ksCols.some((c) => c.name === 'email_hash')) {
      db.exec('ALTER TABLE kofi_supporter RENAME COLUMN email TO email_hash');
    }

    // Migracao idempotente: a voz Piper de Portugues europeu (pt_PT-tugao-medium) foi
    // RETIRADA das opcoes — fica so o pt-PT do Google (e do Kokoro para quem o usa). As
    // prefs ja gravadas que a apontavam migram para a voz pt-PT do Google
    // (pt_PT-google-medium), mesma lingua, servida pelo motor default. Apos correr uma vez
    // nao ha mais linhas a migrar (no-op). Cobre a voz por-user e a default da guild.
    db.exec(
      "UPDATE user_voice SET voice_model = 'pt_PT-google-medium' WHERE voice_model = 'pt_PT-tugao-medium'",
    );
    db.exec(
      "UPDATE guild_config SET default_voice = 'pt_PT-google-medium' WHERE default_voice = 'pt_PT-tugao-medium'",
    );

    // Migracao: a feature de DETECAO AUTOMATICA de lingua (/voice detection) foi REMOVIDA
    // — toda a gente passa a usar a voz FIXA escolhida. As tabelas do toggle (e a legada)
    // deixam de existir. DROP IF EXISTS: no-op em DBs novas, limpa as antigas.
    db.exec('DROP TABLE IF EXISTS tts_lang_detect_on');
    db.exec('DROP TABLE IF EXISTS tts_lang_detect_off');

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
