// tests/dataLifecycle.test.ts
//
// Conformidade (RGPD / Política do Discord §5(b)): a purga por-servidor e o erase
// por-utilizador têm de cobrir TODAS as tabelas com os dados dessa entidade, e NÃO
// tocar nos registos financeiros/entitlement retidos. O teste `rot-guard` FALHA se
// alguém adicionar uma tabela nova com guild_id/user_id sem a categorizar — é a rede
// que mantém a purga/erase completas à medida que o schema cresce.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  purgeGuild,
  eraseUser,
  GUILD_PURGE_TABLES,
  GUILD_RETAINED_TABLES,
  USER_ERASE_TABLES,
  USER_RETAINED_TABLES,
  USER_ERASE_BESPOKE,
  LIFECYCLE_REVIEWED_EXEMPT,
} from '../src/store/dataLifecycle';
import { purgeOldGcloudUsage } from '../src/store/gcloudUsage';

function count(db: Database.Database, table: string, col: string, id: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(id) as { n: number }
  ).n;
}

/** Insere 1 linha em cada tabela guild-scoped para um guildId (colunas mínimas + defaults). */
function seedGuild(db: Database.Database, g: string, u: string): void {
  db.prepare('INSERT INTO user_voice (guild_id, user_id, voice_model, speed) VALUES (?,?,?,?)').run(
    g,
    u,
    'en_US-amy-medium',
    1,
  );
  db.prepare('INSERT INTO guild_config (guild_id) VALUES (?)').run(g);
  db.prepare('INSERT INTO blocklist (guild_id, word) VALUES (?,?)').run(g, 'palavrao');
  db.prepare('INSERT INTO pronunciation (guild_id, term, replacement) VALUES (?,?,?)').run(
    g,
    'gg',
    'good game',
  );
  db.prepare('INSERT INTO tts_optout (guild_id, user_id) VALUES (?,?)').run(g, u);
  db.prepare('INSERT INTO user_nickname (guild_id, user_id, nickname) VALUES (?,?,?)').run(
    g,
    u,
    'Zé',
  );
  db.prepare('INSERT INTO game_score (guild_id, user_id) VALUES (?,?)').run(g, u);
  db.prepare('INSERT INTO user_birthday (guild_id, user_id, month, day) VALUES (?,?,?,?)').run(
    g,
    u,
    3,
    14,
  );
  db.prepare('INSERT INTO talk_stats (guild_id, user_id) VALUES (?,?)').run(g, u);
  db.prepare('INSERT INTO user_effect (guild_id, user_id, effect) VALUES (?,?,?)').run(
    g,
    u,
    'echo',
  );
  db.prepare('INSERT INTO voice_presence (guild_id, channel_id, updated_at) VALUES (?,?,?)').run(
    g,
    'C',
    1,
  );
  db.prepare('INSERT INTO stt_consent (user_id, guild_id, consent_at) VALUES (?,?,?)').run(u, g, 1);
  // Retidas (financeiro/entitlement) — NÃO devem ser tocadas pela purga.
  db.prepare('INSERT INTO premium_guild (guild_id, expires_at, source) VALUES (?,?,?)').run(
    g,
    9_999_999_999_999,
    'kofi',
  );
  db.prepare(
    'INSERT INTO premium_pass_activation (user_id, guild_id, activated_at) VALUES (?,?,?)',
  ).run(u, g, 1);
}

