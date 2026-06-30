import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { getUserVoice, setUserVoice, resetUserVoice } from '../src/store/userVoice';
import { getGuildConfig, setGuildConfig } from '../src/store/guildConfig';
import { getBlocklist, addBlockword, removeBlockword } from '../src/store/blocklist';

const G = 'guild-1';
const U = 'user-1';

describe('store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('userVoice', () => {
    it('returns null when no voice is set', () => {
      expect(getUserVoice(db, G, U)).toBeNull();
    });

    it('sets and gets a user voice', () => {
      setUserVoice(db, G, U, 'pt_PT-tugao-medium', 1.2);
      expect(getUserVoice(db, G, U)).toEqual({ model: 'pt_PT-tugao-medium', speed: 1.2 });
    });

    it('overwrites an existing voice (upsert)', () => {
      setUserVoice(db, G, U, 'a', 1);
      setUserVoice(db, G, U, 'b', 1.5);
      expect(getUserVoice(db, G, U)).toEqual({ model: 'b', speed: 1.5 });
    });

    it('isolates voices per guild', () => {
      setUserVoice(db, G, U, 'a', 1);
      expect(getUserVoice(db, 'guild-2', U)).toBeNull();
    });

    it('resets a user voice back to null', () => {
      setUserVoice(db, G, U, 'a', 1);
      resetUserVoice(db, G, U);
      expect(getUserVoice(db, G, U)).toBeNull();
    });
  });

  describe('guildConfig', () => {
    it('returns defaults when guild has no row', () => {
      expect(getGuildConfig(db, G)).toEqual({
        ttsChannelId: null,
        autoread: false,
        defaultVoice: '', // vazio = guild nao definiu voz default
        maxChars: 300,
        ratePerMin: 5,
        enabled: true,
        ttsRoleId: null,
      });
    });

    it('ttsRoleId default e null', () => {
      expect(getGuildConfig(db, G).ttsRoleId).toBeNull();
    });

    it('persiste e le ttsRoleId', () => {
      setGuildConfig(db, G, { ttsRoleId: 'role-42' });
      expect(getGuildConfig(db, G).ttsRoleId).toBe('role-42');
    });

    it('pode limpar ttsRoleId de volta a null', () => {
      setGuildConfig(db, G, { ttsRoleId: 'role-42' });
      setGuildConfig(db, G, { ttsRoleId: null });
      expect(getGuildConfig(db, G).ttsRoleId).toBeNull();
    });

    it('um patch de ttsRoleId nao perde outros campos', () => {
      setGuildConfig(db, G, { maxChars: 500, autoread: true });
      setGuildConfig(db, G, { ttsRoleId: 'role-7' });
      const cfg = getGuildConfig(db, G);
      expect(cfg.ttsRoleId).toBe('role-7');
      expect(cfg.maxChars).toBe(500);
      expect(cfg.autoread).toBe(true);
    });

    it('persists a partial patch and keeps other defaults', () => {
      setGuildConfig(db, G, { ttsChannelId: 'chan-1', autoread: true });
      expect(getGuildConfig(db, G)).toEqual({
        ttsChannelId: 'chan-1',
        autoread: true,
        defaultVoice: '', // vazio = guild nao definiu voz default
        maxChars: 300,
        ratePerMin: 5,
        enabled: true,
        ttsRoleId: null,
      });
    });

    it('merges successive patches without losing earlier values', () => {
      setGuildConfig(db, G, { maxChars: 500 });
      setGuildConfig(db, G, { enabled: false });
      const cfg = getGuildConfig(db, G);
      expect(cfg.maxChars).toBe(500);
      expect(cfg.enabled).toBe(false);
    });

    it('round-trips boolean and null fields correctly', () => {
      setGuildConfig(db, G, { autoread: false, enabled: true, ttsChannelId: null });
      const cfg = getGuildConfig(db, G);
      expect(cfg.autoread).toBe(false);
      expect(cfg.enabled).toBe(true);
      expect(cfg.ttsChannelId).toBeNull();
    });

    it('can clear ttsChannelId back to null', () => {
      setGuildConfig(db, G, { ttsChannelId: 'chan-1' });
      setGuildConfig(db, G, { ttsChannelId: null });
      expect(getGuildConfig(db, G).ttsChannelId).toBeNull();
    });
  });

  describe('blocklist', () => {
    it('returns empty array when nothing is blocked', () => {
      expect(getBlocklist(db, G)).toEqual([]);
    });

    it('adds and gets a word', () => {
      addBlockword(db, G, 'badword');
      expect(getBlocklist(db, G)).toEqual(['badword']);
    });

    it('is idempotent when adding the same word twice', () => {
      addBlockword(db, G, 'dup');
      addBlockword(db, G, 'dup');
      expect(getBlocklist(db, G)).toEqual(['dup']);
    });

    it('removes a word', () => {
      addBlockword(db, G, 'a');
      addBlockword(db, G, 'b');
      removeBlockword(db, G, 'a');
      expect(getBlocklist(db, G)).toEqual(['b']);
    });

    it('isolates blocklists per guild', () => {
      addBlockword(db, G, 'a');
      expect(getBlocklist(db, 'guild-2')).toEqual([]);
    });

    it('adiciona e obtem palavras acentuadas (salázar, café)', () => {
      addBlockword(db, G, 'salázar');
      addBlockword(db, G, 'café');
      const list = getBlocklist(db, G);
      expect(list).toContain('salázar');
      expect(list).toContain('café');
    });

    it('remove palavra acentuada correctamente', () => {
      addBlockword(db, G, 'café');
      addBlockword(db, G, 'salázar');
      removeBlockword(db, G, 'café');
      const list = getBlocklist(db, G);
      expect(list).not.toContain('café');
      expect(list).toContain('salázar');
    });

    it('tratamento case-sensitive: "Café" e "café" sao entradas distintas (sem COLLATE NOCASE)', () => {
      // O schema nao declara COLLATE NOCASE, portanto a distinção maiúscula/minúscula
      // é preservada — "Café" e "café" coexistem como entradas separadas.
      addBlockword(db, G, 'café');
      addBlockword(db, G, 'Café');
      const list = getBlocklist(db, G);
      expect(list).toContain('café');
      expect(list).toContain('Café');
      expect(list.length).toBe(2);
    });
  });

  describe('guildConfig — patches sucessivos', () => {
    it('tres patches sucessivos nao perdem campos anteriores', () => {
      setGuildConfig(db, G, { ttsChannelId: 'chan-1' });
      setGuildConfig(db, G, { maxChars: 500, ratePerMin: 10 });
      setGuildConfig(db, G, { enabled: false });
      const cfg = getGuildConfig(db, G);
      expect(cfg.ttsChannelId).toBe('chan-1');   // do 1.º patch
      expect(cfg.maxChars).toBe(500);            // do 2.º patch
      expect(cfg.ratePerMin).toBe(10);           // do 2.º patch
      expect(cfg.enabled).toBe(false);           // do 3.º patch
      expect(cfg.defaultVoice).toBe(''); // vazio = guild nao definiu voz default
    });

    it('patch que substitui defaultVoice nao perde outros campos', () => {
      setGuildConfig(db, G, { autoread: true, maxChars: 400 });
      setGuildConfig(db, G, { defaultVoice: 'pt_PT-tugao-medium' });
      const cfg = getGuildConfig(db, G);
      expect(cfg.autoread).toBe(true);
      expect(cfg.maxChars).toBe(400);
      expect(cfg.defaultVoice).toBe('pt_PT-tugao-medium');
    });
  });
});

