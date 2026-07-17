import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { isUserPremium } from '../src/store/premium';
import { bumpTalk } from '../src/store/talkStats';
import { signAdminSession } from '../src/premium/adminAuth';
import { createAdminApi, type AdminApi } from '../src/premium/adminApi';

// The admin console logic (plan 037). This is the money surface AND the whole security boundary
// (public repos), so the tests pin the exact ways it must refuse: a non-owner identity, a bare
// Discord token where a session is required, and inert-by-default when unconfigured.

const OWNER = '1523489275155583056';
const SECRET = 'sess-secret';

const NOW = 1_700_000_000_000;

/** Fake Discord validation: 'owner-token' is the owner, 'other-token' is someone else. */
const resolveIdentity = async (token: string) => {
  if (token === 'owner-token') return { id: OWNER, username: 'owner', avatar: null };
  if (token === 'other-token') return { id: '999999999999999999', username: 'other', avatar: null };
  return null;
};

function make(
  db: Database.Database,
  over: Partial<Parameters<typeof createAdminApi>[0]> = {},
): AdminApi {
  return createAdminApi({
    db,
    now: () => NOW,
    resolveIdentity,
    adminSessionSecret: SECRET,
    ownerId: OWNER,
    logInfo: () => {},
    ...over,
  });
}

describe('adminApi — enabled / inert', () => {
  let db: Database.Database;
  beforeEach(() => (db = initDb(':memory:')));
  afterEach(() => db.close());

  it('is enabled only when the session secret and ownerId are present', () => {
    expect(make(db).enabled).toBe(true);
    expect(make(db, { adminSessionSecret: undefined }).enabled).toBe(false);
    expect(make(db, { ownerId: undefined }).enabled).toBe(false);
  });

  it('when disabled, login and authorize always refuse', async () => {
    const api = make(db, { adminSessionSecret: undefined });
    expect(await api.login('owner-token')).toEqual({ ok: false });
    expect(api.authorize('anything')).toBeNull();
  });
});

describe('adminApi — login', () => {
  let db: Database.Database;
  beforeEach(() => (db = initDb(':memory:')));
  afterEach(() => db.close());

  it('accepts the owner Discord token and mints a session authorize() accepts', async () => {
    const api = make(db);
    const res = await api.login('owner-token');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(api.authorize(res.token)).toBe(OWNER);
      expect(res.expiresAt).toBeGreaterThan(NOW);
    }
  });

  it('rejects a Discord identity that is NOT the owner', async () => {
    expect(await make(db).login('other-token')).toEqual({ ok: false });
  });

  it('rejects when the Discord token is missing or invalid', async () => {
    expect(await make(db).login(null)).toEqual({ ok: false });
    expect(await make(db).login('garbage')).toEqual({ ok: false });
  });
});

describe('adminApi — authorize (session only, owner only)', () => {
  let db: Database.Database;
  beforeEach(() => (db = initDb(':memory:')));
  afterEach(() => db.close());

  it('accepts a session signed for the owner', () => {
    const tok = signAdminSession(OWNER, SECRET, NOW);
    expect(make(db).authorize(tok)).toBe(OWNER);
  });

  it('rejects a session signed for a NON-owner id (defense in depth)', () => {
    const tok = signAdminSession('999999999999999999', SECRET, NOW);
    expect(make(db).authorize(tok)).toBeNull();
  });

  it('rejects a bare Discord token where a session is required', () => {
    // A Discord OAuth token is not an HMAC session — it must never authorize a mutation.
    expect(make(db).authorize('owner-token')).toBeNull();
  });

  it('rejects null / empty', () => {
    expect(make(db).authorize(null)).toBeNull();
    expect(make(db).authorize('')).toBeNull();
  });
});

