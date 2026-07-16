// src/premium/kofiWebhook.ts
//
// THIN HTTP server for the Ko-fi webhook. Receives the POST, verifies the token, and applies the
// grant (via the pure logic in ./kofi). INERT without KOFI_WEBHOOK_TOKEN. Always responds
// quickly (Ko-fi retries on non-2xx). The host points the domain at this port.

import { createServer, type Server } from 'node:http';
import type Database from 'better-sqlite3';
import { hardenServerTimeouts } from '../http/serverHardening';
import {
  grantGuildPass,
  grantUserPremium,
  rememberKofiSupporter,
  lookupKofiSupporter,
  recordKofiTransaction,
} from '../store/premium';
import { recordPendingGrant } from '../store/kofiPending';
import { claimPendingGrant } from './claim';
import {
  parseKofiPayload,
  verifyKofiToken,
  mapKofiToGrant,
  type ShopProduct,
  hashKofiEmail,
  type KofiEvent,
  type KofiGrant,
} from './kofi';
import type { StatusApi } from './statusApi';
import type { DashboardApi } from './dashboardApi';
import { handleVoteWebhook } from '../vote';

export interface KofiWebhookDeps {
  db: Database.Database;
  token: string | undefined;
  port: number;
  now: () => number;
  logInfo: (m: string) => void;
  logError: (m: string, err: unknown) => void;
  // Premium panel: optional read API mounted on the SAME server (GET /api/me/premium).
  // Absent => only the webhook. Present => also serves the API with CORS restricted to `apiOrigin`.
  statusApi?: StatusApi;
  apiOrigin?: string;
  // Web config dashboard (optional): /api/dashboard/* routes on the SAME server, same CORS.
  // Absent => no dashboard. Also requires `apiOrigin`.
  dashboardApi?: DashboardApi;
  /** Defensive limit of the API rate-limit map. Default 2048. */
  apiRateMaxEntries?: number;
  /**
   * Ko-fi Shop item `direct_link_code` -> product (built by parseShopMap from KOFI_SHOP_MAP).
   * REQUIRED to recognize Shop purchases (e.g. the annual passes): a Shop Order does not carry
   * the product name. Absent/empty => shop orders fall back to keyword matching, which for a
   * digital item means they are ignored.
   */
  shopMap?: Map<string, ShopProduct>;
  // top.gg webhook (vote reward) mounted on the SAME public server (POST /webhook/topgg)
  // — avoids a dedicated port + new Caddy route. Absent/empty => the route is NOT served
  // (without a secret anyone would forge votes). See ./vote (handleVoteWebhook, constant-time auth).
  topggWebhookSecret?: string;
  /** Called with the id of whoever voted on each valid upvote (wires the reward grant). */
  onUpvote?: (userId: string) => void;
}

// Simple per-IP rate limit for the panel API (sliding window). No dependencies:
// an in-memory Map is enough — resets with the process, it's best-effort anti-abuse.
const API_RATE_MAX = 30; // requests
const API_RATE_WINDOW_MS = 10_000; // per 10s
const API_RATE_MAX_ENTRIES = 2048;

// Claim (POST /api/link): MUCH tighter limit — it's anti-brute-force for the transaction
// code. 5 attempts / 10 min / IP: more than enough for a legitimate buyer and makes it
// impractical to brute-force a tx id (UUID).
const CLAIM_RATE_MAX = 5;
const CLAIM_RATE_WINDOW_MS = 10 * 60 * 1000;

interface RateState {
  count: number;
  reset: number;
}

const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

/**
 * Applies a Ko-fi grant to the store (extends/accumulates, never reduces). Without an associated
 * Discord ID it returns null (the caller logs it for a manual grant with /vozengrant).
 */
export function applyKofiGrant(
  db: Database.Database,
  grant: KofiGrant,
  now: number,
): number | null {
  if (!grant.discordId) return null;
  return grant.plan === 'plus'
    ? grantUserPremium(db, grant.discordId, grant.days, 'kofi', now)
    : grantGuildPass(db, grant.discordId, grant.seats, grant.days, 'kofi', now);
}

/**
 * Resolves the Discord ID of an event: from the MESSAGE (1st purchase) — and memorizes it by email —
 * or, if the message doesn't carry it (RENEWALS don't resend the note), by the stored EMAIL.
 */