describe('initDb — erro de abertura', () => {
  it('lanca erro com mensagem clara quando o caminho e invalido', () => {
    // better-sqlite3 NAO cria directorios intermedios: um caminho cujo pai nao
    // existe falha de forma fiavel (portavel, ao contrario de permission-denied).
    const bad = join(tmpdir(), `nope-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'x.db');
    expect(() => initDb(bad)).toThrow(/Falha ao abrir a base de dados/);
    // A mensagem inclui o caminho para diagnostico.
    expect(() => initDb(bad)).toThrow(bad);
  });

  it('lanca erro com mensagem clara quando o ficheiro nao e uma BD valida', () => {
    // Um ficheiro existente que nao e SQLite: new Database() passa (validacao lazy)
    // e o erro so surge em db.exec ("file is not a database"). O try alargado
    // transforma isso na mesma mensagem clara em vez de stack trace cru.
    const dir = mkdtempSync(join(tmpdir(), 'baddb-'));
    const file = join(dir, 'not-a-db.sqlite');
    writeFileSync(file, 'isto nao e uma base de dados sqlite, e texto qualquer\n');
    try {
      expect(() => initDb(file)).toThrow(/Falha ao abrir a base de dados/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('initDb — migracao tts_role_id em DB de esquema antigo', () => {
  it('adiciona a coluna tts_role_id a uma DB sem ela e o get devolve null', () => {
    // initDb abre por caminho, por isso a migracao tem de ser testada em ficheiro
    // real (nao :memory:). Criamos uma DB com o esquema ANTIGO (sem tts_role_id),
    // inserimos uma linha, fechamos; depois corremos initDb e confirmamos a coluna.
    const dir = mkdtempSync(join(tmpdir(), 'migdb-'));
    const file = join(dir, 'old-schema.sqlite');
    try {
      const old = new BetterSqlite3(file);
      old.exec(`
        CREATE TABLE guild_config (
          guild_id       TEXT PRIMARY KEY,
          tts_channel_id TEXT,
          autoread       INTEGER NOT NULL DEFAULT 0,
          default_voice  TEXT NOT NULL DEFAULT 'en_US-amy-medium',
          max_chars      INTEGER NOT NULL DEFAULT 300,
          rate_per_min   INTEGER NOT NULL DEFAULT 5,
          enabled        INTEGER NOT NULL DEFAULT 1
        );
      `);
      old
        .prepare(
          `INSERT INTO guild_config (guild_id, tts_channel_id, autoread, default_voice, max_chars, rate_per_min, enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('g-old', 'chan-old', 1, 'en_US-amy-medium', 300, 5, 1);
      old.close();

      // Antes da migracao a coluna nao existe.
      const before = new BetterSqlite3(file);
      const colsBefore = before.pragma('table_info(guild_config)') as Array<{ name: string }>;
      expect(colsBefore.some((c) => c.name === 'tts_role_id')).toBe(false);
      before.close();

      // initDb corre a migracao idempotente.
      const db = initDb(file);
      const colsAfter = db.pragma('table_info(guild_config)') as Array<{ name: string }>;
      expect(colsAfter.some((c) => c.name === 'tts_role_id')).toBe(true);

      // A linha antiga continua la e ttsRoleId vem como null (coluna nova, sem valor).
      expect(getGuildConfig(db, 'g-old').ttsRoleId).toBeNull();
      expect(getGuildConfig(db, 'g-old').ttsChannelId).toBe('chan-old');

      // Idempotente: correr initDb de novo no mesmo ficheiro nao rebenta.
      db.close();
      const db2 = initDb(file);
      const cols2 = db2.pragma('table_info(guild_config)') as Array<{ name: string }>;
      expect(cols2.filter((c) => c.name === 'tts_role_id')).toHaveLength(1);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
