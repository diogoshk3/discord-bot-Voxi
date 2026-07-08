import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { grantUserPremium, grantGuildPass, activateSeat } from '../src/store/premium';
import { createStatusApi } from '../src/premium/statusApi';

const DID = '123456789012345678';

/** Fake fetch: devolve o utilizador `id` para o token `goodToken`; 401 para o resto. */
function fakeFetch(goodToken: string, id: string, user: Record<string, unknown> = {}) {
  const fn = vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
    const auth = init?.headers?.Authorization ?? '';
    const ok = auth === `Bearer ${goodToken}`;
    return {
      ok,
      json: async () =>
        ok ? { id, username: 'buyer', ...user } : { message: '401: Unauthorized' },
    } as unknown as Response;
  });
  return fn as unknown as typeof fetch & typeof fn;
}

describe('statusApi — validação de token e montagem do estado', () => {
  let db: Database.Database;
  const now = 1_000_000;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('sem token -> 401 no_token (nem chama a Discord)', async () => {
    const fetchImpl = fakeFetch('tok', DID);
    const api = createStatusApi({ db, now: () => now, fetchImpl });
    const r = await api.getStatus(null);
    expect(r.code).toBe(401);
    expect((r.body as { error: string }).error).toBe('no_token');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('token inválido -> 401 invalid_token', async () => {
    const api = createStatusApi({ db, now: () => now, fetchImpl: fakeFetch('tok', DID) });
    const r = await api.getStatus('mau-token');
    expect(r.code).toBe(401);
    expect((r.body as { error: string }).error).toBe('invalid_token');
  });

  it('token válido sem premium -> 200 com plus inativo e passe null', async () => {
    const api = createStatusApi({ db, now: () => now, fetchImpl: fakeFetch('tok', DID) });
    const r = await api.getStatus('tok');
    expect(r.code).toBe(200);
    const b = r.body as { user: { id: string }; plus: { active: boolean }; pass: unknown };
    expect(b.user.id).toBe(DID);
    expect(b.plus.active).toBe(false);
    expect(b.pass).toBeNull();
  });

  it('usa global_name quando existe', async () => {
    const api = createStatusApi({
      db,
      now: () => now,
      fetchImpl: fakeFetch('tok', DID, { global_name: 'Diogo' }),
    });
    const r = await api.getStatus('tok');
    expect((r.body as { user: { username: string } }).user.username).toBe('Diogo');
  });

  it('token válido com passe -> servidores com nomes resolvidos', async () => {
    grantUserPremium(db, DID, 30, 'kofi', now);
    grantGuildPass(db, DID, 3, 30, 'kofi', now);
    activateSeat(db, DID, 'g-1', now);
    const api = createStatusApi({
      db,
      now: () => now + 1000,
      fetchImpl: fakeFetch('tok', DID),
      resolveGuildName: (id) => (id === 'g-1' ? 'Meu Servidor' : null),
    });
    const r = await api.getStatus('tok');
    const b = r.body as {
      plus: { active: boolean };
      pass: { seats: number; used: number; servers: { id: string; name: string | null }[] };
    };
    expect(b.plus.active).toBe(true);
    expect(b.pass.seats).toBe(3);
    expect(b.pass.used).toBe(1);
    expect(b.pass.servers).toEqual([{ id: 'g-1', name: 'Meu Servidor' }]);
  });

  it('cacheia a identidade: 2 pedidos = 1 fetch à Discord', async () => {
    const fetchImpl = fakeFetch('tok', DID);
    const api = createStatusApi({ db, now: () => now, fetchImpl });
    await api.getStatus('tok');
    await api.getStatus('tok');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a cache expira após o TTL -> volta a chamar a Discord', async () => {
    const fetchImpl = fakeFetch('tok', DID);
    let clock = now;
    const api = createStatusApi({ db, now: () => clock, fetchImpl, identityTtlMs: 1000 });
    await api.getStatus('tok');
    clock += 2000;
    await api.getStatus('tok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