describe('adminApi — grant / revoke / list', () => {
  let db: Database.Database;
  beforeEach(() => (db = initDb(':memory:')));
  afterEach(() => db.close());

  it('grants Plus and Premium via the tested store paths', () => {
    const api = make(db);
    const p = api.grant({ kind: 'plus', id: '111', days: 30 });
    expect(p.ok).toBe(true);
    expect(isUserPremium(db, '111', NOW)).toBe(true);

    const g = api.grant({ kind: 'premium', id: '222', days: 30, seats: 3 });
    expect(g.ok).toBe(true);
    // the pass exists; a seat can now be activated -> guild premium (covered elsewhere)
    expect(api.listPasses().passes.some((x) => x.userId === '222' && x.seats === 3)).toBe(true);
  });

  it('rejects malformed grant input', () => {
    const api = make(db);
    expect(api.grant({ kind: 'plus', id: 'not-a-snowflake', days: 30 }).ok).toBe(false);
    expect(api.grant({ kind: 'plus', id: '111', days: 0 }).ok).toBe(false);
    expect(api.grant({ kind: 'plus', id: '111', days: 99999 }).ok).toBe(false);
    expect(api.grant({ kind: 'premium', id: '111', days: 30, seats: 0 }).ok).toBe(false);
    expect(api.grant({ kind: 'premium', id: '111', days: 30, seats: 999 }).ok).toBe(false);
  });

  it('revokes Plus and Premium', () => {
    const api = make(db);
    api.grant({ kind: 'plus', id: '111', days: 30 });
    api.grant({ kind: 'premium', id: '222', days: 30, seats: 2 });
    expect(api.revoke({ kind: 'plus', id: '111' }).ok).toBe(true);
    expect(isUserPremium(db, '111', NOW)).toBe(false);
    expect(api.revoke({ kind: 'premium', id: '222' }).ok).toBe(true);
    expect(api.listPasses().passes).toEqual([]);
  });

  it('listPasses returns active plus, passes and unclaimed pending', () => {
    const api = make(db);
    api.grant({ kind: 'plus', id: '111', days: 30 });
    const view = api.listPasses();
    expect(view.plus.some((x) => x.userId === '111')).toBe(true);
    expect(Array.isArray(view.pending)).toBe(true);
  });
});

describe('adminApi — listGuilds (servers tab)', () => {
  let db: Database.Database;
  beforeEach(() => (db = initDb(':memory:')));
  afterEach(() => db.close());

  it('is empty without a resolveGuilds source', () => {
    expect(make(db).listGuilds()).toEqual([]);
  });

  it('returns each guild with its stored usage, busiest first, and top speakers', () => {
    const now = new Date(NOW);
    // Guild A: 3 messages read (u1 twice, u2 once). Guild B: 1 message (u3).
    bumpTalk(db, 'A', 'u1', now);
    bumpTalk(db, 'A', 'u1', now);
    bumpTalk(db, 'A', 'u2', now);
    bumpTalk(db, 'B', 'u3', now);

    const api = make(db, {
      resolveGuilds: () => [
        { id: 'B', name: 'Beta', icon: null, memberCount: 5, joinedTimestamp: 1600000000000 },
        {
          id: 'A',
          name: 'Alpha',
          icon: 'https://cdn.discordapp.com/icons/A/x.png',
          memberCount: 10,
          joinedTimestamp: 1700000000000,
        },
      ],
    });
    const rows = api.listGuilds();

    // Busiest first: A (3 messages) before B (1) — regardless of resolveGuilds order.
    expect(rows.map((r) => r.id)).toEqual(['A', 'B']);
    expect(rows[0]).toMatchObject({
      id: 'A',
      name: 'Alpha',
      icon: 'https://cdn.discordapp.com/icons/A/x.png',
      memberCount: 10,
      messages: 3,
      speakers: 2,
      joinedTimestamp: 1700000000000,
    });
    // Stats come from talk_stats: u1 (2) is the top speaker of A.
    expect(rows[0].topSpeakers[0]).toEqual({ userId: 'u1', count: 2 });
    expect(rows[1]).toMatchObject({ id: 'B', messages: 1, speakers: 1 });
  });

  it('shows a guild the bot is in even with zero messages read yet', () => {
    const api = make(db, {
      resolveGuilds: () => [
        { id: 'C', name: 'Gamma', icon: null, memberCount: 3, joinedTimestamp: 1650000000000 },
      ],
    });
    const rows = api.listGuilds();
    expect(rows).toEqual([
      {
        id: 'C',
        name: 'Gamma',
        icon: null,
        memberCount: 3,
        messages: 0,
        speakers: 0,
        topSpeakers: [],
        joinedTimestamp: 1650000000000,
      },
    ]);
  });
});
