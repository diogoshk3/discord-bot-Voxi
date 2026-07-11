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
  hashKofiEmail,
  PREMIUM_PASS_SEATS,
  PREMIUM_MAX_SEATS,
} from '../src/premium/kofi';
import { applyKofiGrant, resolveKofiDiscordId } from '../src/premium/kofiWebhook';
import { startKofiWebhook } from '../src/premium/kofiWebhook';

const DID = '123456789012345678'; // 18 dígitos
const EMAIL = 'buyer@example.com';
const TOKEN = 'kofi-webhook-secret-xyz'; // chave do HMAC do email nos testes

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
  it('Premium Max mensal -> premium, 30 dias, 8 licenças (deal grande = 8 servidores)', () => {
    const g = mapKofiToGrant(parseKofiPayload(kofiJson({ tier_name: 'Vozen Premium Max' }))!, now)!;
    expect(g.plan).toBe('premium');
    // Decisão de produto 2026-07-11: o deal grande passou de 10 para 8 servidores.
    expect(PREMIUM_MAX_SEATS).toBe(8);
    expect(g.seats).toBe(PREMIUM_MAX_SEATS);
    expect(g.days).toBe(30);
  });
  it('Premium Max anual -> 8 licenças, 365 dias', () => {
    const g = mapKofiToGrant(
      parseKofiPayload(kofiJson({ tier_name: 'Vozen Premium Max — Annual' }))!,
      now,
    )!;
    expect(g.seats).toBe(PREMIUM_MAX_SEATS);
    expect(g.days).toBe(365);
  });
  it('Premium SEM "max" mantém 3 licenças (não é mal-mapeado para Max)', () => {
    const g = mapKofiToGrant(parseKofiPayload(kofiJson({ tier_name: 'Vozen Premium' }))!, now)!;
    expect(g.seats).toBe(PREMIUM_PASS_SEATS);
  });
  // Nomes REAIS dos produtos no Ko-fi (2026-07): o nº de servidores vem do nome
  // "(N servers)", já não da palavra "max" (que foi retirada dos produtos).
  // Desde 2026-07-11 o deal grande é "(8 servers)"; "(10 servers)" fica testado
  // como grandfathering (renovações de compras antigas mantêm as 10 licenças).
  it('produto real: "Premium (8 servers) 1 month" -> 8 licenças, 30 dias', () => {
    const g = mapKofiToGrant(
      parseKofiPayload(kofiJson({ tier_name: 'Vozen Premium (8 servers) 1 month' }))!,
      now,
    )!;
    expect(g.plan).toBe('premium');
    expect(g.seats).toBe(8);
    expect(g.days).toBe(30);
  });
  it('produto real: "Premium (8 servers) 1 year" -> 8 licenças, 365 dias', () => {
    const g = mapKofiToGrant(
      parseKofiPayload(kofiJson({ tier_name: 'Vozen Premium (8 servers) 1 year' }))!,
      now,
    )!;
    expect(g.seats).toBe(8);
    expect(g.days).toBe(365);
  });
  it('grandfathering: "Premium (10 servers) 1 month" -> continua a dar 10 licenças', () => {
    const g = mapKofiToGrant(
      parseKofiPayload(kofiJson({ tier_name: 'Vozen Premium (10 servers) 1 month' }))!,
      now,
    )!;
    expect(g.plan).toBe('premium');
    expect(g.seats).toBe(10);
    expect(g.days).toBe(30);
  });
  it('produto real: "Premium (3 servers) 1 year" -> 3 licenças, 365 dias', () => {
    const g = mapKofiToGrant(
      parseKofiPayload(kofiJson({ tier_name: 'Vozen Premium (3 servers) 1 year' }))!,
      now,
    )!;
    expect(g.seats).toBe(3);
    expect(g.days).toBe(365);
  });
  it('grandfathering: "Premium (10 servers) 1 year" -> continua a dar 10 licenças', () => {
    const g = mapKofiToGrant(
      parseKofiPayload(kofiJson({ tier_name: 'Vozen Premium (10 servers) 1 year' }))!,
      now,
    )!;
    expect(g.seats).toBe(10);
    expect(g.days).toBe(365);
  });
  it('produto real: "Plus 1 year" -> plus, 365 dias; "Plus 1 month" -> 30 dias', () => {
    const yr = mapKofiToGrant(
      parseKofiPayload(kofiJson({ tier_name: 'Vozen Plus 1 year' }))!,
      now,
    )!;
    expect(yr.plan).toBe('plus');
    expect(yr.days).toBe(365);
    const mo = mapKofiToGrant(
      parseKofiPayload(kofiJson({ tier_name: 'Vozen Plus 1 month' }))!,
      now,
    )!;
    expect(mo.plan).toBe('plus');
    expect(mo.days).toBe(30);
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

describe('kofi — hashKofiEmail (minimização de PII)', () => {
  it('determinístico e case/space-insensitive (mesma pessoa -> mesmo hash)', () => {
    expect(hashKofiEmail(TOKEN, EMAIL)).toBe(hashKofiEmail(TOKEN, EMAIL));
    expect(hashKofiEmail(TOKEN, '  Buyer@Example.COM ')).toBe(hashKofiEmail(TOKEN, EMAIL));
  });
  it('é hex de 64 chars e NUNCA revela o email', () => {
    const h = hashKofiEmail(TOKEN, EMAIL);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain('buyer');
    expect(h).not.toContain('example');
  });
  it('depende do token (segredo do webhook = chave do HMAC)', () => {
    expect(hashKofiEmail('token-A', EMAIL)).not.toBe(hashKofiEmail('token-B', EMAIL));
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
    expect(resolveKofiDiscordId(db, e, g, now, TOKEN)).toBe(DID);
  });

  it('renovação SEM mensagem: reencontra o Discord ID pelo email', () => {
    // 1.ª compra memoriza
    const e1 = parseKofiPayload(kofiJson({}))!;
    resolveKofiDiscordId(db, e1, mapKofiToGrant(e1, now)!, now, TOKEN);
    // renovação: sem Discord ID na mensagem, mesmo email
    const e2 = parseKofiPayload(kofiJson({ message: 'Renewal' }))!;
    const g2 = mapKofiToGrant(e2, now)!;
    expect(g2.discordId).toBeNull(); // a mensagem já não o traz
    const resolvedId = resolveKofiDiscordId(db, e2, g2, now, TOKEN);
    expect(resolvedId).toBe(DID); // ...mas o email reencontra-o
    // e o grant aplica-se e estende o passe
    const exp = applyKofiGrant(db, { ...g2, discordId: resolvedId }, now + 30 * 86_400_000);
    expect(exp).not.toBeNull();
    expect(getPremiumPass(db, DID)).not.toBeNull();
  });

  it('renovação de email desconhecido -> null (cai no grant manual)', () => {
    const e = parseKofiPayload(kofiJson({ message: 'no id', email: 'stranger@x.com' }))!;
    const g = mapKofiToGrant(e, now)!;
    expect(resolveKofiDiscordId(db, e, g, now, TOKEN)).toBeNull();
  });

  it('SEC: a BD NÃO guarda o email em claro — só o hash HMAC (minimização de PII)', () => {
    const e = parseKofiPayload(kofiJson({}))!;
    resolveKofiDiscordId(db, e, mapKofiToGrant(e, now)!, now, TOKEN);
    // Vasculha TODAS as colunas de todas as linhas: o email em claro não pode aparecer.
    const rows = db.prepare('SELECT * FROM kofi_supporter').all() as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(EMAIL); // nem o email...
    expect(dump).not.toContain('example.com'); // ...nem o domínio
    expect(dump).toContain(hashKofiEmail(TOKEN, EMAIL)); // guarda o hash
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

  // Cola HTTP do endpoint do painel: preflight, método, wiring do 200 + header CORS.
  async function startApi(
    getStatus: () => Promise<{ code: number; body: unknown }>,
  ): Promise<string> {
    const statusApi = { getStatus: vi.fn(getStatus), resolveIdentity: vi.fn() };
    server = startKofiWebhook({
      db,
      token: undefined,
      port: 0,
      now: () => 1_000_000,
      logInfo: () => {},
      logError: () => {},
      statusApi,
      apiOrigin: 'https://vozen.org',
    });
    if (!server) throw new Error('servidor não arrancou');
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('porta efémera indisponível');
    return `http://127.0.0.1:${addr.port}/api/me/premium`;
  }

  it('OPTIONS -> 204 com CORS + Allow-Methods (preflight do browser)', async () => {
    const url = await startApi(async () => ({ code: 200, body: {} }));
    const res = await fetch(url, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://vozen.org');
    expect(res.headers.get('access-control-allow-methods')).toMatch(/GET/);
  });

  it('método não-GET/OPTIONS (ex. PUT) -> 405 com header CORS', async () => {
    const url = await startApi(async () => ({ code: 200, body: {} }));
    const res = await fetch(url, { method: 'PUT' });
    expect(res.status).toBe(405);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://vozen.org');
  });

  it('GET com token válido -> 200 com o body do statusApi + Content-Type + CORS', async () => {
    const url = await startApi(async () => ({ code: 200, body: { premium: true, plan: 'plus' } }));
    const res = await fetch(url, { headers: { Authorization: 'Bearer bom' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://vozen.org');
    expect(await res.json()).toEqual({ premium: true, plan: 'plus' });
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

  it('XFF forjado à esquerda NÃO roda buckets (identidade = último elemento)', async () => {
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
    });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const addr = server!.address();
    if (!addr || typeof addr === 'string') throw new Error('porta efémera indisponível');
    const url = `http://127.0.0.1:${addr.port}/api/me/premium`;

    // 30 pedidos com prefixo forjado DIFERENTE mas o mesmo IP real no fim -> mesma janela.
    for (let i = 0; i < 30; i++) {
      const res = await fetch(url, {
        headers: { Authorization: 'Bearer mau', 'X-Forwarded-For': `1.2.3.${i}, 10.9.9.9` },
      });
      expect(res.status).toBe(401);
    }
    const blocked = await fetch(url, {
      headers: { Authorization: 'Bearer mau', 'X-Forwarded-For': '9.9.9.9, 10.9.9.9' },
    });
    expect(blocked.status).toBe(429);
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

  it('ramos de erro do POST: token errado 401 (sem grant), lixo 400, corpo >64KB 413', async () => {
    server = startKofiWebhook({
      db,
      token: 'tok',
      port: 0,
      now: () => 1_000_000,
      logInfo: () => {},
      logError: () => {},
    });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));

    // Token de verificação errado -> 401 e NADA é aplicado no store.
    expect(await startAndPost(kofiJson({ verification_token: 'errado' }))).toBe(401);
    expect(getPremiumPass(db, DID)).toBeNull();

    // Payload ilegível -> 400.
    expect(await startAndPost('nonsense{')).toBe(400);

    // Corpo acima do teto de 64KB -> abortado cedo: ou 413, ou o socket é destruído a
    // meio do upload (o fetch vê ECONNRESET). Ambos provam o guard anti-DoS.
    const oversized = await startAndPost('x'.repeat(65 * 1024)).then(
      (status) => status,
      () => 'reset' as const,
    );
    expect([413, 'reset']).toContain(oversized);

    // E depois dos erros, um POST válido continua a funcionar.
    expect(await startAndPost(kofiJson({ kofi_transaction_id: 'tx-ok' }))).toBe(200);
    expect(getPremiumPass(db, DID)).not.toBeNull();
  });

  it('falha de DB no grant -> 503 (Ko-fi re-tenta), não 200 que perderia a compra', async () => {
    server = startKofiWebhook({
      db,
      token: 'tok',
      port: 0,
      now: () => 1_000_000,
      logInfo: () => {},
      logError: () => {},
    });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));

    // Simula uma falha de escrita (SQLITE_BUSY, disco cheio, I/O) DURANTE a transação do
    // grant — o payload é válido, só a persistência é que rebenta. O Ko-fi só re-tenta em
    // não-2xx, por isso responder 200 aqui perdia a compra paga em silêncio.
    (db as { transaction: unknown }).transaction = () => () => {
      throw new Error('SQLITE_BUSY: simulado');
    };

    const status = await startAndPost(kofiJson({ kofi_transaction_id: 'tx-db-fail' }));
    expect(status).toBe(503);
  });

  it('grant manual: NÃO regista o nome do comprador (PII), só o tx id', async () => {
    const logs: string[] = [];
    server = startKofiWebhook({
      db,
      token: 'tok',
      port: 0,
      now: () => 1_000_000,
      logInfo: () => {},
      logError: (msg: string) => {
        logs.push(msg);
      },
    });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));

    // Compra sem Discord ID resolúvel (mensagem sem id + email desconhecido) -> caminho do
    // grant MANUAL, onde antes se registava o nome do comprador (PII).
    const status = await startAndPost(
      kofiJson({
        message: 'obrigado!',
        email: 'stranger@example.com',
        from_name: 'João Comprador',
        kofi_transaction_id: 'tx-anon',
      }),
    );
    expect(status).toBe(200);
    const joined = logs.join('\n');
    expect(joined).toContain('tx-anon'); // dá para reconciliar a compra no Ko-fi...
    expect(joined).not.toContain('João Comprador'); // ...mas o nome NUNCA entra no log.
  });
});
