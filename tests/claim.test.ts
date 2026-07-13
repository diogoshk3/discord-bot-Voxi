// tests/claim.test.ts — reclamar (claim) uma compra Ko-fi pendente.
//
// O checkout de subscrição do Ko-fi não tem caixa de mensagem, e um comprador GUEST nem tem
// histórico de transações — o único identificador fiável que ele controla é o EMAIL (o que
// usou no pagamento). Por isso o claim casa por email (via principal) OU pelo código da
// transação (via secundária, para quem tenha o tx id). Ver src/premium/claim.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { recordPendingGrant, findUnclaimedPendingByTx } from '../src/store/kofiPending';
import { claimPendingGrant } from '../src/premium/claim';
import { hashKofiEmail } from '../src/premium/kofi';
import { isUserPremium, getPremiumPass, lookupKofiSupporter } from '../src/store/premium';

const DID = '123456789012345678';
const DAY = 86_400_000;
const TOKEN = 'kofi-webhook-secret';
const EMAIL = 'buyer@example.com';
const EMAIL_HASH = hashKofiEmail(TOKEN, EMAIL);

describe('claimPendingGrant — reclamar compra pendente (email ou código)', () => {
  let db: Database.Database;
  const now = 1_000_000;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  const pend = (over: Partial<Parameters<typeof recordPendingGrant>[1]> = {}) => ({
    transactionId: 'tx-1',
    emailHash: EMAIL_HASH,
    plan: 'plus',
    days: 30,
    seats: 3,
    ...over,
  });

  // ── Via principal: EMAIL ────────────────────────────────────────────────────────────
  it('email do Ko-fi -> ativa Plus no Discord ID + marca reclamado', () => {
    recordPendingGrant(db, pend(), now);
    const out = claimPendingGrant(db, DID, EMAIL, TOKEN, now + 10);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.items).toHaveLength(1);
      expect(out.items[0].expiresAt).toBe(now + 10 + 30 * DAY);
    }
    expect(isUserPremium(db, DID, now + 20)).toBe(true);
    expect(findUnclaimedPendingByTx(db, 'tx-1')).toBeNull();
  });

  it('email normalizado (maiúsculas/espaços) casa na mesma (mesmo hash)', () => {
    recordPendingGrant(db, pend(), now);
    expect(claimPendingGrant(db, DID, '  BUYER@Example.COM ', TOKEN, now).ok).toBe(true);
  });

  it('email com VÁRIAS compras (renovações órfãs) -> reclama todas (acumula)', () => {
    recordPendingGrant(db, pend({ transactionId: 'tx-1' }), now);
    recordPendingGrant(db, pend({ transactionId: 'tx-2' }), now + 100);
    const out = claimPendingGrant(db, DID, EMAIL, TOKEN, now + 200);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.items).toHaveLength(2);
    expect(isUserPremium(db, DID, now + 200 + 59 * DAY)).toBe(true); // 2×30 dias
  });

  it('email memoriza email->Discord ID (renovações futuras resolvem-se sozinhas)', () => {
    recordPendingGrant(db, pend(), now);
    claimPendingGrant(db, DID, EMAIL, TOKEN, now);
    expect(lookupKofiSupporter(db, EMAIL_HASH)).toBe(DID);
  });

  it('email desconhecido -> not_found (sem ativar nada)', () => {
    recordPendingGrant(db, pend(), now);
    expect(claimPendingGrant(db, DID, 'stranger@x.com', TOKEN, now).ok).toBe(false);
    expect(isUserPremium(db, DID, now)).toBe(false);
  });

  it('email SEM token do webhook -> not_found (não dá para hashear)', () => {
    recordPendingGrant(db, pend(), now);
    expect(claimPendingGrant(db, DID, EMAIL, undefined, now).ok).toBe(false);
  });

  it('2.º claim do mesmo email -> not_found (uso único)', () => {
    recordPendingGrant(db, pend(), now);
    expect(claimPendingGrant(db, DID, EMAIL, TOKEN, now).ok).toBe(true);
    expect(claimPendingGrant(db, DID, EMAIL, TOKEN, now).ok).toBe(false);
  });

  // ── Via secundária: CÓDIGO (tx id) ──────────────────────────────────────────────────
  it('código (tx id) -> ativa e casa por email interno (aplica todas as do email)', () => {
    recordPendingGrant(db, pend({ transactionId: 'tx-1' }), now);
    recordPendingGrant(db, pend({ transactionId: 'tx-2' }), now + 100);
    const out = claimPendingGrant(db, DID, 'tx-1', TOKEN, now + 200);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.items).toHaveLength(2); // tx-1 + tx-2 (mesmo email)
    expect(findUnclaimedPendingByTx(db, 'tx-2')).toBeNull();
  });

  it('código de um Premium -> passe com os seats certos, source kofi', () => {
    recordPendingGrant(
      db,
      pend({ transactionId: 'tx-p', plan: 'premium', days: 365, seats: 8 }),
      now,
    );
    const out = claimPendingGrant(db, DID, 'tx-p', TOKEN, now);
    expect(out.ok).toBe(true);
    const pass = getPremiumPass(db, DID)!;
    expect(pass.seats).toBe(8);
    expect(pass.source).toBe('kofi');
  });

  it('código desconhecido -> not_found', () => {
    const out = claimPendingGrant(db, DID, 'nao-existe', TOKEN, now);
    expect(out).toEqual({ ok: false, reason: 'not_found' });
  });

  it('pendente sem email (emailHash null), reclamado pelo código -> só a própria compra', () => {
    recordPendingGrant(db, pend({ transactionId: 'tx-solo', emailHash: null }), now);
    recordPendingGrant(db, pend({ transactionId: 'tx-other', emailHash: null }), now);
    const out = claimPendingGrant(db, DID, 'tx-solo', TOKEN, now);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.items).toHaveLength(1);
    expect(findUnclaimedPendingByTx(db, 'tx-other')).not.toBeNull();
  });

  it('input vazio -> not_found', () => {
    expect(claimPendingGrant(db, DID, '   ', TOKEN, now)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});
