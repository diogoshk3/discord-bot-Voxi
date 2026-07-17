// src/premium/adminApi.ts
//
// Logic layer for the Vozen admin console (plan 037). Mirrors statusApi/dashboardApi: the HTTP
// wiring lives in kofiWebhook.ts and delegates every decision here, so the security-critical
// choices are unit-tested without a socket. This is the money surface AND, because the page and
// code are public, the whole security boundary — every method fails closed.
//
// Auth model (Discord-owner only):
//   login()     — a Discord OAuth token whose identity == ownerId. Only that one account may enter;
//                 anyone else (even with the link) is refused. Mints a signed session. Same model as
//                 the /account page and the Helper panel — the owner's Discord IS the gate.
//   authorize() — verifies the SIGNED SESSION only (never a raw Discord token) and re-checks
//                 == ownerId. Every mutating route goes through this.
//   grant()/revoke() reuse the tested grantUserPremium/grantGuildPass and the adminPasses revokes.

import type Database from 'better-sqlite3';
import { grantGuildPass, grantUserPremium } from '../store/premium';
import {
  listActivePremium,
  revokeGuildPass,
  revokeUserPremium,
  type AdminPassesView,
} from '../store/adminPasses';
import { listAllUnclaimedPending, type PendingGrant } from '../store/kofiPending';
import { buildServerStats } from '../store/serverStats';
import { signAdminSession, verifyAdminSession } from './adminAuth';
import type { DiscordIdentity } from './statusApi';

export interface AdminApiDeps {
  db: Database.Database;
  now: () => number;
  /** Reuse statusApi.resolveIdentity — validates a Discord token against /users/@me. */
  resolveIdentity: (token: string) => Promise<DiscordIdentity | null>;
  /** HMAC key for the signed session. Absent => inert. */
  adminSessionSecret?: string;
  /** Only this Discord identity may log in (reuses OWNER_ID). Absent => inert. */
  ownerId?: string;
  logInfo: (m: string) => void;
  /** Session lifetime; default 8h. */
  sessionTtlSec?: number;
  /** Live snapshot of the bot's guilds (from client.guilds.cache). Absent => the servers tab is
   *  empty. Only id/name/icon/memberCount leave — the stats come from data already in the db. */
  resolveGuilds?: () => AdminGuildBrief[];
}

/** What the bot's guild cache gives us for a server (no message content, just identity + size). */
export interface AdminGuildBrief {
  id: string;
  name: string;
  /** Full CDN URL of the server icon, or null. */
  icon: string | null;
  memberCount: number;
  /** When the bot joined this server (ms epoch), or null if the gateway didn't report it. */
  joinedTimestamp: number | null;
}

/** A server row for the admin console: identity + aggregate usage already stored (talk_stats). */
export interface AdminGuildRow extends AdminGuildBrief {
  /** Total messages Vozen has read in this server. */
  messages: number;
  /** People with at least one message read. */
  speakers: number;
  /** Top talkers (userId + count) — the same data as the public /topspeakers, per server. */
  topSpeakers: { userId: string; count: number }[];
}

export type AdminGrantInput =
  | { kind: 'plus'; id: string; days: number }
  | { kind: 'premium'; id: string; days: number; seats: number };

export type AdminRevokeInput = { kind: 'plus' | 'premium'; id: string };

export interface AdminLoginOk {
  ok: true;
  token: string;
  expiresAt: number;
}
export interface AdminFail {
  ok: false;
}
export interface AdminGrantOk {
  ok: true;
  expiresAt: number;
}
export interface AdminGrantErr {
  ok: false;
  error: string;
}

export interface AdminPassesResult extends AdminPassesView {
  pending: PendingGrant[];
}

export interface AdminApi {
  /** True iff the session secret and owner id are configured; when false, EVERY method fails closed. */
  enabled: boolean;
  /** Logs in with a Discord OAuth token whose identity must equal the owner id. */
  login(discordToken: string | null): Promise<AdminLoginOk | AdminFail>;
  /** Returns the owner id iff `sessionToken` is a valid session for the owner; else null. */
  authorize(sessionToken: string | null): string | null;
  listPasses(): AdminPassesResult;
  /** The bot's servers with their aggregate usage, busiest first. Empty without resolveGuilds. */
  listGuilds(): AdminGuildRow[];
  grant(input: AdminGrantInput): AdminGrantOk | AdminGrantErr;
  revoke(input: AdminRevokeInput): { ok: boolean };
}

