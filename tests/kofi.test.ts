import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { getPremiumPass, isUserPremium, recordKofiTransaction } from '../src/store/premium';
import {
  parseKofiPayload,
  verifyKofiToken,
  extractDiscordId,
  mapKofiToGrant,
  PREMIUM_PASS_SEATS,
} from '../src/premium/kofi';
import { applyKofiGrant, resolveKofiDiscordId } from '../src/premium/kofiWebhook';
import { startKofiWebhook } from '../src/premium/kofiWebhook';

const DID = '123456789012345678'; // 18 dígitos
const EMAIL = 'buyer@example.com';

function kofiJson(over: Record<string, unknown>): string {
  return JSON.stringify({
    verification_token: 'tok',
    type: 'Subscription',
    message: `Discord: ${DID}`,
    is_subscription_payment: true,
    tier_name: 'Vozen Premium — Monthly',
    email: EMAIL,
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
    expect(pass.seats).toBe(3);
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

describe('kofi — renovações (email -> Discord ID)', () => {
  let db: Database.Database;
  const now = 1_000_000;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('parse traz o email do comprador', () => {
    expect(parseKofiPayload(kofiJson({}))?.email).toBe(EMAIL);
  });

  it('1.ª compra: Discord ID da mensagem é memorizado por email', () => {
    const e = parseKofiPayload(kofiJson({}))!;
    const g = mapKofiToGrant(e, now)!;
    expect(resolveKofiDiscordId(db, e, g, now)).toBe(DID);
  });

  it('renovação SEM mensagem: reencontra o Discord ID pelo email', () => {
    // 1.ª compra memoriza
    const e1 = parseKofiPayload(kofiJson({}))!;
    resolveKofiDiscordId(db, e1, mapKofiToGrant(e1, now)!, now);
    // renovação: sem Discord ID na mensagem, mesmo email
    const e2 = parseKofiPayload(kofiJson({ message: 'Renewal' }))!;
    const g2 = mapKofiToGrant(e2, now)!;
    expect(g2.discordId).toBeNull(); // a mensagem já não o traz
    const resolvedId = resolveKofiDiscordId(db, e2, g2, now);
    expect(resolvedId).toBe(DID); // ...mas o email reencontra-o
    // e o grant aplica-se e estende o passe
    const exp = applyKofiGrant(db, { ...g2, discordId: resolvedId }, now + 30 * 86_400_000);
    expect(exp).not.toBeNull();
    expect(getPremiumPass(db, DID)).not.toBeNull();
  });

  it('renovação de email desconhecido -> null (cai no grant manual)', () => {
    const e = parseKofiPayload(kofiJson({ message: 'no id', email: 'stranger@x.com' }))!;
    const g = mapKofiToGrant(e, now)!;
    expect(resolveKofiDiscordId(db, e, g, now)).toBeNull();
  });
});

describe('kofiWebhook — API Premium HTTP', () => {
  let db: Database.Database;
  let server: Server | null = null;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    db.close();
  });

  it('limita o mapa de rate-limit por IP para não crescer sem fim', async () => {
    const statusApi = {
      getStatus: vi.fn(async () => ({ code: 401, body: { error: 'invalid_token' } })),
      resolveIdentity: vi.fn(),
    };
    server = startKofiWebhook({
      db,
      token: undefined,
      port: 0,
      now: () => 1_000_000,
      logInfo: () => {},
      logError: () => {},
      statusApi,
      apiOrigin: 'https://vozen.org',
      apiRateMaxEntries: 2,
    });
    expect(server).not.toBeNull();
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const addr = server!.address();
    if (!addr || typeof addr === 'string') throw new Error('porta efémera indisponível');
    const url = `http://127.0.0.1:${addr.port}/api/me/premium`;
    const req = (ip: string) =>
      fetch(url, {
        headers: { Authorization: 'Bearer mau', 'X-Forwarded-For': ip },
      });

    for (let i = 0; i < 30; i++) {
      expect((await req('10.0.0.1')).status).toBe(401);
    }
    expect((await req('10.0.0.1')).status).toBe(429);

    expect((await req('10.0.0.2')).status).toBe(401);
    expect((await req('10.0.0.3')).status).toBe(401);
    expect((await req('10.0.0.1')).status).toBe(401);
  });
});

describe('kofi — idempotência do webhook (retries do Ko-fi não duplicam o grant)', () => {
  let db: Database.Database;
  let server: Server | null = null;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    db.close();
  });

  it('recordKofiTransaction: 1.ª vez true, duplicado false', () => {
    expect(recordKofiTransaction(db, 'tx-a', 1000)).toBe(true);
    expect(recordKofiTransaction(db, 'tx-a', 2000)).toBe(false);
    expect(recordKofiTransaction(db, 'tx-b', 3000)).toBe(true);
  });

  async function startAndPost(payload: string): Promise<number> {
    const res = await fetch(urlOf(server!), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    return res.status;
  }
  function urlOf(s: Server): string {
    const addr = s.address();
    if (!addr || typeof addr === 'string') throw new Error('porta efémera indisponível');
    return `http://127.0.0.1:${addr.port}/`;
  }

  it('mesma entrega 2x (mesmo kofi_transaction_id) -> o expiry só estende UMA vez', async () => {
    server = startKofiWebhook({
      db,
      token: 'tok',
      port: 0,
      now: () => 1_000_000,
      logInfo: () => {},
      logError: () => {},
    });
    expect(server).not.toBeNull();
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));

    const payload = kofiJson({ kofi_transaction_id: 'tx-dup-1' });
    expect(await startAndPost(payload)).toBe(200);
    const passAfter1 = getPremiumPass(db, DID);
    expect(passAfter1).not.toBeNull();

    // Retry do Ko-fi: MESMO tx id -> 200 (ack) mas SEM re-aplicar o grant.
    expect(await startAndPost(payload)).toBe(200);
    const passAfter2 = getPremiumPass(db, DID);
    expect(passAfter2?.expiresAt).toBe(passAfter1?.expiresAt);
  });

  it('renovação legítima (tx id DIFERENTE) -> estende de novo', async () => {
    server = startKofiWebhook({
      db,
      token: 'tok',
      port: 0,
      now: () => 1_000_000,
      logInfo: () => {},
      logError: () => {},
    });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));

    expect(await startAndPost(kofiJson({ kofi_transaction_id: 'tx-r1' }))).toBe(200);
    const after1 = getPremiumPass(db, DID)!.expiresAt;
    expect(await startAndPost(kofiJson({ kofi_transaction_id: 'tx-r2' }))).toBe(200);
    const after2 = getPremiumPass(db, DID)!.expiresAt;
    expect(after2).toBeGreaterThan(after1);
  });

  it('payload SEM tx id (atípico) -> processa na mesma (não fica bloqueado)', async () => {
    server = startKofiWebhook({
      db,
      token: 'tok',
      port: 0,
      now: () => 1_000_000,
      logInfo: () => {},
      logError: () => {},
    });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));

    expect(await startAndPost(kofiJson({ kofi_transaction_id: null }))).toBe(200);
    expect(getPremiumPass(db, DID)).not.toBeNull();
  });
});