describe('purgeGuild', () => {
  it('apaga todos os dados guild-scoped de UM servidor, deixa os outros e os registos financeiros', () => {
    const db = initDb(':memory:');
    try {
      seedGuild(db, 'G', 'U');
      seedGuild(db, 'OTHER', 'U');

      purgeGuild(db, 'G');

      // Todas as tabelas de purga: G apagado, OTHER intacto.
      for (const t of GUILD_PURGE_TABLES) {
        if (t === 'guild_departed') continue; // não semeado aqui
        expect(count(db, t, 'guild_id', 'G')).toBe(0);
        expect(count(db, t, 'guild_id', 'OTHER')).toBe(1);
      }
      // Retidas: NÃO apagadas (registo financeiro do servidor + licença paga).
      expect(count(db, 'premium_guild', 'guild_id', 'G')).toBe(1);
      expect(count(db, 'premium_pass_activation', 'guild_id', 'G')).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe('eraseUser', () => {
  it('apaga os dados pessoais do utilizador em TODOS os servidores, retém o financeiro, devolve os WAVs', () => {
    const db = initDb(':memory:');
    try {
      // U tem dados em 2 servidores.
      seedGuild(db, 'G1', 'U');
      seedGuild(db, 'G2', 'U');
      // Tabelas user-scoped globais.
      db.prepare('INSERT INTO user_abbreviation (user_id, term, replacement) VALUES (?,?,?)').run(
        'U',
        'idk',
        'i dont know',
      );
      db.prepare('INSERT INTO pronunciation_user (user_id, term, replacement) VALUES (?,?,?)').run(
        'U',
        'nginx',
        'engine x',
      );
      // Identificadores do utilizador guardados sob OUTRO nome (bespoke erase).
      db.prepare(
        'INSERT INTO kofi_supporter (email_hash, discord_id, updated_at) VALUES (?,?,?)',
      ).run('hash-de-U', 'U', 1);
      db.prepare('INSERT INTO gcloud_usage (scope, key, month, chars) VALUES (?,?,?,?)').run(
        'user',
        'U',
        '2026-07',
        100,
      );
      // Consumo do SERVIDOR (scope guild) — NÃO é dado pessoal de U, fica retido.
      db.prepare('INSERT INTO gcloud_usage (scope, key, month, chars) VALUES (?,?,?,?)').run(
        'guild',
        'G1',
        '2026-07',
        50,
      );
      // Financeiro/entitlement do utilizador (RETIDO).
      db.prepare('INSERT INTO premium_user (user_id, expires_at, source) VALUES (?,?,?)').run(
        'U',
        9_999_999_999_999,
        'kofi',
      );
      db.prepare(
        'INSERT INTO premium_pass (user_id, seats, expires_at, source) VALUES (?,?,?,?)',
      ).run('U', 3, 9_999_999_999_999, 'kofi');
      // Clone do próprio (auto-clone) + clone da voz de U gravado por OUTRO (biométrico de U).
      db.prepare(
        'INSERT INTO user_clone (user_id, sample_path, consent_at, enabled, target_id) VALUES (?,?,?,?,?)',
      ).run('U', '/data/clones/U.wav', 1, 1, 'U');
      db.prepare(
        'INSERT INTO user_clone (user_id, sample_path, consent_at, enabled, target_id) VALUES (?,?,?,?,?)',
      ).run('OWNER', '/data/clones/OWNER-of-U.wav', 1, 1, 'U');

      const res = eraseUser(db, 'U');

      // Tabelas de erase: zero linhas de U (em qualquer servidor).
      for (const t of USER_ERASE_TABLES) {
        expect(count(db, t, 'user_id', 'U')).toBe(0);
      }
      // O clone da voz de U gravado por outro (target_id = U) também foi revogado.
      expect(count(db, 'user_clone', 'target_id', 'U')).toBe(0);
      // Bespoke: o link Ko-fi (discord_id) e o consumo pessoal (key) de U foram apagados;
      // o consumo do SERVIDOR (scope guild) fica retido (não é dado pessoal de U).
      expect(count(db, 'kofi_supporter', 'discord_id', 'U')).toBe(0);
      expect(count(db, 'gcloud_usage', 'key', 'U')).toBe(0);
      expect(count(db, 'gcloud_usage', 'key', 'G1')).toBe(1);
      // Retidas: intactas.
      expect(count(db, 'premium_user', 'user_id', 'U')).toBe(1);
      expect(count(db, 'premium_pass', 'user_id', 'U')).toBe(1);
      // Devolve os caminhos dos WAVs para o chamador apagar (o próprio + o gravado por outro).
      expect(res.removedSamplePaths.sort()).toEqual(
        ['/data/clones/OWNER-of-U.wav', '/data/clones/U.wav'].sort(),
      );
    } finally {
      db.close();
    }
  });
});

describe('rot-guard: categorização vs schema real', () => {
  it('TODA a tabela com guild_id está categorizada (purga OU retida) e o mesmo para user_id', () => {
    const db = initDb(':memory:');
    try {
      const tables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all() as { name: string }[]
      ).map((r) => r.name);

      for (const t of tables) {
        const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(
          (c) => c.name,
        );
        if (cols.includes('guild_id')) {
          expect(
            [...GUILD_PURGE_TABLES, ...GUILD_RETAINED_TABLES],
            `tabela '${t}' tem guild_id mas não está em GUILD_PURGE_TABLES nem GUILD_RETAINED_TABLES`,
          ).toContain(t);
        }
        if (cols.includes('user_id')) {
          expect(
            [...USER_ERASE_TABLES, ...USER_RETAINED_TABLES],
            `tabela '${t}' tem user_id mas não está em USER_ERASE_TABLES nem USER_RETAINED_TABLES`,
          ).toContain(t);
        }
        // ALARGADO: um ID de utilizador guardado sob OUTRO nome (discord_id, key,
        // created_by…) escapava ao guard antigo E à eliminação. Qualquer coluna em forma
        // de identificador (além de user_id/guild_id, já cobertos acima) obriga a tabela a
        // estar categorizada numa das 4 listas OU tratada/isenta explicitamente.
        const idCols = cols.filter(
          (c) =>
            c !== 'user_id' &&
            c !== 'guild_id' &&
            (/_(id|by)$/.test(c) || c === 'key' || c === 'discord_id'),
        );
        if (idCols.length > 0) {
          expect(
            [
              ...GUILD_PURGE_TABLES,
              ...GUILD_RETAINED_TABLES,
              ...USER_ERASE_TABLES,
              ...USER_RETAINED_TABLES,
              ...USER_ERASE_BESPOKE,
              ...LIFECYCLE_REVIEWED_EXEMPT,
            ],
            `tabela '${t}' tem coluna(s)-identificador [${idCols.join(', ')}] mas não está categorizada, ` +
              'tratada por bespoke-erase, nem isenta — decide erase/retenção e adiciona à lista certa',
          ).toContain(t);
        }
      }
    } finally {
      db.close();
    }
  });

  it('as listas de purga/retenção são disjuntas e só referem tabelas existentes', () => {
    const db = initDb(':memory:');
    try {
      const exists = new Set(
        (
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .all() as { name: string }[]
        ).map((r) => r.name),
      );
      const all = [
        ...GUILD_PURGE_TABLES,
        ...GUILD_RETAINED_TABLES,
        ...USER_ERASE_TABLES,
        ...USER_RETAINED_TABLES,
        ...USER_ERASE_BESPOKE,
        ...LIFECYCLE_REVIEWED_EXEMPT,
      ];
      for (const t of all) expect(exists, `lista refere tabela inexistente '${t}'`).toContain(t);
      // Disjunção por-eixo: nenhuma tabela é ao mesmo tempo purgada e retida.
      for (const t of GUILD_PURGE_TABLES) expect(GUILD_RETAINED_TABLES).not.toContain(t);
      for (const t of USER_ERASE_TABLES) expect(USER_RETAINED_TABLES).not.toContain(t);
    } finally {
      db.close();
    }
  });
});

describe('purgeOldGcloudUsage — retenção mensal', () => {
  it('apaga meses ANTERIORES ao cutoff e mantém o cutoff e os posteriores', () => {
    const db = initDb(':memory:');
    try {
      db.prepare('INSERT INTO gcloud_usage (scope, key, month, chars) VALUES (?,?,?,?)').run(
        'user',
        'U',
        '2026-04',
        10,
      );
      db.prepare('INSERT INTO gcloud_usage (scope, key, month, chars) VALUES (?,?,?,?)').run(
        'user',
        'U',
        '2026-07',
        20,
      );
      const removed = purgeOldGcloudUsage(db, '2026-06');
      expect(removed).toBe(1); // só o mês '2026-04'
      expect(count(db, 'gcloud_usage', 'month', '2026-04')).toBe(0);
      expect(count(db, 'gcloud_usage', 'month', '2026-07')).toBe(1);
    } finally {
      db.close();
    }
  });
});
