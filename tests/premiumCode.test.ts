import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { insertPremiumCode, getPremiumCode, redeemPremiumCode } from '../src/store/premiumCode';
import { generateCodeString, normalizeCode, CODE_ALPHABET } from '../src/premium/codeGen';

describe('codeGen — geração/normalização de códigos', () => {
  it('formato VOZEN-XXXX-XXXX só com o alfabeto seguro', () => {
    // randInt determinístico -> sempre o índice 0 ('A').
    const code = generateCodeString(() => 0);
    expect(code).toBe('VOZEN-AAAA-AAAA');
    expect(code).toMatch(/^VOZEN-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('o alfabeto não tem caracteres ambíguos (0/O/1/I/L)', () => {
    for (const c of '01OIL') expect(CODE_ALPHABET).not.toContain(c);
  });

  it('normalizeCode faz uppercase e tira espaços', () => {
    expect(normalizeCode('  vozen-aaaa-bbbb  ')).toBe('VOZEN-AAAA-BBBB');
  });
});

describe('premium_code — store (insert/get/redeem, uso único)', () => {
  let db: Database.Database;
  const base = {
    plan: 'plus' as const,
    days: 30,
    seats: 0,
    createdBy: 'owner1',
    createdAt: 1000,
    expiresAt: null,
  };
  beforeEach(() => {
    db = initDb(':memory:');
  });

  it('insert + get round-trip', () => {
    expect(insertPremiumCode(db, { code: 'VOZEN-AAAA-BBBB', ...base })).toBe(true);
    const row = getPremiumCode(db, 'VOZEN-AAAA-BBBB');
    expect(row?.plan).toBe('plus');
    expect(row?.redeemedBy).toBeNull();
  });

  it('insert de código duplicado devolve false (para o chamador regenerar)', () => {
    expect(insertPremiumCode(db, { code: 'DUP', ...base })).toBe(true);
    expect(insertPremiumCode(db, { code: 'DUP', ...base })).toBe(false);
  });

  it('resgate de código inexistente -> not-found', () => {
    expect(redeemPremiumCode(db, 'NOPE', 'user1', 2000)).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });

  it('resgate válido devolve o grant e marca o código como usado', () => {
    insertPremiumCode(db, { code: 'GIFT1', ...base, plan: 'premium', seats: 3 });
    const res = redeemPremiumCode(db, 'GIFT1', 'user1', 2000);
    expect(res).toEqual({ ok: true, plan: 'premium', days: 30, seats: 3 });
    const row = getPremiumCode(db, 'GIFT1');
    expect(row?.redeemedBy).toBe('user1');
    expect(row?.redeemedAt).toBe(2000);
  });

  it('USO ÚNICO: um 2.º resgate do mesmo código -> used', () => {
    insertPremiumCode(db, { code: 'ONCE', ...base });
    expect(redeemPremiumCode(db, 'ONCE', 'user1', 2000).ok).toBe(true);
    expect(redeemPremiumCode(db, 'ONCE', 'user2', 3000)).toEqual({ ok: false, reason: 'used' });
  });

  it('código expirado -> expired (não é resgatável)', () => {
    insertPremiumCode(db, { code: 'OLD', ...base, expiresAt: 1500 });
    expect(redeemPremiumCode(db, 'OLD', 'user1', 2000)).toEqual({ ok: false, reason: 'expired' });
    // e continua por usar (não foi consumido)
    expect(getPremiumCode(db, 'OLD')?.redeemedBy).toBeNull();
  });

  it('código com validade ainda no futuro -> resgatável', () => {
    insertPremiumCode(db, { code: 'FRESH', ...base, expiresAt: 5000 });
    expect(redeemPremiumCode(db, 'FRESH', 'user1', 2000).ok).toBe(true);
  });

  it('ATÓMICO: se o applyGrant rebentar, o código NÃO fica queimado (rollback)', () => {
    insertPremiumCode(db, { code: 'ATOM', ...base, plan: 'premium', seats: 3 });
    // O grant (aplicado DENTRO da transação) rebenta — ex.: falha de escrita.
    expect(() =>
      redeemPremiumCode(db, 'ATOM', 'user1', 2000, () => {
        throw new Error('grant falhou');
      }),
    ).toThrow('grant falhou');
    // A reclamação do código tem de reverter junto: continua por usar.
    expect(getPremiumCode(db, 'ATOM')?.redeemedBy).toBeNull();
    // E um novo resgate (agora com grant OK) consome-o normalmente.
    let granted = false;
    const res = redeemPremiumCode(db, 'ATOM', 'user1', 3000, () => {
      granted = true;
    });
    expect(res.ok).toBe(true);
    expect(granted).toBe(true);
    expect(getPremiumCode(db, 'ATOM')?.redeemedBy).toBe('user1');
  });
});
