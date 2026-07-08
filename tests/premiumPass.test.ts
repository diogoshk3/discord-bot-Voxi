import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  isGuildPremium,
  grantGuildPass,
  activateSeat,
  deactivateSeat,
  getPremiumPass,
  countActiveSeats,
  listPassActivations,
} from '../src/store/premium';

const U = 'user-1';
const A = 'guild-A';
const B = 'guild-B';
const C = 'guild-C';
const DAY = 86_400_000;

describe('passe de Premium — licenças por-utilizador ativadas por servidor', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('sem passe -> activateSeat devolve no_pass e o servidor não é premium', () => {
    expect(activateSeat(db, U, A, 1000).status).toBe('no_pass');
    expect(isGuildPremium(db, A, 1000)).toBe(false);
    expect(getPremiumPass(db, U)).toBeNull();
  });

  it('grantGuildPass cria o passe; activateSeat torna o servidor premium', () => {
    const now = 1_000_000;
    const exp = grantGuildPass(db, U, 2, 30, 'kofi', now);
    expect(exp).toBe(now + 30 * DAY);
    expect(getPremiumPass(db, U)).toEqual({ seats: 2, expiresAt: exp, source: 'kofi' });
    // ainda não ativou -> servidor não é premium
    expect(isGuildPremium(db, A, now + 1)).toBe(false);
    const r = activateSeat(db, U, A, now);
    expect(r.status).toBe('ok');
    expect(r.used).toBe(1);
    expect(isGuildPremium(db, A, now + 1)).toBe(true);
    expect(isGuildPremium(db, A, exp + 1)).toBe(false); // passe expirado -> deixa de valer
  });

  it('limite de 2 licenças: a 3.ª ativação é recusada', () => {
    const now = 1_000_000;
    grantGuildPass(db, U, 2, 30, 'kofi', now);
    expect(activateSeat(db, U, A, now).status).toBe('ok');
    expect(activateSeat(db, U, B, now).status).toBe('ok');
    const third = activateSeat(db, U, C, now);
    expect(third.status).toBe('no_seats');
    expect(third.used).toBe(2);
    expect(isGuildPremium(db, C, now + 1)).toBe(false);
    expect(countActiveSeats(db, U)).toBe(2);
  });

  it('reativar o mesmo servidor -> already, sem gastar outra licença', () => {
    const now = 1_000_000;
    grantGuildPass(db, U, 2, 30, 'kofi', now);
    activateSeat(db, U, A, now);
    const again = activateSeat(db, U, A, now);
    expect(again.status).toBe('already');
    expect(countActiveSeats(db, U)).toBe(1); // continua 1
  });

  it('reversível: gastar no A, libertar e mover para o B — o RELÓGIO fica no passe', () => {
    const day0 = 1_000_000;
    const exp = grantGuildPass(db, U, 2, 30, 'kofi', day0); // fim absoluto = dia 30
    activateSeat(db, U, A, day0);
    expect(isGuildPremium(db, A, day0 + 10 * DAY)).toBe(true);

    // dia 10: liberta o A e mete no B
    const day10 = day0 + 10 * DAY;
    expect(deactivateSeat(db, U, A)).toBe(true);
    expect(isGuildPremium(db, A, day10)).toBe(false); // A deixa de ser premium já
    expect(activateSeat(db, U, B, day10).status).toBe('ok');

    // B é premium até ao MESMO fim do passe (dia 30) — não reiniciou nem estendeu
    expect(isGuildPremium(db, B, day0 + 29 * DAY)).toBe(true);
    expect(isGuildPremium(db, B, exp + 1)).toBe(false);
    expect(getPremiumPass(db, U)!.expiresAt).toBe(exp); // fim inalterado pela mudança
  });

  it('deactivateSeat de um servidor não-ativado -> false', () => {
    grantGuildPass(db, U, 2, 30, 'kofi', 1000);
    expect(deactivateSeat(db, U, A)).toBe(false);
  });

  it('renovar estende o passe e os servidores ativos herdam a nova data', () => {
    const now = 1_000_000;
    const exp1 = grantGuildPass(db, U, 2, 30, 'kofi', now);
    activateSeat(db, U, A, now);
    // renova 1 dia antes de expirar -> acumula
    const exp2 = grantGuildPass(db, U, 2, 30, 'kofi', exp1 - DAY);
    expect(exp2).toBe(exp1 + 30 * DAY);
    // depois do fim ANTIGO, o servidor continua premium (herdou a data nova, sem re-ativar)
    expect(isGuildPremium(db, A, exp1 + DAY)).toBe(true);
    expect(isGuildPremium(db, A, exp2 + 1)).toBe(false);
  });

  it('activateSeat com passe expirado -> expired', () => {
    const now = 1_000_000;
    const exp = grantGuildPass(db, U, 2, 30, 'kofi', now);
    expect(activateSeat(db, U, A, exp + DAY).status).toBe('expired');
  });

  it('grantGuildPass nunca reduz o nº de licenças', () => {
    const now = 1_000_000;
    grantGuildPass(db, U, 2, 30, 'kofi', now);
    grantGuildPass(db, U, 1, 30, 'kofi', now + DAY); // "downgrade" não reduz
    expect(getPremiumPass(db, U)!.seats).toBe(2);
  });

  it('listPassActivations devolve os servidores por ordem de ativação', () => {
    const now = 1_000_000;
    grantGuildPass(db, U, 2, 30, 'kofi', now);
    activateSeat(db, U, B, now);
    activateSeat(db, U, A, now + 1);
    expect(listPassActivations(db, U)).toEqual([B, A]);
  });
});
