import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { isDetectionOn, setDetection } from '../src/store/langDetect';

const G = 'guild-1';
const U = 'user-1';

// A deteccao automatica de lingua esta DESLIGADA por defeito (voz UNICA fixa p/ todas
// as linguas — parece a mesma pessoa). O store guarda uma linha so para quem a LIGOU
// (opt-in). Sem linha => desligada. Semantica INVERTIDA em relacao ao antigo default ON.
describe('langDetect store — deteccao automatica de lingua (default OFF)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('default: deteccao DESLIGADA quando nao ha linha nenhuma', () => {
    expect(isDetectionOn(db, G, U)).toBe(false);
  });

  it('setDetection(true) liga a deteccao (opt-in) para esse (guild,user)', () => {
    setDetection(db, G, U, true);
    expect(isDetectionOn(db, G, U)).toBe(true);
  });

  it('setDetection(false) volta a desligar (remove a linha)', () => {
    setDetection(db, G, U, true);
    expect(isDetectionOn(db, G, U)).toBe(true);
    setDetection(db, G, U, false);
    expect(isDetectionOn(db, G, U)).toBe(false);
  });

  it('isola por (guild,user): ligar num user nao afeta outro', () => {
    setDetection(db, G, U, true);
    expect(isDetectionOn(db, G, 'user-2')).toBe(false);
    expect(isDetectionOn(db, 'guild-2', U)).toBe(false);
  });

  it('setDetection(true) e idempotente (chamar duas vezes mantem ON)', () => {
    setDetection(db, G, U, true);
    setDetection(db, G, U, true);
    expect(isDetectionOn(db, G, U)).toBe(true);
  });
});
