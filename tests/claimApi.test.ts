// tests/claimApi.test.ts — endpoint HTTP POST /api/link (claim autenticado por OAuth Discord).
//
// O comprador, logado no site com Discord (OAuth), cola o código da transação do recibo. O
// endpoint valida a identidade (statusApi.resolveIdentity), reclama o pendente e ativa.
// Rate-limit próprio (anti-brute-force do código), uso único, CORS restrito. Um `code` com
// '@' (email) é rejeitado com 400 `use_receipt_code` — plano 021, o email não é aceite como
// prova de posse. Ver src/premium/kofiWebhook.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { startKofiWebhook } from '../src/premium/kofiWebhook';
import { recordPendingGrant, findUnclaimedPendingByTx } from '../src/store/kofiPending';
import { hashKofiEmail } from '../src/premium/kofi';
import { isUserPremium } from '../src/store/premium';

const DID = '999888777666555444';

/** statusApi falso: mapeia token->identidade (null = inválido). */
function makeStatusApi(identityByToken: Record<string, { id: string } | null>) {
  return {
    getStatus: vi.fn(async () => ({ code: 200, body: {} })),
    resolveIdentity: vi.fn(async (token: string) => {
      const i = identityByToken[token];
      return i ? { id: i.id, username: 'u', avatar: null } : null;
    }),
  };
}

describe('POST /api/link — claim autenticado', () => {
  let db: Database.Database;
  let server: Server | null = null;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
    db.close();
  });

  async function start(statusApi: unknown): Promise<string> {
    server = startKofiWebhook({
      db,
      token: 'tok',
      port: 0,
      now: () => 1_000_000,
      logInfo: () => {},
      logError: () => {},
      statusApi: statusApi as never,
      apiOrigin: 'https://vozen.org',
    });
    if (!server) throw new Error('sem servidor');
    await new Promise<void>((r) => server!.once('listening', () => r()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('sem porta');
    return `http://127.0.0.1:${addr.port}/api/link`;
  }
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('sem token -> 401', async () => {
    const url = await start(makeStatusApi({}));
    expect((await post(url, { code: 'x' })).status).toBe(401);
  });

  it('token inválido -> 401', async () => {
    const url = await start(makeStatusApi({ bom: { id: DID } }));
    const res = await post(url, { code: 'x' }, { authorization: 'Bearer mau' });
    expect(res.status).toBe(401);
  });

  it('sem código no body -> 400', async () => {
    const url = await start(makeStatusApi({ bom: { id: DID } }));
    const res = await post(url, {}, { authorization: 'Bearer bom' });
    expect(res.status).toBe(400);
  });

  it('código válido -> 200, ativa Plus e marca reclamado', async () => {
    recordPendingGrant(
      db,
      { transactionId: 'tx-ok', emailHash: 'h', plan: 'plus', days: 30, seats: 3 },
      1,
    );
    const url = await start(makeStatusApi({ bom: { id: DID } }));
    const res = await post(url, { code: 'tx-ok' }, { authorization: 'Bearer bom' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; items: { plan: string }[] };
    expect(body.ok).toBe(true);
    expect(body.items[0].plan).toBe('plus');
    expect(isUserPremium(db, DID, 2_000_000)).toBe(true);
    expect(findUnclaimedPendingByTx(db, 'tx-ok')).toBeNull();
  });

  it('email do Ko-fi -> 400 use_receipt_code (plano 021: email já não ativa nada)', async () => {
    const emailHash = hashKofiEmail('tok', 'buyer@example.com'); // 'tok' = token do webhook no start()
    recordPendingGrant(
      db,
      { transactionId: 'tx-em', emailHash, plan: 'plus', days: 30, seats: 3 },
      1,
    );
    const url = await start(makeStatusApi({ bom: { id: DID } }));
    const res = await post(url, { code: 'buyer@example.com' }, { authorization: 'Bearer bom' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('use_receipt_code');
    expect(isUserPremium(db, DID, 2_000_000)).toBe(false);
    expect(findUnclaimedPendingByTx(db, 'tx-em')).not.toBeNull(); // continua por reclamar
  });

  it('código desconhecido -> 404 (genérico, sem oráculo)', async () => {
    const url = await start(makeStatusApi({ bom: { id: DID } }));
    const res = await post(url, { code: 'nada' }, { authorization: 'Bearer bom' });
    expect(res.status).toBe(404);
  });

  it('OPTIONS preflight -> 204 com CORS + POST permitido', async () => {
    const url = await start(makeStatusApi({}));
    const res = await fetch(url, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://vozen.org');
    expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
  });

  it('GET (método errado) -> 405', async () => {
    const url = await start(makeStatusApi({}));
    expect((await fetch(url, { method: 'GET' })).status).toBe(405);
  });

  it('rate-limit anti-brute-force: 6.ª tentativa do mesmo IP -> 429', async () => {
    const url = await start(makeStatusApi({ bom: { id: DID } }));
    for (let i = 0; i < 5; i++) {
      const r = await post(
        url,
        { code: 'nada' },
        { authorization: 'Bearer bom', 'x-forwarded-for': '5.5.5.5' },
      );
      expect(r.status).toBe(404); // não encontrado, mas conta para o limite
    }
    const blocked = await post(
      url,
      { code: 'nada' },
      { authorization: 'Bearer bom', 'x-forwarded-for': '5.5.5.5' },
    );
    expect(blocked.status).toBe(429);
  });
});
