import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  monthKeyUTC,
  getGcloudMonthlyChars,
  addGcloudMonthlyChars,
} from '../src/store/gcloudUsage';

describe('monthKeyUTC — chave de mês YYYY-MM em UTC', () => {
  it('formata com mês a 2 dígitos', () => {
    expect(monthKeyUTC(Date.UTC(2026, 0, 15))).toBe('2026-01'); // janeiro
    expect(monthKeyUTC(Date.UTC(2026, 11, 31))).toBe('2026-12'); // dezembro
  });
  it('usa UTC (não o fuso local) — 1 de janeiro 00:30 UTC continua janeiro', () => {
    expect(monthKeyUTC(Date.UTC(2026, 0, 1, 0, 30))).toBe('2026-01');
  });
});

describe('gcloud_usage — contadores mensais persistentes', () => {
  let db: Database.Database;
  const M = '2026-07';
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('sem linha -> 0 chars', () => {
    expect(getGcloudMonthlyChars(db, 'user', 'u1', M)).toBe(0);
  });

  it('add ACUMULA (soma atómica)', () => {
    addGcloudMonthlyChars(db, 'user', 'u1', M, 100);
    addGcloudMonthlyChars(db, 'user', 'u1', M, 250);
    expect(getGcloudMonthlyChars(db, 'user', 'u1', M)).toBe(350);
  });

  it('scopes/keys/meses diferentes são pools SEPARADOS', () => {
    addGcloudMonthlyChars(db, 'user', 'u1', M, 100);
    addGcloudMonthlyChars(db, 'pass', 'u1', M, 200); // mesmo id, scope diferente
    addGcloudMonthlyChars(db, 'user', 'u2', M, 300); // key diferente
    addGcloudMonthlyChars(db, 'user', 'u1', '2026-08', 400); // mês diferente
    expect(getGcloudMonthlyChars(db, 'user', 'u1', M)).toBe(100);
    expect(getGcloudMonthlyChars(db, 'pass', 'u1', M)).toBe(200);
    expect(getGcloudMonthlyChars(db, 'user', 'u2', M)).toBe(300);
    expect(getGcloudMonthlyChars(db, 'user', 'u1', '2026-08')).toBe(400);
  });

  it('persiste entre reaberturas da BD (mesmo ficheiro)', () => {
    // :memory: é por-conexão; usa um ficheiro temporário para provar a persistência.
    const path = `${process.env.TEMP || '/tmp'}/vozen-gcloud-usage-test-${M}.db`;
    const d1 = initDb(path);
    addGcloudMonthlyChars(d1, 'pass', 'owner-1', M, 12_345);
    d1.close();
    const d2 = initDb(path);
    expect(getGcloudMonthlyChars(d2, 'pass', 'owner-1', M)).toBe(12_345);
    d2.close();
    // limpeza
    try {
      require('node:fs').rmSync(path, { force: true });
    } catch {
      /* ignora */
    }
  });
});
