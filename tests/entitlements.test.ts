// tests/entitlements.test.ts — Premium Apps do Discord (Fase 3 compliance).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  activeEntitlementGrants,
  isEntitlementActive,
  entitlementsEnabled,
  PERPETUAL_MS,
  type EntitlementLike,
} from '../src/premium/entitlements';
import {
  isGuildPremium,
  isUserPremium,
  grantGuildPremium,
  syncDiscordEntitlements,
} from '../src/store/premium';

const SKU = { guildSkuId: 'sku-guild', userSkuId: 'sku-user' };
const NOW = 1_000_000;

describe('entitlements — mapeamento puro', () => {
  it('entitlement ativo do SKU de guild -> grant de guild', () => {
    const ents: EntitlementLike[] = [
      { skuId: 'sku-guild', guildId: 'g1', endsTimestamp: NOW + 100_000 },
    ];
    expect(activeEntitlementGrants(ents, SKU, NOW)).toEqual([
      { kind: 'guild', id: 'g1', expiresAt: NOW + 100_000 },
    ]);
  });

  it('endsTimestamp null (compra única) -> expiry perpétuo', () => {
    const ents: EntitlementLike[] = [{ skuId: 'sku-user', userId: 'u1', endsTimestamp: null }];
    const grants = activeEntitlementGrants(ents, SKU, NOW);
    expect(grants[0]).toEqual({ kind: 'user', id: 'u1', expiresAt: NOW + PERPETUAL_MS });
  });

  it('ignora entitlements expirados, removidos, ou de SKU desconhecido', () => {
    const ents: EntitlementLike[] = [
      { skuId: 'sku-guild', guildId: 'g-old', endsTimestamp: NOW - 1 }, // expirado
      { skuId: 'sku-user', userId: 'u-refund', endsTimestamp: NOW + 1, deleted: true }, // reembolso
      { skuId: 'sku-desconhecido', guildId: 'g-x', endsTimestamp: NOW + 1 }, // SKU não configurado
    ];
    expect(activeEntitlementGrants(ents, SKU, NOW)).toEqual([]);
  });

  it('ignora entitlement sem o id do alvo', () => {
    const ents: EntitlementLike[] = [{ skuId: 'sku-guild', guildId: null, endsTimestamp: NOW + 1 }];
    expect(activeEntitlementGrants(ents, SKU, NOW)).toEqual([]);
  });

  it('só o SKU configurado conta (sem userSku -> ignora entitlements de user)', () => {
    const ents: EntitlementLike[] = [{ skuId: 'sku-user', userId: 'u1', endsTimestamp: NOW + 1 }];
    expect(activeEntitlementGrants(ents, { guildSkuId: 'sku-guild' }, NOW)).toEqual([]);
  });

  it('isEntitlementActive: null=ativo, futuro=ativo, passado/removido=inativo', () => {
    expect(isEntitlementActive({ skuId: 's', endsTimestamp: null }, NOW)).toBe(true);
    expect(isEntitlementActive({ skuId: 's', endsTimestamp: NOW + 1 }, NOW)).toBe(true);
    expect(isEntitlementActive({ skuId: 's', endsTimestamp: NOW - 1 }, NOW)).toBe(false);
    expect(isEntitlementActive({ skuId: 's', endsTimestamp: NOW + 1, deleted: true }, NOW)).toBe(false);
  });

  it('entitlementsEnabled: false sem SKUs, true com pelo menos um', () => {
    expect(entitlementsEnabled({})).toBe(false);
    expect(entitlementsEnabled({ guildSkuId: 'x' })).toBe(true);
    expect(entitlementsEnabled({ userSkuId: 'y' })).toBe(true);
  });
});

describe('syncDiscordEntitlements — reconciliação com premium_*', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('concede premium a guild e user ativos', () => {
    const res = syncDiscordEntitlements(db, [
      { kind: 'guild', id: 'g1', expiresAt: NOW + 100_000 },
      { kind: 'user', id: 'u1', expiresAt: NOW + 100_000 },
    ]);
    expect(res).toEqual({ guildsActive: 1, usersActive: 1, revoked: 0 });
    expect(isGuildPremium(db, 'g1', NOW)).toBe(true);
    expect(isUserPremium(db, 'u1', NOW)).toBe(true);
  });

  it('revoga um entitlement que deixou de estar ativo (reembolso/cancelamento)', () => {
    syncDiscordEntitlements(db, [{ kind: 'guild', id: 'g1', expiresAt: NOW + 100_000 }]);
    expect(isGuildPremium(db, 'g1', NOW)).toBe(true);
    // Sync seguinte sem g1 -> revoga.
    const res = syncDiscordEntitlements(db, []);
    expect(res.revoked).toBe(1);
    expect(isGuildPremium(db, 'g1', NOW)).toBe(false);
  });

  it('NÃO revoga premium de outra origem (redeem) — só linhas source=discord', () => {
    // Redeem dá premium longo à guild.
    grantGuildPremium(db, 'g-redeem', 365, 'redeem', NOW);
    // Sync do discord SEM g-redeem não a deve tocar.
    syncDiscordEntitlements(db, []);
    expect(isGuildPremium(db, 'g-redeem', NOW)).toBe(true);
  });

  it('nunca ENCURTA: redeem mais longo sobrevive a um entitlement discord mais curto', () => {
    grantGuildPremium(db, 'g1', 365, 'redeem', NOW); // ~1 ano
    syncDiscordEntitlements(db, [{ kind: 'guild', id: 'g1', expiresAt: NOW + 1000 }]); // curto
    // Expiry fica no MÁXIMO (o do redeem) e a linha mantém-se premium.
    expect(isGuildPremium(db, 'g1', NOW + 2000)).toBe(true); // ainda premium bem depois do discord
  });
});
