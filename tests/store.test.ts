import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { getUserVoice, setUserVoice, resetUserVoice } from '../src/store/userVoice';
import {
  getGuildConfig,
  setGuildConfig,
  resetGuildConfig,
  GUILD_CONFIG_COLUMNS,
} from '../src/store/guildConfig';
import { getBlocklist, addBlockword, removeBlockword } from '../src/store/blocklist';
import {
  getPronunciations,
  addPronunciation,
  removePronunciation,
} from '../src/store/pronunciation';
import { isOptedOut, setOptOut, setOptIn } from '../src/store/optout';
import { getNickname, setNickname, clearNickname } from '../src/store/nickname';
import { getVoiceEffect, setVoiceEffect, clearVoiceEffect } from '../src/store/voiceEffect';
import { isDetectionOn, setDetection } from '../src/store/langDetect';
import {
  getClone,
  saveClone,
  setCloneEnabled,
  deleteClone,
  deleteClonesByTarget,
} from '../src/store/voiceClone';

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

    it('sets and gets a user voice (engine default google)', () => {
      setUserVoice(db, G, U, 'pt_PT-tugão-medium', 1.2);
      expect(getUserVoice(db, G, U)).toEqual({
        model: 'pt_PT-tugão-medium',
        speed: 1.2,
        engine: 'google',
      });
    });

    it('overwrites an existing voice (upsert)', () => {
      setUserVoice(db, G, U, 'a', 1);
      setUserVoice(db, G, U, 'b', 1.5);
      expect(getUserVoice(db, G, U)).toEqual({ model: 'b', speed: 1.5, engine: 'google' });
    });

    it('guarda e lê o motor piper', () => {
      setUserVoice(db, G, U, 'a', 1, 'piper');
      expect(getUserVoice(db, G, U)?.engine).toBe('piper');
      // Voltar a gravar com 'google' troca o motor.
      setUserVoice(db, G, U, 'a', 1, 'google');
      expect(getUserVoice(db, G, U)?.engine).toBe('google');
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
        locale: 'en', // default: ingles como idioma da interface
        xsaid: true, // anunciar quem falou LIGADO por defeito
        autojoin: false, // entrar sozinho na call DESLIGADO por defeito
        readBots: false, // NÃO ler outros bots por defeito
        textInVoice: false, // NÃO ler o chat-em-voz por defeito
        greetOnJoin: true, // saudar quem entra na call LIGADO por defeito
        greetLocale: 'en', // inglês como língua da saudação por defeito
        antispam: false, // filtro de spam DESLIGADO por defeito
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
        locale: 'en', // default: ingles como idioma da interface
        xsaid: true, // anunciar quem falou LIGADO por defeito
        autojoin: false, // entrar sozinho na call DESLIGADO por defeito
        readBots: false, // NÃO ler outros bots por defeito
        textInVoice: false, // NÃO ler o chat-em-voz por defeito
        greetOnJoin: true, // saudar quem entra na call LIGADO por defeito
        greetLocale: 'en', // inglês como língua da saudação por defeito
        antispam: false, // filtro de spam DESLIGADO por defeito
      });
    });

    it('locale default e "en"', () => {
      expect(getGuildConfig(db, G).locale).toBe('en');
    });

    it('persiste e le locale (pt)', () => {
      setGuildConfig(db, G, { locale: 'pt' });
      expect(getGuildConfig(db, G).locale).toBe('pt');
    });

    it('um patch de locale nao perde outros campos', () => {
      setGuildConfig(db, G, { maxChars: 500, autoread: true });
      setGuildConfig(db, G, { locale: 'pt' });
      const cfg = getGuildConfig(db, G);
      expect(cfg.locale).toBe('pt');
      expect(cfg.maxChars).toBe(500);
      expect(cfg.autoread).toBe(true);
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

    // ── Paridade descritor ↔ resto (plano 014): estes testes rebentam se alguém
    // acrescentar/remover um campo sem sincronizar as 5 fontes de verdade.
    it('descritor: props batem com as chaves de GuildConfig, sem colunas duplicadas', () => {
      // getGuildConfig(absent) devolve o objeto DEFAULTS -> as suas chaves são o
      // conjunto exato de props de GuildConfig.
      const configKeys = Object.keys(getGuildConfig(db, 'no-such-guild')).sort();
      const descriptorProps = GUILD_CONFIG_COLUMNS.map((c) => c.prop).sort();
      expect(descriptorProps).toEqual(configKeys);
      const columns = GUILD_CONFIG_COLUMNS.map((c) => c.column);
      expect(new Set(columns).size).toBe(columns.length); // sem colunas repetidas
    });

    it('descritor: colunas batem com o CREATE TABLE (table_info)', () => {
      const info = db.pragma('table_info(guild_config)') as Array<{ name: string }>;
      const actual = new Set(info.map((c) => c.name));
      const expected = new Set(['guild_id', ...GUILD_CONFIG_COLUMNS.map((c) => c.column)]);
      expect(actual).toEqual(expected);
    });

    it('round-trip de TODOS os 14 campos com valores não-default', () => {
      const full = {
        ttsChannelId: 'c1',
        autoread: true,
        defaultVoice: 'pt_PT-x',
        maxChars: 999,
        ratePerMin: 42,
        enabled: false,
        ttsRoleId: 'r1',
        locale: 'pt',
        xsaid: false,
        autojoin: true,
        readBots: true,
        textInVoice: true,
        greetOnJoin: false,
        greetLocale: 'pt',
        antispam: true,
      };
      setGuildConfig(db, G, full);
      expect(getGuildConfig(db, G)).toEqual(full);
    });

    it('migra uma DB antiga (só as 8 colunas originais) — backfill dos defaults novos', () => {
      const dir = mkdtempSync(join(tmpdir(), 'voxi-mig-'));
      const path = join(dir, 'old.db');
      // DB no formato pré-locale: guild_id … tts_role_id (as 8 originais), sem as 7 novas.
      const raw = new BetterSqlite3(path);
      raw.exec(`
        CREATE TABLE guild_config (
          guild_id       TEXT PRIMARY KEY,
          tts_channel_id TEXT,
          autoread       INTEGER NOT NULL DEFAULT 0,
          default_voice  TEXT NOT NULL DEFAULT 'en_US-amy-medium',
          max_chars      INTEGER NOT NULL DEFAULT 300,
          rate_per_min   INTEGER NOT NULL DEFAULT 5,
          enabled        INTEGER NOT NULL DEFAULT 1,
          tts_role_id    TEXT
        );
      `);
      raw
        .prepare(
          `INSERT INTO guild_config
             (guild_id, tts_channel_id, autoread, default_voice, max_chars, rate_per_min, enabled, tts_role_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('old-g', 'chan-old', 1, 'pt_PT-x', 777, 9, 0, 'role-old');
      raw.close();

      const migrated = initDb(path);
      try {
        // Valores antigos preservados; colunas novas = defaults (backfill via ADD COLUMN).
        expect(getGuildConfig(migrated, 'old-g')).toEqual({
          ttsChannelId: 'chan-old',
          autoread: true,
          defaultVoice: 'pt_PT-x',
          maxChars: 777,
          ratePerMin: 9,
          enabled: false,
          ttsRoleId: 'role-old',
          locale: 'en',
          xsaid: true,
          autojoin: false,
          readBots: false,
          textInVoice: false,
          greetOnJoin: true,
          greetLocale: 'en',
          antispam: false,
        });
        // As 16 colunas passam a existir depois da migração.
        const info = migrated.pragma('table_info(guild_config)') as Array<{ name: string }>;
        const names = new Set(info.map((c) => c.name));
        for (const col of GUILD_CONFIG_COLUMNS) expect(names.has(col.column)).toBe(true);
        expect(names.has('guild_id')).toBe(true);
      } finally {
        migrated.close();
        rmSync(dir, { recursive: true, force: true });
      }
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

  describe('pronunciation', () => {
    it('returns empty array when nothing is set', () => {
      expect(getPronunciations(db, G)).toEqual([]);
    });

    it('adds and gets a term/replacement', () => {
      addPronunciation(db, G, 'gg', 'good game');
      expect(getPronunciations(db, G)).toEqual([{ term: 'gg', replacement: 'good game' }]);
    });

    it('re-adding the same term updates the replacement (upsert)', () => {
      addPronunciation(db, G, 'gg', 'good game');
      addPronunciation(db, G, 'gg', 'gigi');
      expect(getPronunciations(db, G)).toEqual([{ term: 'gg', replacement: 'gigi' }]);
    });

    it('removes a term', () => {
      addPronunciation(db, G, 'gg', 'good game');
      addPronunciation(db, G, 'btw', 'by the way');
      removePronunciation(db, G, 'gg');
      expect(getPronunciations(db, G)).toEqual([{ term: 'btw', replacement: 'by the way' }]);
    });

    it('orders entries by term ASC (determinismo)', () => {
      addPronunciation(db, G, 'zz', 'ultimo');
      addPronunciation(db, G, 'aa', 'primeiro');
      expect(getPronunciations(db, G)).toEqual([
        { term: 'aa', replacement: 'primeiro' },
        { term: 'zz', replacement: 'ultimo' },
      ]);
    });

    it('isolates pronunciations per guild', () => {
      addPronunciation(db, G, 'gg', 'good game');
      expect(getPronunciations(db, 'guild-2')).toEqual([]);
    });
  });

  describe('optout', () => {
    it('isOptedOut e false quando nada foi definido', () => {
      expect(isOptedOut(db, G, U)).toBe(false);
    });

    it('setOptOut marca o utilizador e isOptedOut passa a true', () => {
      setOptOut(db, G, U);
      expect(isOptedOut(db, G, U)).toBe(true);
    });

    it('setOptOut e idempotente (marcar duas vezes nao rebenta)', () => {
      setOptOut(db, G, U);
      setOptOut(db, G, U);
      expect(isOptedOut(db, G, U)).toBe(true);
    });

    it('setOptIn limpa o opt-out e isOptedOut volta a false', () => {
      setOptOut(db, G, U);
      setOptIn(db, G, U);
      expect(isOptedOut(db, G, U)).toBe(false);
    });

    it('isola o opt-out por guild', () => {
      setOptOut(db, G, U);
      expect(isOptedOut(db, 'guild-2', U)).toBe(false);
    });

    it('isola o opt-out por utilizador', () => {
      setOptOut(db, G, U);
      expect(isOptedOut(db, G, 'user-2')).toBe(false);
    });
  });

  describe('guildConfig — patches sucessivos', () => {
    it('tres patches sucessivos nao perdem campos anteriores', () => {
      setGuildConfig(db, G, { ttsChannelId: 'chan-1' });
      setGuildConfig(db, G, { maxChars: 500, ratePerMin: 10 });
      setGuildConfig(db, G, { enabled: false });
      const cfg = getGuildConfig(db, G);
      expect(cfg.ttsChannelId).toBe('chan-1'); // do 1.º patch
      expect(cfg.maxChars).toBe(500); // do 2.º patch
      expect(cfg.ratePerMin).toBe(10); // do 2.º patch
      expect(cfg.enabled).toBe(false); // do 3.º patch
      expect(cfg.defaultVoice).toBe(''); // vazio = guild nao definiu voz default
    });

    it('patch que substitui defaultVoice nao perde outros campos', () => {
      setGuildConfig(db, G, { autoread: true, maxChars: 400 });
      setGuildConfig(db, G, { defaultVoice: 'pt_PT-tugão-medium' });
      const cfg = getGuildConfig(db, G);
      expect(cfg.autoread).toBe(true);
      expect(cfg.maxChars).toBe(400);
      expect(cfg.defaultVoice).toBe('pt_PT-tugão-medium');
    });
  });

  describe('nickname (xsaid)', () => {
    it('sem apelido -> null', () => {
      expect(getNickname(db, G, 'u1')).toBeNull();
    });

    it('persiste, sobrescreve e limpa', () => {
      setNickname(db, G, 'u1', 'Zé');
      expect(getNickname(db, G, 'u1')).toBe('Zé');
      setNickname(db, G, 'u1', 'Zezinho');
      expect(getNickname(db, G, 'u1')).toBe('Zezinho');
      clearNickname(db, G, 'u1');
      expect(getNickname(db, G, 'u1')).toBeNull();
    });

    it('é por-(guild,user)', () => {
      setNickname(db, G, 'u1', 'A');
      expect(getNickname(db, 'outra-guild', 'u1')).toBeNull();
      expect(getNickname(db, G, 'u2')).toBeNull();
    });
  });

  describe('voiceEffect', () => {
    it('sem efeito -> none; persiste, sobrescreve e limpa', () => {
      expect(getVoiceEffect(db, G, 'u1')).toBe('none');
      setVoiceEffect(db, G, 'u1', 'robot');
      expect(getVoiceEffect(db, G, 'u1')).toBe('robot');
      setVoiceEffect(db, G, 'u1', 'deep');
      expect(getVoiceEffect(db, G, 'u1')).toBe('deep');
      setVoiceEffect(db, G, 'u1', 'none'); // apaga a linha
      expect(getVoiceEffect(db, G, 'u1')).toBe('none');
    });

    it('é por-(guild,user)', () => {
      setVoiceEffect(db, G, 'u1', 'echo');
      expect(getVoiceEffect(db, 'outra', 'u1')).toBe('none');
      expect(getVoiceEffect(db, G, 'u2')).toBe('none');
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

describe('initDb — migracao target_id (user_clone) em DB de esquema antigo', () => {
  it('adiciona target_id e faz backfill = user_id (Fase 2: pessoa gravada pode revogar)', () => {
    // O caminho real do restart: uma DB com user_clone SEM target_id (esquema antigo,
    // como a tts.db de produção com 2 clones). A migracao adiciona a coluna e assume
    // auto-clone (target_id = user_id) nas linhas existentes.
    const dir = mkdtempSync(join(tmpdir(), 'migclone-'));
    const file = join(dir, 'old-clone.sqlite');
    try {
      const old = new BetterSqlite3(file);
      old.exec(`
        CREATE TABLE user_clone (
          user_id     TEXT PRIMARY KEY,
          sample_path TEXT NOT NULL,
          consent_at  INTEGER NOT NULL,
          enabled     INTEGER NOT NULL DEFAULT 0
        );
      `);
      old
        .prepare(
          'INSERT INTO user_clone (user_id, sample_path, consent_at, enabled) VALUES (?, ?, ?, ?)',
        )
        .run('u-old', '/x/u-old.wav', 111, 1);
      old.close();

      // Antes: sem target_id.
      const before = new BetterSqlite3(file);
      expect(
        (before.pragma('table_info(user_clone)') as Array<{ name: string }>).some(
          (c) => c.name === 'target_id',
        ),
      ).toBe(false);
      before.close();

      // initDb corre a migracao idempotente + backfill.
      const db = initDb(file);
      const row = getClone(db, 'u-old');
      expect(row).not.toBeNull();
      expect(row!.targetId).toBe('u-old'); // backfill: auto-clone
      expect(row!.samplePath).toBe('/x/u-old.wav');
      expect(row!.enabled).toBe(true); // preservado

      // Idempotente: correr de novo nao rebenta nem duplica a coluna.
      db.close();
      const db2 = initDb(file);
      expect(
        (db2.pragma('table_info(user_clone)') as Array<{ name: string }>).filter(
          (c) => c.name === 'target_id',
        ),
      ).toHaveLength(1);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('initDb — migracao locale em DB de esquema antigo', () => {
  it('adiciona a coluna locale a uma DB sem ela e o get devolve "en"', () => {
    // Mesmo padrao do teste de tts_role_id: DB com esquema ANTIGO (sem locale),
    // uma linha inserida, fechada; depois initDb corre a migracao idempotente e
    // as linhas antigas passam a ler locale='en' (nao null).
    const dir = mkdtempSync(join(tmpdir(), 'migloc-'));
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
          enabled        INTEGER NOT NULL DEFAULT 1,
          tts_role_id    TEXT
        );
      `);
      old
        .prepare(
          `INSERT INTO guild_config (guild_id, tts_channel_id, autoread, default_voice, max_chars, rate_per_min, enabled, tts_role_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('g-old', 'chan-old', 1, 'en_US-amy-medium', 300, 5, 1, null);
      old.close();

      // Antes da migracao a coluna nao existe.
      const before = new BetterSqlite3(file);
      const colsBefore = before.pragma('table_info(guild_config)') as Array<{ name: string }>;
      expect(colsBefore.some((c) => c.name === 'locale')).toBe(false);
      before.close();

      // initDb corre a migracao idempotente.
      const db = initDb(file);
      const colsAfter = db.pragma('table_info(guild_config)') as Array<{ name: string }>;
      expect(colsAfter.some((c) => c.name === 'locale')).toBe(true);

      // A linha antiga continua la e locale vem como 'en' (default da coluna nova).
      expect(getGuildConfig(db, 'g-old').locale).toBe('en');
      expect(getGuildConfig(db, 'g-old').ttsChannelId).toBe('chan-old');

      // Idempotente: correr initDb de novo no mesmo ficheiro nao rebenta.
      db.close();
      const db2 = initDb(file);
      const cols2 = db2.pragma('table_info(guild_config)') as Array<{ name: string }>;
      expect(cols2.filter((c) => c.name === 'locale')).toHaveLength(1);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── cache write-through (plano 010) ──────────────────────────────────────────
describe('store — cache write-through', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  // A prova mais forte: cada setter tem de fazer o get SEGUINTE devolver o valor novo.
  // Se a invalidação faltasse, o get servia o valor cacheado velho e estes falhavam.
  it('cada setter invalida — o get seguinte reflete a escrita', () => {
    // guild_config
    getGuildConfig(db, G);
    setGuildConfig(db, G, { maxChars: 111 });
    expect(getGuildConfig(db, G).maxChars).toBe(111);
    resetGuildConfig(db, G);
    expect(getGuildConfig(db, G).maxChars).toBe(300); // default

    // blocklist
    getBlocklist(db, G);
    addBlockword(db, G, 'spam');
    expect(getBlocklist(db, G)).toContain('spam');
    removeBlockword(db, G, 'spam');
    expect(getBlocklist(db, G)).not.toContain('spam');

    // pronunciation
    getPronunciations(db, G);
    addPronunciation(db, G, 'gg', 'good game');
    expect(getPronunciations(db, G)).toEqual([{ term: 'gg', replacement: 'good game' }]);
    removePronunciation(db, G, 'gg');
    expect(getPronunciations(db, G)).toHaveLength(0);

    // user_voice
    getUserVoice(db, G, U);
    setUserVoice(db, G, U, 'en_US-amy-medium', 1);
    expect(getUserVoice(db, G, U)?.model).toBe('en_US-amy-medium');
    resetUserVoice(db, G, U);
    expect(getUserVoice(db, G, U)).toBeNull();

    // nickname
    getNickname(db, G, U);
    setNickname(db, G, U, 'Zé');
    expect(getNickname(db, G, U)).toBe('Zé');
    clearNickname(db, G, U);
    expect(getNickname(db, G, U)).toBeNull();

    // optout
    isOptedOut(db, G, U);
    setOptOut(db, G, U);
    expect(isOptedOut(db, G, U)).toBe(true);
    setOptIn(db, G, U);
    expect(isOptedOut(db, G, U)).toBe(false);

    // lang detect
    isDetectionOn(db, G, U);
    setDetection(db, G, U, true);
    expect(isDetectionOn(db, G, U)).toBe(true);
    setDetection(db, G, U, false);
    expect(isDetectionOn(db, G, U)).toBe(false);

    // voice effect
    getVoiceEffect(db, G, U);
    setVoiceEffect(db, G, U, 'robot');
    expect(getVoiceEffect(db, G, U)).toBe('robot');
    clearVoiceEffect(db, G, U);
    expect(getVoiceEffect(db, G, U)).toBe('none');

    // clone
    getClone(db, U);
    saveClone(db, U, '/a.wav', 1000);
    expect(getClone(db, U)?.samplePath).toBe('/a.wav');
    setCloneEnabled(db, U, true);
    expect(getClone(db, U)?.enabled).toBe(true);
    deleteClone(db, U);
    expect(getClone(db, U)).toBeNull();
  });

  it('deleteClonesByTarget invalida a cache do DONO afetado', () => {
    saveClone(db, 'owner', '/o.wav', 1000, 'target'); // owner grava a voz de target
    getClone(db, 'owner'); // popula a cache
    const removed = deleteClonesByTarget(db, 'target');
    expect(removed.map((r) => r.ownerId)).toContain('owner');
    expect(getClone(db, 'owner')).toBeNull(); // não serve o cacheado velho
  });

  it('caching NEGATIVO: um get sem linha não re-consulta no 2.º get, mas set invalida', () => {
    const spy = vi.spyOn(db, 'prepare');
    getNickname(db, G, U); // miss -> SELECT
    getNickname(db, G, U); // hit -> sem novo SELECT
    const selects = spy.mock.calls.filter((c) =>
      String(c[0]).includes('FROM user_nickname'),
    ).length;
    expect(selects).toBe(1); // só um SELECT apesar de dois gets (null foi cacheado)
    spy.mockRestore();
    setNickname(db, G, U, 'Ana');
    expect(getNickname(db, G, U)).toBe('Ana');
  });

  it('isolamento entre instâncias de db (WeakMap): db1 não contamina db2', () => {
    const db2 = initDb(':memory:');
    try {
      setNickname(db, G, U, 'só-no-db1');
      getNickname(db, G, U);
      expect(getNickname(db2, G, U)).toBeNull();
    } finally {
      db2.close();
    }
  });

  it('objeto devolvido NÃO é aliased ao cacheado (cópia rasa)', () => {
    setGuildConfig(db, G, { maxChars: 250 });
    const a = getGuildConfig(db, G);
    a.maxChars = 999; // mutação do chamador
    expect(getGuildConfig(db, G).maxChars).toBe(250); // o cacheado não mudou
  });

  it('TTL do clone: staleness limitada a 60s (escrita out-of-band via SQL cru)', () => {
    vi.useFakeTimers();
    try {
      saveClone(db, U, '/velha.wav', 1000);
      expect(getClone(db, U)?.samplePath).toBe('/velha.wav'); // popula a cache
      // Simula OUTRO processo (shard) a escrever, SEM passar pelo setter -> não invalida.
      db.prepare('UPDATE user_clone SET sample_path = ? WHERE user_id = ?').run('/nova.wav', U);
      expect(getClone(db, U)?.samplePath).toBe('/velha.wav'); // ainda cacheado
      vi.advanceTimersByTime(61_000);
      expect(getClone(db, U)?.samplePath).toBe('/nova.wav'); // TTL expirou -> re-lê
    } finally {
      vi.useRealTimers();
    }
  });
});