export function resolveKofiDiscordId(
  db: Database.Database,
  event: KofiEvent,
  grant: KofiGrant,
  now: number,
  webhookToken: string | undefined,
): string | null {
  // We index by the email HASH (never the plaintext email) — see hashKofiEmail. The webhook
  // token is the HMAC key; it authenticates the request (verifyKofiToken), so it is always
  // present when we get here. Without a token we don't hash (degrades safely, never leaks).
  const emailHash = event.email && webhookToken ? hashKofiEmail(webhookToken, event.email) : null;
  if (grant.discordId) {
    if (emailHash) rememberKofiSupporter(db, emailHash, grant.discordId, now);
    return grant.discordId;
  }
  return emailHash ? lookupKofiSupporter(db, emailHash) : null;
}

/** Request IP (respects the reverse proxy's X-Forwarded-For; otherwise the socket). */
function clientIp(req: import('node:http').IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    // The LAST element of X-Forwarded-For is the one appended by the trusted proxy
    // (Caddy on the same host, which appends the real peer); the earlier ones come from
    // the client and are forgeable — using the leftmost would let rate-limit buckets be
    // rotated at will (1 new header = 1 new window). Documented assumption: exactly
    // ONE trusted proxy in front (see docs/DEPLOY-VPS.md, Caddy -> localhost:3001).
    const parts = xff.split(',');
    const last = parts[parts.length - 1].trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function pruneRateMap(rate: Map<string, RateState>, now: number, maxEntries: number): void {
  for (const [ip, state] of rate) {
    if (state.reset <= now) rate.delete(ip);
  }
  while (rate.size >= maxEntries) {
    const oldest = rate.keys().next().value as string | undefined;
    if (!oldest) break;
    rate.delete(oldest);
  }
}

/**
 * true if the IP exceeded the `max` limit in the `windowMs` window (and records the request). Parameterizable
 * to serve both the panel read (30/10s) and the claim (5/10min).
 */
function isRateLimited(
  rate: Map<string, RateState>,
  ip: string,
  now: number,
  maxEntries: number,
  max: number,
  windowMs: number,
): boolean {
  const cur = rate.get(ip);
  if (!cur || cur.reset <= now) {
    if (cur) rate.delete(ip);
    pruneRateMap(rate, now, maxEntries);
    rate.set(ip, { count: 1, reset: now + windowMs });
    return false;
  }
  cur.count += 1;
  return cur.count > max;
}

interface ApiCtx {
  statusApi: StatusApi;
  apiOrigin: string;
  now: () => number;
  rate: Map<string, RateState>;
  rateMaxEntries: number;
  logError: (m: string, err: unknown) => void;
}

/** Handles GET/OPTIONS /api/me/premium: restricted CORS, rate-limit, and delegates to statusApi. */
function handleApiRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  ctx: ApiCtx,
): void {
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': ctx.apiOrigin,
    Vary: 'Origin',
    ...API_SECURITY_HEADERS,
  };
  // Browser preflight.
  if (req.method === 'OPTIONS') {
    res
      .writeHead(204, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Max-Age': '600',
      })
      .end();
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405, cors).end('method not allowed');
    return;
  }
  if (
    isRateLimited(
      ctx.rate,
      clientIp(req),
      ctx.now(),
      ctx.rateMaxEntries,
      API_RATE_MAX,
      API_RATE_WINDOW_MS,
    )
  ) {
    res.writeHead(429, cors).end('{"error":"rate_limited"}');
    return;
  }
  const auth = req.headers['authorization'];
  const bearer =
    typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  ctx.statusApi
    .getStatus(bearer || null)
    .then(({ code, body }) => {
      res
        .writeHead(code, { ...cors, 'Content-Type': 'application/json' })
        .end(JSON.stringify(body));
    })
    .catch((err) => {
      ctx.logError('[premium-api] failed to serve /api/me/premium', err);
      try {
        res
          .writeHead(500, { ...cors, 'Content-Type': 'application/json' })
          .end('{"error":"internal"}');
      } catch {
        /* response already sent */
      }
    });
}

interface ClaimCtx {
  statusApi: StatusApi;
  apiOrigin: string;
  db: Database.Database;
  now: () => number;
  rate: Map<string, RateState>;
  rateMaxEntries: number;
  logError: (m: string, err: unknown) => void;
}

