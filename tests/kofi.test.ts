import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { getPremiumPass, isUserPremium } from '../src/store/premium';
import {
  parseKofiPayload,
  verifyKofiToken,
  extractDiscordId,
  mapKofiToGrant,
  PREMIUM_PASS_SEATS,
} from '../src/premium/kofi';
import { applyKofiGrant } from '../src/premium/kofiWebhook';

const DID = '123456789012345678'; // 18 dígitos

function kofiJson(over: Record<string, unknown>): string {
  return JSON.stringify({
    verification_token: 'tok',
    type: 'Subscription',
    message: `Discord: ${DID}`,
    is_subscription_payment: true,
    tier_name: 'Vozen Premium — Monthly',
    ...over,
  });
}

describe('kofi — parsing do payload', () => {
  it('form-encoded (data=<json>) é lido', () => {
    const raw = 'data=' + encodeURIComponent(kofiJson({}));
    const e = parseKofiPayload(raw);
    expect(e?.verificationToken).toBe('tok');
    expect(e?.tierName).toBe('Vozen Premium — Monthly');
    expect(e?.message).toContain(DID);
  });
  it('JSON puro também (útil em testes)', () => {
    expect(parseKofiPayload(kofiJson({}))?.type).toBe('Subscription');
  });
  it('lixo -> null', () => {
    expect(parseKofiPayload('nonsense{')).toBeNull();
  });
  it('shop_items -> shopItemsText concatenado', () => {
    const raw = kofiJson({
      type: 'Shop Order',
      tier_name: null,
      shop_items: [{ variation_name: 'Vozen Premium Annual', direct_link_code: 'abc' }],
    });
    expect(parseKofiPayload(raw)?.shopItemsText).toMatch(/Premium Annual/);
  });
});

describe('kofi — token e Discord ID', () => {
  it('verifyKofiToken: igual passa, diferente/vazio falha', () => {
    const e = parseKofiPayload(kofiJson({}))!;
    expect(verifyKofiToken(e, 'tok')).toBe(true);
    expect(verifyKofiToken(e, 'outro')).toBe(false);
    expect(verifyKofiToken(e, undefined)).toBe(false);
    expect(verifyKofiToken(e, '')).toBe(false);
  });
  it('extractDiscordId: apanha 17–20 dígitos, senão null', () => {
    expect(extractDiscordId(`o meu id é ${DID} obrigado`)).toBe(DID);
    expect(extractDiscordId('sem id')).toBeNull();
    expect(extractDiscordId(null)).toBeNull();
    expect(extractDiscordId('123')).toBeNull();
  });
});

describe('kofi — mapeamento produto -> grant', () => {
  const now = 1_000_000;
  it('Premium mensal -> premium, 30 dias, 2 licenças', () => {
    const g = mapKofiToGrant(parseKofiPayload(kofiJson({}))!, now)!;
    expect(g.plan).toBe('premium');
    expect(g.days).toBe(30);
    expect(g.seats).toBe(PREMIUM_PASS_SEATS);
    expect(g.discordId).toBe(DID);
  });
  it('Premium anual -> 365 dias', () => {
    const g = mapKofiToGrant(
      parseKofiPayload(kofiJson({ tier_name: 'Vozen Premium — Annual' }))!,
      now,
    )!;
    expect(g.days).toBe(365);
  });
  it('Plus -> plan plus', () => {
    const g = mapKofiToGrant(parseKofiPayload(kofiJson({ tier_name: 'Vozen Plus' }))!, now)!;
    expect(g.plan).toBe('plus');
  });
  it('anual via shop_items (variation_name)', () => {
    const raw = kofiJson({
      type: 'Shop Order',
      tier_name: null,
      shop_items: [{ variation_name: 'Vozen Plus Annual' }],
    });
    const g = mapKofiToGrant(parseKofiPayload(raw)!, now)!;
    expect(g.plan).toBe('plus');
    expect(g.days).toBe(365);
  });
  it('donativo avulso (sem premium/plus) -> null (ignorado)', () => {
    const raw = kofiJson({ type: 'Donation', tier_name: null, message: 'obrigado!' });
    expect(mapKofiToGrant(parseKofiPayload(raw)!, now)).toBeNull();
  });
});

describe('kofi — aplicação do grant no store', () => {
  let db: Database.Database;
  const now = 1_000_000;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('premium -> passe de 2 licenças no comprador', () => {
    const g = mapKofiToGrant(parseKofiPayload(kofiJson({}))!, now)!;
    const exp = applyKofiGrant(db, g, now);
    expect(exp).toBe(now + 30 * 86_400_000);
    const pass = getPremiumPass(db, DID)!;
    expect(pass.seats).toBe(2);
    expect(pass.source).toBe('kofi');
  });
  it('plus -> Vozen Plus no utilizador', () => {
    const g = mapKofiToGrant(parseKofiPayload(kofiJson({ tier_name: 'Vozen Plus' }))!, now)!;
    applyKofiGrant(db, g, now);
    expect(isUserPremium(db, DID, now + 1000)).toBe(true);
  });
  it('sem Discord ID -> não aplica, devolve null (grant manual)', () => {
    const g = mapKofiToGrant(parseKofiPayload(kofiJson({ message: 'sem id aqui' }))!, now)!;
    expect(g.discordId).toBeNull();
    expect(applyKofiGrant(db, g, now)).toBeNull();
    expect(getPremiumPass(db, DID)).toBeNull();
  });
});
