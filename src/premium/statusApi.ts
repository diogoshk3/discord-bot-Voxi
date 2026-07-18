// src/premium/statusApi.ts
//
// READ API for premium status, used by the site's Premium Panel (login with Discord).
// The site is static (GitHub Pages) and uses OAuth2 implicit (scope `identify`): it gets a
// Discord access_token and calls GET /api/me/premium with `Authorization: Bearer <token>`.
// Here we do NOT trust any ID coming from the client — we ask Discord "whose token is
// this?" (/users/@me) and only then read that user's SQLite. This makes it impossible to see
// someone else's status. Short cache (token->identity) to avoid hitting Discord on every
// refresh. Logic isolated from the HTTP server (mounted in kofiWebhook.ts) to be testable.

import type Database from 'better-sqlite3';
import { buildPremiumStatus } from '../store/premium';

/** Minimal identity we pull from Discord's /users/@me. */
export interface DiscordIdentity {
  id: string;
  username: string;
  avatar: string | null;
}

/** Token audience from /oauth2/@me: WHICH user AND WHICH OAuth application minted the token.
 *  The admin console binds on BOTH, so an identify token for the owner minted by any other
 *  application is refused (access-token substitution defence). */
export interface DiscordAuthorization {
  userId: string;
  applicationId: string;
}

export interface StatusApiDeps {
  db: Database.Database;
  now: () => number;
  /** Injectable for tests; in production it is Node's global fetch. */
  fetchImpl: typeof fetch;
  /** Resolves a server's name by ID (bot's guild cache). Absent => ID only. */
  resolveGuildName?: (guildId: string) => string | null;
  /** TTL of the token->identity cache (ms). Default 60s. */
  identityTtlMs?: number;
  /** Defensive limit against slow spam of different tokens. Default 512. */
  identityCacheMaxEntries?: number;
  logError?: (m: string, err: unknown) => void;
}

export interface StatusResponse {
  code: number;
  body: unknown;
}

export interface StatusApi {
  getStatus(token: string | null): Promise<StatusResponse>;
  resolveIdentity(token: string): Promise<DiscordIdentity | null>;
  resolveAuthorization(token: string): Promise<DiscordAuthorization | null>;
}

const DISCORD_ME = 'https://discord.com/api/v10/users/@me';
// /oauth2/@me additionally reveals the token's `application.id` (the client that minted it) —
// what /users/@me cannot. The admin login uses it to bind the token's audience.
const DISCORD_OAUTH_ME = 'https://discord.com/api/v10/oauth2/@me';

// Ceiling on the Discord validation: without this a slow/hung discord.com would hold the
// panel's HTTP request open (and, under spam, pile up). On abort we fall into the catch => 401.
const DISCORD_FETCH_TIMEOUT_MS = 5_000;

/**
 * Creates the panel API. Keeps a token->identity cache (short TTL) — avoids hitting
 * Discord on every panel refresh and limits the damage of invalid-token spam (an invalid
 * token is also cached as `null` for the TTL).
 */
export function createStatusApi(deps: StatusApiDeps): StatusApi {
  const ttl = deps.identityTtlMs ?? 60_000;
  const maxCacheEntries = Math.max(1, Math.floor(deps.identityCacheMaxEntries ?? 512));
  const cache = new Map<string, { identity: DiscordIdentity | null; exp: number }>();

  function pruneCache(now: number): void {
    for (const [key, value] of cache) {
      if (value.exp <= now) cache.delete(key);
    }
    while (cache.size >= maxCacheEntries) {
      const oldest = cache.keys().next().value as string | undefined;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }

  async function resolveIdentity(token: string): Promise<DiscordIdentity | null> {
    const now = deps.now();
    const hit = cache.get(token);
    if (hit && hit.exp > now) return hit.identity;
    if (hit) cache.delete(token);
    pruneCache(now);

    let identity: DiscordIdentity | null = null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DISCORD_FETCH_TIMEOUT_MS);
    try {
      const res = await deps.fetchImpl(DISCORD_ME, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ac.signal,
      });
      if (res.ok) {
        const u = (await res.json()) as {
          id?: unknown;
          username?: unknown;
          global_name?: unknown;
          avatar?: unknown;
        };
        if (typeof u.id === 'string') {
          const name =
            (typeof u.global_name === 'string' && u.global_name) ||
            (typeof u.username === 'string' && u.username) ||
            u.id;
          identity = {
            id: u.id,
            username: name,
            avatar: typeof u.avatar === 'string' ? u.avatar : null,
          };
        }
      }
    } catch (err) {
      deps.logError?.('[premium-api] failed to validate the Discord token', err);
      identity = null;
    } finally {
      clearTimeout(timer);
    }
    // Cache even the `null` (invalid token) to avoid repeating the fetch under spam.
    pruneCache(now);
    cache.set(token, { identity, exp: now + ttl });
    return identity;
  }

  async function getStatus(token: string | null): Promise<StatusResponse> {
    if (!token) return { code: 401, body: { error: 'no_token' } };
    const identity = await resolveIdentity(token);
    if (!identity) return { code: 401, body: { error: 'invalid_token' } };

    const status = buildPremiumStatus(deps.db, identity.id, deps.now());
    const pass = status.pass
      ? {
          seats: status.pass.seats,
          used: status.pass.used,
          expiresAt: status.pass.expiresAt,
          active: status.pass.active,
          servers: status.pass.guilds.map((id) => ({
            id,
            name: deps.resolveGuildName?.(id) ?? null,
          })),
        }
      : null;

    return {
      code: 200,
      body: {
        user: { id: identity.id, username: identity.username, avatar: identity.avatar },
        plus: status.plus,
        pass,
      },
    };
  }

  /** Validates the token against /oauth2/@me and returns WHICH user + WHICH OAuth application it
   *  belongs to. Unlike /users/@me this exposes the token's `application.id`, letting the admin
   *  console refuse a token minted for the owner by any OTHER application. Not cached: admin
   *  logins are rare and a stale audience must never be reused. Fails closed (null) on any error. */
  async function resolveAuthorization(token: string): Promise<DiscordAuthorization | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DISCORD_FETCH_TIMEOUT_MS);
    try {
      const res = await deps.fetchImpl(DISCORD_OAUTH_ME, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ac.signal,
      });
      if (!res.ok) return null;
      const o = (await res.json()) as { application?: { id?: unknown }; user?: { id?: unknown } };
      const userId = o.user?.id;
      const applicationId = o.application?.id;
      if (typeof userId === 'string' && typeof applicationId === 'string') {
        return { userId, applicationId };
      }
      return null;
    } catch (err) {
      deps.logError?.('[premium-api] failed to validate the OAuth authorization', err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return { getStatus, resolveIdentity, resolveAuthorization };
}