const SNOWFLAKE = /^\d{1,20}$/;
/** ~10 years — a generous manual grant, still bounded so a typo can't set a century. */
const MAX_DAYS = 3650;
const MAX_SEATS = 100;
/** Top talkers shown per server in the console. */
const TOP_SPEAKERS = 5;

const validId = (id: unknown): id is string => typeof id === 'string' && SNOWFLAKE.test(id);
const validDays = (d: unknown): d is number =>
  typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= MAX_DAYS;
const validSeats = (s: unknown): s is number =>
  typeof s === 'number' && Number.isInteger(s) && s >= 1 && s <= MAX_SEATS;

export function createAdminApi(deps: AdminApiDeps): AdminApi {
  const enabled = Boolean(deps.adminSessionSecret && deps.ownerId);
  const ttl = deps.sessionTtlSec ?? 8 * 3600;

  async function login(discordToken: string | null): Promise<AdminLoginOk | AdminFail> {
    // Destructure + guard so TS narrows the optionals to strings without non-null assertions.
    const { adminSessionSecret, ownerId } = deps;
    if (!adminSessionSecret || !ownerId || !discordToken) return { ok: false };
    const identity = await deps.resolveIdentity(discordToken);
    if (!identity || identity.id !== ownerId) return { ok: false };
    const now = deps.now();
    const token = signAdminSession(ownerId, adminSessionSecret, now, ttl);
    return { ok: true, token, expiresAt: (Math.floor(now / 1000) + ttl) * 1000 };
  }

  function authorize(sessionToken: string | null): string | null {
    const { adminSessionSecret, ownerId } = deps;
    if (!enabled || !adminSessionSecret || !ownerId || !sessionToken) return null;
    const uid = verifyAdminSession(sessionToken, adminSessionSecret, deps.now());
    // Re-check == ownerId even though the session is only ever minted for the owner: defense in
    // depth against a future path that mints a session for anyone.
    if (!uid || uid !== ownerId) return null;
    return uid;
  }

  function listPasses(): AdminPassesResult {
    const now = deps.now();
    return { ...listActivePremium(deps.db, now), pending: listAllUnclaimedPending(deps.db) };
  }

  function listGuilds(): AdminGuildRow[] {
    if (!deps.resolveGuilds) return [];
    const now = new Date(deps.now());
    return deps
      .resolveGuilds()
      .map((g) => {
        // Stats come ONLY from talk_stats (already stored, already public via /topspeakers) — no
        // new collection. buildServerStats is pure over the db.
        const s = buildServerStats(deps.db, g.id, now, TOP_SPEAKERS);
        return {
          id: g.id,
          name: g.name,
          icon: g.icon,
          memberCount: g.memberCount,
          joinedTimestamp: g.joinedTimestamp,
          messages: s.totalMessages,
          speakers: s.activeSpeakers,
          topSpeakers: s.topSpeakers.map((t) => ({ userId: t.userId, count: t.count })),
        };
      })
      .sort((a, b) => b.messages - a.messages);
  }

  function grant(input: AdminGrantInput): AdminGrantOk | AdminGrantErr {
    if (!validId(input.id)) return { ok: false, error: 'bad_id' };
    if (!validDays(input.days)) return { ok: false, error: 'bad_days' };
    const now = deps.now();
    if (input.kind === 'plus') {
      const exp = grantUserPremium(deps.db, input.id, input.days, 'manual', now);
      deps.logInfo(`[admin] grant plus ${input.id} ${input.days}d`);
      return { ok: true, expiresAt: exp };
    }
    if (!validSeats(input.seats)) return { ok: false, error: 'bad_seats' };
    const exp = grantGuildPass(deps.db, input.id, input.seats, input.days, 'manual', now);
    deps.logInfo(`[admin] grant premium ${input.id} ${input.days}d seats=${input.seats}`);
    return { ok: true, expiresAt: exp };
  }

  function revoke(input: AdminRevokeInput): { ok: boolean } {
    const ok =
      input.kind === 'plus'
        ? revokeUserPremium(deps.db, input.id)
        : revokeGuildPass(deps.db, input.id);
    deps.logInfo(`[admin] revoke ${input.kind} ${input.id} -> ${ok}`);
    return { ok };
  }

  return { enabled, login, authorize, listPasses, listGuilds, grant, revoke };
}
