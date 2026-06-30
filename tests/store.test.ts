import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
        defaultVoice: 'en_US-amy-medium',
        maxChars: 300,
        ratePerMin: 5,
        enabled: true,
      });
    });

    it('persists a partial patch and keeps other defaults', () => {
      setGuildConfig(db, G, { ttsChannelId: 'chan-1', autoread: true });
      expect(getGuildConfig(db, G)).toEqual({
        ttsChannelId: 'chan-1',
        autoread: true,
        defaultVoice: 'en_US-amy-medium',
        maxChars: 300,
        ratePerMin: 5,
        enabled: true,
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
      expect(cfg.defaultVoice).toBe('en_US-amy-medium'); // default inalterado
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
});
