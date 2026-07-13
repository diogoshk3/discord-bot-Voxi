// tests/kofiPending.test.ts — grants PENDENTES do Ko-fi (compra sem Discord ID).
//
// O checkout de SUBSCRIÇÃO do Ko-fi não tem caixa de mensagem fiável, por isso o comprador
// não consegue meter o Discord ID no pagamento (confirmado por logs de produção: "compra SEM
// Discord ID válido — grant MANUAL"). Em vez de só logar, guardamos a compra como PENDENTE,
// indexada pelo tx id (que o comprador tem no recibo) e pelo HASH do email (nunca em claro).
// O comprador reclama-a depois no site (login Discord + código) — ver src/store/kofiPending.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  recordPendingGrant,
  findUnclaimedPendingByTx,
  listUnclaimedPendingByEmailHash,
  markPendingClaimed,
  purgeOldPendingGrants,
  startPendingPurgeJob,
} from '../src/store/kofiPending';

describe('kofiPending — grants pendentes (compra sem Discord ID)', () => {
  let db: Database.Database;
  const now = 1_000_000;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  const input = (over: Partial<Parameters<typeof recordPendingGrant>[1]> = {}) => ({
    transactionId: 'tx-1',
    emailHash: 'hash-a',
    plan: 'plus',
    days: 30,
    seats: 3,
    ...over,
  });

  it('recordPendingGrant: 1.ª vez true, duplicado (mesmo tx) false + NÃO duplica', () => {
    expect(recordPendingGrant(db, input(), now)).toBe(true);
    expect(recordPendingGrant(db, input(), now + 5)).toBe(false); // INSERT OR IGNORE (idempotente)
    expect(listUnclaimedPendingByEmailHash(db, 'hash-a')).toHaveLength(1);
  });

  it('findUnclaimedPendingByTx: devolve o pendente com os campos certos, claimedAt null', () => {
    recordPendingGrant(db, input({ plan: 'premium', seats: 8, days: 365 }), now);
    const p = findUnclaimedPendingByTx(db, 'tx-1')!;
    expect(p.transactionId).toBe('tx-1');
    expect(p.plan).toBe('premium');
    expect(p.seats).toBe(8);
    expect(p.days).toBe(365);
    expect(p.emailHash).toBe('hash-a');
    expect(p.createdAt).toBe(now);
    expect(p.claimedAt).toBeNull();
  });

  it('findUnclaimedPendingByTx: tx inexistente -> null', () => {
    expect(findUnclaimedPendingByTx(db, 'nao-existe')).toBeNull();
  });

  it('listUnclaimedPendingByEmailHash: junta VÁRIAS compras do mesmo email (renovações órfãs)', () => {
    recordPendingGrant(db, input({ transactionId: 'tx-1' }), now);
    recordPendingGrant(db, input({ transactionId: 'tx-2' }), now + 100);
    recordPendingGrant(db, input({ transactionId: 'tx-3', emailHash: 'outro' }), now + 200);
    const mine = listUnclaimedPendingByEmailHash(db, 'hash-a');
    expect(mine.map((p) => p.transactionId).sort()).toEqual(['tx-1', 'tx-2']);
  });

  it('markPendingClaimed: marca 1x; sai das listas de NÃO-reclamados; re-marcar -> false', () => {
    recordPendingGrant(db, input(), now);
    expect(markPendingClaimed(db, 'tx-1', now + 10)).toBe(true);
    expect(findUnclaimedPendingByTx(db, 'tx-1')).toBeNull(); // já reclamado
    expect(listUnclaimedPendingByEmailHash(db, 'hash-a')).toHaveLength(0);
    expect(markPendingClaimed(db, 'tx-1', now + 20)).toBe(false); // idempotente: já estava
  });

  it('emailHash null (payload sem email) é aceite e nunca casa por email', () => {
    expect(
      recordPendingGrant(db, input({ transactionId: 'tx-sem-email', emailHash: null }), now),
    ).toBe(true);
    expect(findUnclaimedPendingByTx(db, 'tx-sem-email')!.emailHash).toBeNull();
    // Um pendente sem email nunca aparece numa busca por hash de email (claim só por tx id).
    expect(listUnclaimedPendingByEmailHash(db, 'hash-a')).toHaveLength(0);
  });

  it('purgeOldPendingGrants: remove os criados antes do cutoff, mantém os recentes', () => {
    recordPendingGrant(db, input({ transactionId: 'velho' }), now);
    recordPendingGrant(db, input({ transactionId: 'novo' }), now + 100_000);
    const removed = purgeOldPendingGrants(db, now + 50_000);
    expect(removed).toBe(1);
    expect(findUnclaimedPendingByTx(db, 'velho')).toBeNull();
    expect(findUnclaimedPendingByTx(db, 'novo')).not.toBeNull();
  });

  it('startPendingPurgeJob: corre já no arranque, purga os >90d e mantém os recentes; stop() ok', () => {
    // created_at=1 (quase epoch) está muito além dos 90 dias -> purgado no tick imediato.
    recordPendingGrant(db, input({ transactionId: 'antigo' }), 1);
    recordPendingGrant(db, input({ transactionId: 'recente' }), Date.now());
    const removed: number[] = [];
    const stop = startPendingPurgeJob(db, (n) => removed.push(n));
    expect(findUnclaimedPendingByTx(db, 'antigo')).toBeNull();
    expect(findUnclaimedPendingByTx(db, 'recente')).not.toBeNull();
    expect(removed).toEqual([1]);
    expect(() => stop()).not.toThrow();
  });
});