/**
 * Handles POST /api/link: the buyer (logged in with Discord) pastes the receipt code and claims the
 * pending purchase. Restricted CORS, tight rate-limit (anti-brute-force for the code), validates the
 * identity on Discord (statusApi.resolveIdentity) and delegates to claimPendingGrant. Generic 404
 * so as not to give an oracle of valid codes.
 */
function handleClaimRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  ctx: ClaimCtx,
): void {
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': ctx.apiOrigin,
    Vary: 'Origin',
    ...API_SECURITY_HEADERS,
  };
  if (req.method === 'OPTIONS') {
    res
      .writeHead(204, {
        ...cors,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      })
      .end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, cors).end('method not allowed');
    return;
  }
  if (
    isRateLimited(
      ctx.rate,
      clientIp(req),
      ctx.now(),
      ctx.rateMaxEntries,
      CLAIM_RATE_MAX,
      CLAIM_RATE_WINDOW_MS,
    )
  ) {
    res
      .writeHead(429, { ...cors, 'Content-Type': 'application/json' })
      .end('{"error":"rate_limited"}');
    return;
  }
  const auth = req.headers['authorization'];
  const bearer =
    typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;

  let body = '';
  let aborted = false;
  req.on('data', (chunk) => {
    // HTTP-01: defensive guard — if the request was already aborted (413), ignore additional
    // chunks (the same pattern as vote.ts). Harmless today (req.destroy() already stopped the
    // 'data' events), but protects against a future refactor that does `await` before the
    // destroy().
    if (aborted) return;
    body += chunk;
    if (body.length > 4_000) {
      aborted = true;
      res.writeHead(413, cors).end('too large');
      req.destroy();
    }
  });
  req.on('end', () => {
    if (aborted) return;
    const respond = (code: number, payload: unknown): void => {
      res
        .writeHead(code, { ...cors, 'Content-Type': 'application/json' })
        .end(JSON.stringify(payload));
    };
    let code: string | null = null;
    try {
      const parsed = JSON.parse(body || '{}') as { code?: unknown };
      if (typeof parsed.code === 'string') code = parsed.code;
    } catch {
      respond(400, { error: 'bad_request' });
      return;
    }
    if (!bearer) {
      respond(401, { error: 'no_token' });
      return;
    }
    if (!code) {
      respond(400, { error: 'bad_request' });
      return;
    }
    ctx.statusApi
      .resolveIdentity(bearer)
      .then((identity) => {
        if (!identity) {
          respond(401, { error: 'invalid_token' });
          return;
        }
        const outcome = claimPendingGrant(ctx.db, identity.id, code!, ctx.now());
        if (!outcome.ok) {
          // use_receipt_code (plan 021): the input looked like an email — ask for the receipt code
          // instead of a generic 404, so the site can show a useful message.
          if (outcome.reason === 'use_receipt_code') {
            respond(400, { error: 'use_receipt_code' });
            return;
          }
          respond(404, { error: 'not_found' });
          return;
        }
        respond(200, { ok: true, items: outcome.items });
      })
      .catch((err) => {
        ctx.logError('[claim] failed to process claim', err);
        try {
          respond(500, { error: 'internal' });
        } catch {
          /* response already sent */
        }
      });
  });
  req.on('error', (err) => ctx.logError('[claim] request error', err));
}

interface DashboardCtx {
  dashboardApi: DashboardApi;
  apiOrigin: string;
  now: () => number;
  rate: Map<string, RateState>;
  rateMaxEntries: number;
  logError: (m: string, err: unknown) => void;
}

const DASHBOARD_GUILD_PREFIX = '/api/dashboard/guild/';
const MAX_DASHBOARD_BODY = 8_000; // a config patch is tiny

/**
 * Web dashboard routes (guild config). CORS restricted to `apiOrigin`, rate-limit and Bearer
 * required; the real AUTHORIZATION (MANAGE_GUILD + bot present) lives in dashboardApi. Routes:
 *   GET  /api/dashboard/guilds       -> manageable servers (401 if token invalid)
 *   GET  /api/dashboard/guild/<id>   -> config (whitelist)  (403 if not authorized)
 *   POST /api/dashboard/guild/<id>   -> applies patch (whitelist) (403 if not authorized)
 */
function handleDashboardRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  ctx: DashboardCtx,
): void {
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': ctx.apiOrigin,
    Vary: 'Origin',
    ...API_SECURITY_HEADERS,
  };
  const path = (req.url ?? '').split('?')[0];
  const json = (code: number, body: unknown): void => {
    res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  };

  if (req.method === 'OPTIONS') {
    res
      .writeHead(204, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      })
      .end();
    return;
  }
  if (
    isRateLimited(
      ctx.rate,
      clientIp(req),
      ctx.now(),
      ctx.rateMaxEntries,
      API_RATE_MAX,
      API_RATE_WINDOW_MS,
    )
  ) {
    json(429, { error: 'rate_limited' });
    return;
  }
  const auth = req.headers['authorization'];
  const bearer =
    typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!bearer) {
    json(401, { error: 'no_token' });
    return;
  }

  // GET /api/dashboard/guilds -> list of manageable servers (entry point; 401 on token).
  if (req.method === 'GET' && path === '/api/dashboard/guilds') {
    ctx.dashboardApi
      .listGuilds(bearer)
      .then((guilds) =>
        guilds === null ? json(401, { error: 'invalid_token' }) : json(200, { guilds }),
      )
      .catch((err) => {
        ctx.logError('[dashboard] failed to list guilds', err);
        try {
          json(500, { error: 'internal' });
        } catch {
          /* response already sent */
        }
      });
    return;
  }

  // /api/dashboard/guild/<id> -> GET (read) or POST (save). 403 when not authorized.
  if (path.startsWith(DASHBOARD_GUILD_PREFIX)) {
    const guildId = path.slice(DASHBOARD_GUILD_PREFIX.length);
    if (!/^\d{1,20}$/.test(guildId)) {
      json(400, { error: 'bad_guild' });
      return;
    }

    if (req.method === 'GET') {
      ctx.dashboardApi
        .getConfig(bearer, guildId)
        .then((cfg) =>
          cfg === null ? json(403, { error: 'forbidden' }) : json(200, { config: cfg }),
        )
        .catch((err) => {
          ctx.logError('[dashboard] failed to read configuration', err);
          try {
            json(500, { error: 'internal' });
          } catch {
            /* response already sent */
          }
        });
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      let aborted = false;
      req.on('data', (chunk) => {
        // HTTP-01: defensive guard (see claim above) — ignore post-abort chunks.
        if (aborted) return;
        body += chunk;
        if (body.length > MAX_DASHBOARD_BODY) {
          aborted = true;
          json(413, { error: 'too_large' });
          req.destroy();
        }
      });
      req.on('end', () => {
        if (aborted) return;
        let patch: unknown;
        try {
          patch = JSON.parse(body || '{}');
        } catch {
          json(400, { error: 'bad_json' });
          return;
        }
        ctx.dashboardApi
          .saveConfig(bearer, guildId, patch)
          .then((cfg) =>
            cfg === null ? json(403, { error: 'forbidden' }) : json(200, { config: cfg }),
          )
          .catch((err) => {
            ctx.logError('[dashboard] failed to save configuration', err);
            try {
              json(500, { error: 'internal' });
            } catch {
              /* response already sent */
            }
          });
      });
      req.on('error', (err) => ctx.logError('[dashboard] request error', err));
      return;
    }

    json(405, { error: 'method_not_allowed' });
    return;
  }

  json(404, { error: 'not_found' });
}

interface TopggCtx {
  secret: string;
  onUpvote?: (userId: string) => void;
  logError: (m: string, err: unknown) => void;
}

/**
 * Handles POST /webhook/topgg (vote reward): collects the body and delegates to the PURE handler
 * handleVoteWebhook (same logic/security as the dedicated server — constant-time auth, defensive
 * parse). Only mounted when there is a `topggWebhookSecret`; without a secret votes are NOT accepted
 * (anyone would forge the reward). 64KB anti-DoS cap, like the Ko-fi webhook.
 */
function handleTopggRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  ctx: TopggCtx,
): void {
  if (req.method !== 'POST') {
    res.writeHead(405).end('method not allowed');
    return;
  }
  let body = '';
  let aborted = false;
  req.on('data', (chunk) => {
    // HTTP-01: defensive guard (see claim above) — ignore post-abort chunks.
    if (aborted) return;
    body += chunk;
    if (body.length > 64_000) {
      aborted = true;
      res.writeHead(413).end('too large');
      req.destroy();
    }
  });
  req.on('end', () => {
    if (aborted) return;
    const authHeader = req.headers['authorization'];
    const result = handleVoteWebhook({
      authHeader: typeof authHeader === 'string' ? authHeader : undefined,
      body,
      secret: ctx.secret,
      onUpvote: ctx.onUpvote,
    });
    res.writeHead(result.status, { 'Content-Type': 'application/json' }).end(result.body);
  });
  req.on('error', (err) => ctx.logError('[vote] top.gg webhook request error', err));
}

/**
 * Starts the Premium HTTP server. Routes:
 *   - GET/OPTIONS /api/me/premium -> Premium panel (if `statusApi` present), with CORS
 *   - POST /webhook/topgg -> vote reward (if `topggWebhookSecret` present)
 *   - POST (any other path) -> Ko-fi webhook (if `token` present)
 * No-op (returns null) if there is no Ko-fi webhook, panel API, or top.gg webhook.
 */
