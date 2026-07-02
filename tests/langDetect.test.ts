import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { isDetectionOn, setDetection } from '../src/store/langDetect';

const G = 'guild-1';
const U = 'user-1';

// A deteccao automatica de lingua esta LIGADA por defeito (como uma pessoa que
// simplesmente fala). O store espelha o padrao do optout: so guarda uma linha para
// os utilizadores que a DESLIGARAM. Sem linha => ligada.
describe('langDetect store — deteccao automatica de lingua (default ON)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('default: deteccao LIGADA quando nao ha linha nenhuma', () => {
    expect(isDetectionOn(db, G, U)).toBe(true);
  });

  it('setDetection(false) desliga a deteccao para esse (guild,user)', () => {
    setDetection(db, G, U, false);
    expect(isDetectionOn(db, G, U)).toBe(false);
  });

  it('setDetection(true) volta a ligar (remove a linha)', () => {
    setDetection(db, G, U, false);
    expect(isDetectionOn(db, G, U)).toBe(false);
    setDetection(db, G, U, true);
    expect(isDetectionOn(db, G, U)).toBe(true);
  });

  it('isola por (guild,user): desligar num user nao afeta outro', () => {
    setDetection(db, G, U, false);
    expect(isDetectionOn(db, G, 'user-2')).toBe(true);
    expect(isDetectionOn(db, 'guild-2', U)).toBe(true);
  });

  it('setDetection(false) e idempotente (chamar duas vezes mantem OFF)', () => {
    setDetection(db, G, U, false);
    setDetection(db, G, U, false);
    expect(isDetectionOn(db, G, U)).toBe(false);
  });
});
