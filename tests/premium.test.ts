import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  isGuildPremium,
  isUserPremium,
  getGuildPremiumExpiry,
  grantGuildPremium,
  grantUserPremium,
  createRedeemCode,
  redeemCode,
} from '../src/store/premium';

const G = 'guild-1';
const U = 'user-1';
const DAY = 86_400_000;

describe('premium — estado por expiry', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('sem linha -> não premium', () => {
    expect(isGuildPremium(db, G, 1000)).toBe(false);
    expect(isUserPremium(db, U, 1000)).toBe(false);
    expect(getGuildPremiumExpiry(db, G)).toBeNull();
  });

  it('grantGuildPremium concede days a partir de agora', () => {
    const now = 1_000_000;
    const exp = grantGuildPremium(db, G, 30, 'test', now);
    expect(exp).toBe(now + 30 * DAY);
    expect(isGuildPremium(db, G, now + 1)).toBe(true);
    expect(isGuildPremium(db, G, exp + 1)).toBe(false); // expirado
  });

  it('renovar ANTES de expirar ESTENDE (acumula, não perde tempo)', () => {
    const now = 1_000_000;
    grantGuildPremium(db, G, 30, 'test', now);
    const exp2 = grantGuildPremium(db, G, 30, 'test', now + DAY); // 1 dia depois, ainda ativo
    expect(exp2).toBe(now + 60 * DAY); // estende do expiry, não de now+DAY
  });

  it('renovar DEPOIS de expirar recomeça de agora', () => {
    const now = 1_000_000;
    const exp1 = grantGuildPremium(db, G, 30, 'test', now);
    const later = exp1 + 10 * DAY; // já expirou
    const exp2 = grantGuildPremium(db, G, 30, 'test', later);
    expect(exp2).toBe(later + 30 * DAY);
  });

  it('grantUserPremium é independente da guild', () => {
    const now = 1_000_000;
    grantUserPremium(db, U, 30, 'test', now);
    expect(isUserPremium(db, U, now + 1)).toBe(true);
    expect(isGuildPremium(db, G, now + 1)).toBe(false);
  });
});

describe('premium — códigos de resgate', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('código de guild: resgata, concede à guild e marca-se usado', () => {
    const now = 1_000_000;
    createRedeemCode(db, 'VOZEN-AAAA', 'guild', 30, now);
    const res = redeemCode(db, 'VOZEN-AAAA', { guildId: G, userId: U }, now);
    expect(res).toEqual({ status: 'ok', kind: 'guild', days: 30, expiresAt: now + 30 * DAY });
    expect(isGuildPremium(db, G, now + 1)).toBe(true);
  });

  it('código de user: concede ao invocador, não à guild', () => {
    const now = 1_000_000;
    createRedeemCode(db, 'VOZEN-BBBB', 'user', 30, now);
    const res = redeemCode(db, 'VOZEN-BBBB', { guildId: G, userId: U }, now);
    expect(res.status).toBe('ok');
    expect(res.kind).toBe('user');
    expect(isUserPremium(db, U, now + 1)).toBe(true);
    expect(isGuildPremium(db, G, now + 1)).toBe(false);
  });

  it('código inexistente -> invalid', () => {
    expect(redeemCode(db, 'VOZEN-NOPE', { guildId: G, userId: U }, 1).status).toBe('invalid');
  });

  it('segundo resgate do MESMO código -> used (check-and-set numa transação)', () => {
    const now = 1_000_000;
    createRedeemCode(db, 'VOZEN-CCCC', 'guild', 30, now);
    expect(redeemCode(db, 'VOZEN-CCCC', { guildId: G, userId: U }, now).status).toBe('ok');
    expect(redeemCode(db, 'VOZEN-CCCC', { guildId: G, userId: U }, now).status).toBe('used');
  });

  it('código de guild sem guild-alvo -> invalid (não rebenta)', () => {
    const now = 1_000_000;
    createRedeemCode(db, 'VOZEN-DDDD', 'guild', 30, now);
    const res = redeemCode(db, 'VOZEN-DDDD', { userId: U }, now);
    expect(res.status).toBe('invalid');
    // e o código NÃO foi consumido (continua resgatável com uma guild)
    expect(redeemCode(db, 'VOZEN-DDDD', { guildId: G, userId: U }, now).status).toBe('ok');
  });
});