export function startKofiWebhook(deps: KofiWebhookDeps): Server | null {
  const { db, token, port, now, logInfo, logError, statusApi, apiOrigin, dashboardApi } = deps;
  const { topggWebhookSecret, onUpvote } = deps;
  if (!token && !statusApi && !topggWebhookSecret) {
    logInfo(
      '[premium] HTTP server disabled (no Ko-fi webhook, dashboard API, or top.gg endpoint).',
    );
    return null;
  }
  const rate = new Map<string, RateState>();
  const claimRate = new Map<string, RateState>(); // SEPARATE bucket for the claim (tight limit)
  const rateMaxEntries = Math.max(1, Math.floor(deps.apiRateMaxEntries ?? API_RATE_MAX_ENTRIES));

  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];

    // ── Premium panel: GET/OPTIONS /api/me/premium ─────────────────────────────────
    if (statusApi && apiOrigin && path === '/api/me/premium') {
      handleApiRequest(req, res, { statusApi, apiOrigin, now, rate, rateMaxEntries, logError });
      return;
    }

    // ── Pending purchase claim: POST/OPTIONS /api/link ─────────────────────────────
    if (statusApi && apiOrigin && path === '/api/link') {
      handleClaimRequest(req, res, {
        statusApi,
        apiOrigin,
        db,
        now,
        rate: claimRate,
        rateMaxEntries,
        logError,
      });
      return;
    }

    // ── Dashboard web: /api/dashboard/* ────────────────────────────────────────────
    if (
      dashboardApi &&
      apiOrigin &&
      (path === '/api/dashboard/guilds' || path.startsWith(DASHBOARD_GUILD_PREFIX))
    ) {
      handleDashboardRequest(req, res, {
        dashboardApi,
        apiOrigin,
        now,
        rate,
        rateMaxEntries,
        logError,
      });
      return;
    }

    // ── top.gg webhook (vote reward): POST /webhook/topgg ───────────────────────────
    // Rides on the SAME public server (api.vozen.org) so as not to require a dedicated port+Caddy.
    // BEFORE the Ko-fi catch-all (which catches ANY POST) — otherwise a POST /webhook/topgg
    // would be treated as a Ko-fi payload. Only active with a secret (otherwise anyone forges votes).
    if (topggWebhookSecret && path === '/webhook/topgg') {
      handleTopggRequest(req, res, { secret: topggWebhookSecret, onUpvote, logError });
      return;
    }

    // ── Ko-fi webhook: POST ────────────────────────────────────────────────────────
    if (req.method !== 'POST' || !token) {
      res.writeHead(404).end('not found');
      return;
    }
    let body = '';
    let aborted = false;
    req.on('data', (chunk) => {
      // HTTP-01: defensive guard (see claim above) — ignore post-abort chunks.
      if (aborted) return;
      body += chunk;
      if (body.length > 64_000) {
        aborted = true;
        res.writeHead(413).end('too large');
        req.destroy();
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const event = parseKofiPayload(body);
        if (!event) {
          res.writeHead(400).end('bad payload');
          return;
        }
        // Security: we only accept payloads with OUR Ko-fi verification token.
        if (!verifyKofiToken(event, token)) {
          logError('[kofi] invalid verification token; request ignored', event.transactionId);
          res.writeHead(401).end('bad token');
          return;
        }
        const grant = mapKofiToGrant(event, now(), deps.shopMap);
        if (!grant) {
          logInfo(`[kofi] evento ignorado (produto não reconhecido, type=${event.type}).`);
          res.writeHead(200).end('ok');
          return;
        }
        // Discord ID: from the message (1st purchase, memorized by email) or by email (renewal).
        const resolved: KofiGrant = {
          ...grant,
          discordId: resolveKofiDiscordId(db, event, grant, now(), token),
        };
        // HASH the email (never in plaintext) to index a possible pending grant — see hashKofiEmail.
        const emailHash = event.email && token ? hashKofiEmail(token, event.email) : null;
        // IDEMPOTENCY: Ko-fi redelivers on timeout/non-2xx. Recording the tx + the grant are
        // ONE transaction: on a duplicate we confirm 200 without re-applying (the grant accumulates
        // expiry — see kofi_transaction in db.ts); if the grant fails, the record reverts
        // and a legitimate retry is accepted again. Without a tx id (atypical payload) it applies
        // anyway — the log remains for manual auditing.
        const applied = db.transaction(
          (): { dup: boolean; exp: number | null; pending: boolean } => {
            if (event.transactionId && !recordKofiTransaction(db, event.transactionId, now())) {
              return { dup: true, exp: null, pending: false };
            }
            const exp = applyKofiGrant(db, resolved, now());
            // Without an associable Discord ID (the Ko-fi subscription checkout has no message
            // box): instead of losing the purchase, we store it as PENDING for the buyer to
            // CLAIM on the site (Discord login + receipt code). It needs the tx id as the key
            // (the buyer has it on the receipt); without a tx id (atypical) only the log/manual grant remains.
            let pending = false;
            if (exp == null && event.transactionId) {
              pending = recordPendingGrant(
                db,
                {
                  transactionId: event.transactionId,
                  emailHash,
                  plan: grant.plan,
                  days: grant.days,
                  seats: grant.seats,
                },
                now(),
              );
            }
            return { dup: false, exp, pending };
          },
        )();
        if (applied.dup) {
          logInfo(`[kofi] entrega DUPLICADA ignorada (tx=${event.transactionId}).`);
          res.writeHead(200).end('ok');
          return;
        }
        const exp = applied.exp;
        if (exp == null) {
          // Bought but didn't put the Discord ID (the norm on subscriptions): stays PENDING, the
          // buyer claims it on the site; as a last resort it is resolved by hand with /vozengrant.
          // PII minimization: we do NOT record the buyer's name; the tx id is enough to
          // reconcile the purchase in the Ko-fi panel (where the name/email live).
          logError(
            `[kofi] purchase without a Discord ID; ${applied.pending ? 'PENDING (claimable on the site)' : 'MANUAL grant'}: ` +
              `${grant.plan} ${grant.days}d, tx=${event.transactionId ?? '?'}`,
            null,
          );
        } else {
          logInfo(
            `[kofi] grant ${resolved.plan} ${resolved.days}d -> ${resolved.discordId} (fim ${new Date(exp).toISOString()}).`,
          );
        }
        res.writeHead(200).end('ok');
      } catch (err) {
        // Distinguish "unprocessable payload" from "failure to PERSIST": the former already
        // responded above (400/401/200) and never reach here; a throw here is the grant
        // transaction blowing up (SQLITE_BUSY, disk full, I/O). Responding 200 would tell Ko-fi
        // "received" and it would NOT retry → paid purchase lost. We respond 5xx for
        // Ko-fi to redeliver; the kofi_transaction ledger makes the retry idempotent.
        logError('[kofi] failed to persist grant; returning 503 for Ko-fi to retry', err);
        try {
          res.writeHead(503).end('retry');
        } catch {
          /* response already sent */
        }
      }
    });
    req.on('error', (err) => logError('[kofi] webhook request error', err));
  });
  server.on('error', (err) => logError('[kofi] webhook server error', err));
  hardenServerTimeouts(server); // short timeouts (anti-slowloris)
  // Loopback-only: the outside world arrives via Caddy (reverse_proxy localhost:3001).
  // This way the guarantee doesn't depend only on the firewall (defense in depth).
  server.listen(port, '127.0.0.1', () => logInfo(`[kofi] webhook à escuta em 127.0.0.1:${port}.`));
  return server;
}
