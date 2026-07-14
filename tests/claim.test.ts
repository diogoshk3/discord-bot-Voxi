// tests/claim.test.ts — reclamar (claim) uma compra Ko-fi pendente.
//
// O checkout de subscrição do Ko-fi não tem caixa de mensagem, e um comprador GUEST nem tem
// histórico de transações — mas o EMAIL não é segredo (ver plano 021: para quem o conheça,
// era possível roubar o Premium de outra pessoa via qualquer conta Discord logada, durante os
// 90 dias de retenção do pendente). Por isso o claim aceita SÓ o CÓDIGO da transação do recibo
// (chave forte que só o comprador tem); um input com '@' (email) é rejeitado com o motivo
// `use_receipt_code`, sem sequer tocar na BD. Ver src/premium/claim.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { recordPendingGrant, findUnclaimedPendingByTx } from '../src/store/kofiPending';
import { claimPendingGrant } from '../src/premium/claim';
import { hashKofiEmail } from '../src/premium/kofi';
import { isUserPremium, getPremiumPass, lookupKofiSupporter } from '../src/store/premium';

const DID = '123456789012345678';
const TOKEN = 'kofi-webhook-secret';
const EMAIL = 'buyer@example.com';
const EMAIL_HASH = hashKofiEmail(TOKEN, EMAIL);

describe('claimPendingGrant — reclamar compra pendente (só por código, plano 021)', () => {
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

  // ── EMAIL (plano 021: já não é prova de posse — rejeitado, sem tocar na BD) ─────────
  it('input tipo email -> use_receipt_code (não aplica nada, pendente continua por reclamar)', () => {
    recordPendingGrant(db, pend(), now);
    const out = claimPendingGrant(db, DID, EMAIL, TOKEN, now + 10);
    expect(out).toEqual({ ok: false, reason: 'use_receipt_code' });
    expect(isUserPremium(db, DID, now + 20)).toBe(false);
    expect(findUnclaimedPendingByTx(db, 'tx-1')).not.toBeNull(); // continua por reclamar
    expect(lookupKofiSupporter(db, EMAIL_HASH)).toBeNull(); // nada memorizado
  });

  it('email normalizado (maiúsculas/espaços) -> use_receipt_code também', () => {
    recordPendingGrant(db, pend(), now);
    expect(claimPendingGrant(db, DID, '  BUYER@Example.COM ', TOKEN, now)).toEqual({
      ok: false,
      reason: 'use_receipt_code',
    });
  });

  it('email desconhecido -> use_receipt_code igual (sem oráculo: nunca consulta a BD)', () => {
    expect(claimPendingGrant(db, DID, 'stranger@x.com', TOKEN, now)).toEqual({
      ok: false,
      reason: 'use_receipt_code',
    });
  });

  it('email SEM token do webhook -> use_receipt_code na mesma (já não depende do hash)', () => {
    recordPendingGrant(db, pend(), now);
    expect(claimPendingGrant(db, DID, EMAIL, undefined, now)).toEqual({
      ok: false,
      reason: 'use_receipt_code',
    });
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

  it('código memoriza email->Discord ID (renovações futuras resolvem-se sozinhas)', () => {
    recordPendingGrant(db, pend(), now);
    claimPendingGrant(db, DID, 'tx-1', TOKEN, now);
    expect(lookupKofiSupporter(db, EMAIL_HASH)).toBe(DID);
  });

  it('2.º claim do mesmo código -> not_found (uso único, nunca dobra o grant)', () => {
    recordPendingGrant(db, pend(), now);
    expect(claimPendingGrant(db, DID, 'tx-1', TOKEN, now).ok).toBe(true);
    expect(claimPendingGrant(db, DID, 'tx-1', TOKEN, now)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('input vazio -> not_found', () => {
    expect(claimPendingGrant(db, DID, '   ', TOKEN, now)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});
