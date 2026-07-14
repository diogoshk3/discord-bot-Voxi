// src/premium/kofiWebhook.ts
//
// Servidor HTTP FINO do webhook do Ko-fi. Recebe o POST, verifica o token, e aplica o
// grant (via a lógica pura em ./kofi). INERTE sem KOFI_WEBHOOK_TOKEN. Responde sempre
// depressa (o Ko-fi re-tenta em não-2xx). O host aponta o domínio para esta porta.

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
  hashKofiEmail,
  type KofiEvent,
  type KofiGrant,
} from './kofi';
import type { StatusApi } from './statusApi';
import type { DashboardApi } from './dashboardApi';

export interface KofiWebhookDeps {
  db: Database.Database;
  token: string | undefined;
  port: number;
  now: () => number;
  logInfo: (m: string) => void;
  logError: (m: string, err: unknown) => void;
  // Painel Premium: API de leitura opcional montada no MESMO servidor (GET /api/me/premium).
  // Ausente => só o webhook. Presente => também responde à API com CORS restrito a `apiOrigin`.
  statusApi?: StatusApi;
  apiOrigin?: string;
  // Dashboard web de config (opcional): rotas /api/dashboard/* no MESMO servidor, mesmo CORS.
  // Ausente => sem dashboard. Requer também `apiOrigin`.
  dashboardApi?: DashboardApi;
  /** Limite defensivo do mapa de rate-limit da API. Default 2048. */
  apiRateMaxEntries?: number;
}

// Rate-limit simples por IP para a API do painel (janela deslizante). Sem dependências:
// um Map em memória chega — reinicia com o processo, é best-effort anti-abuso.
const API_RATE_MAX = 30; // pedidos
const API_RATE_WINDOW_MS = 10_000; // por 10s
const API_RATE_MAX_ENTRIES = 2048;

// Claim (POST /api/link): limite MUITO mais apertado — é anti-brute-force do código da
// transação. 5 tentativas / 10 min / IP: chega de sobra para um comprador legítimo e torna
// impraticável adivinhar um tx id (UUID) por força bruta.
const CLAIM_RATE_MAX = 5;
const CLAIM_RATE_WINDOW_MS = 10 * 60 * 1000;

interface RateState {
  count: number;
  reset: number;
}

/**
 * Aplica um grant do Ko-fi no store (estende/acumula, nunca reduz). Sem Discord ID
 * associado devolve null (o chamador loga para grant manual com /vozengrant).
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
 * Resolve o Discord ID de um evento: da MENSAGEM (1.ª compra) — e memoriza-o por email —
 * ou, se a mensagem não o trouxer (RENOVAÇÕES não reenviam a nota), pelo EMAIL guardado.
 */
export function resolveKofiDiscordId(
  db: Database.Database,
  event: KofiEvent,
  grant: KofiGrant,
  now: number,
  webhookToken: string | undefined,
): string | null {
  // Indexamos pelo HASH do email (nunca o email em claro) — ver hashKofiEmail. O token do
  // webhook é a chave do HMAC; ele autentica o pedido (verifyKofiToken), logo está sempre
  // presente quando chegamos aqui. Sem token não hashamos (degrada em segurança, nunca vaza).
  const emailHash = event.email && webhookToken ? hashKofiEmail(webhookToken, event.email) : null;
  if (grant.discordId) {
    if (emailHash) rememberKofiSupporter(db, emailHash, grant.discordId, now);
    return grant.discordId;
  }
  return emailHash ? lookupKofiSupporter(db, emailHash) : null;
}

/** IP do pedido (respeita o X-Forwarded-For do reverse proxy; senão o socket). */
function clientIp(req: import('node:http').IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    // O ÚLTIMO elemento do X-Forwarded-For é o acrescentado pelo proxy confiável
    // (Caddy no mesmo host, que faz append do peer real); os anteriores vêm do
    // cliente e são forjáveis — usar o leftmost deixava rodar buckets do rate-limit
    // à vontade (1 header novo = 1 janela nova). Pressuposto documentado: exatamente
    // UM proxy confiável à frente (ver docs/DEPLOY-VPS.md, Caddy -> localhost:3001).
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
 * true se o IP passou do limite `max` na janela `windowMs` (e regista o pedido). Parametrizável
 * para servir tanto a leitura do painel (30/10s) como o claim (5/10min).
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

/** Trata GET/OPTIONS /api/me/premium: CORS restrito, rate-limit, e delega ao statusApi. */
function handleApiRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  ctx: ApiCtx,
): void {
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': ctx.apiOrigin,
    Vary: 'Origin',
  };
  // Preflight do browser.
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
      ctx.logError('[premium-api] erro a servir /api/me/premium', err);
      try {
        res
          .writeHead(500, { ...cors, 'Content-Type': 'application/json' })
          .end('{"error":"internal"}');
      } catch {
        /* resposta já enviada */
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
  /** Token do webhook Ko-fi = chave do HMAC do email (para casar o claim por email). */
  token: string | undefined;
}

/**
 * Trata POST /api/link: o comprador (logado com Discord) cola o código do recibo e reclama a
 * compra pendente. CORS restrito, rate-limit apertado (anti-brute-force do código), valida a
 * identidade na Discord (statusApi.resolveIdentity) e delega em claimPendingGrant. 404 genérico
 * para não dar um oráculo de códigos válidos.
 */
function handleClaimRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  ctx: ClaimCtx,
): void {
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': ctx.apiOrigin,
    Vary: 'Origin',
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
        const outcome = claimPendingGrant(ctx.db, identity.id, code!, ctx.token, ctx.now());
        if (!outcome.ok) {
          // use_receipt_code (plano 021): o input parecia um email — pede o código do recibo
          // em vez de um 404 genérico, para o site conseguir mostrar uma mensagem útil.
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
        ctx.logError('[claim] erro a processar o claim', err);
        try {
          respond(500, { error: 'internal' });
        } catch {
          /* resposta já enviada */
        }
      });
  });
  req.on('error', (err) => ctx.logError('[claim] erro no request do claim', err));
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
const MAX_DASHBOARD_BODY = 8_000; // um patch de config é minúsculo

/**
 * Rotas do dashboard web (config da guild). CORS restrito a `apiOrigin`, rate-limit e Bearer
 * obrigatório; a AUTORIZAÇÃO real (MANAGE_GUILD + bot presente) vive no dashboardApi. Rotas:
 *   GET  /api/dashboard/guilds       -> servidores geríveis (401 se token inválido)
 *   GET  /api/dashboard/guild/<id>   -> config (whitelist)  (403 se não autorizado)
 *   POST /api/dashboard/guild/<id>   -> aplica patch (whitelist) (403 se não autorizado)
 */
function handleDashboardRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  ctx: DashboardCtx,
): void {
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': ctx.apiOrigin,
    Vary: 'Origin',
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

  // GET /api/dashboard/guilds -> lista de servidores geríveis (ponto de entrada; 401 no token).
  if (req.method === 'GET' && path === '/api/dashboard/guilds') {
    ctx.dashboardApi
      .listGuilds(bearer)
      .then((guilds) =>
        guilds === null ? json(401, { error: 'invalid_token' }) : json(200, { guilds }),
      )
      .catch((err) => {
        ctx.logError('[dashboard] erro a listar guilds', err);
        try {
          json(500, { error: 'internal' });
        } catch {
          /* resposta já enviada */
        }
      });
    return;
  }

  // /api/dashboard/guild/<id> -> GET (ler) ou POST (guardar). 403 quando não autorizado.
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
          ctx.logError('[dashboard] erro a ler config', err);
          try {
            json(500, { error: 'internal' });
          } catch {
            /* resposta já enviada */
          }
        });
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      let aborted = false;
      req.on('data', (chunk) => {
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
            ctx.logError('[dashboard] erro a guardar config', err);
            try {
              json(500, { error: 'internal' });
            } catch {
              /* resposta já enviada */
            }
          });
      });
      req.on('error', (err) => ctx.logError('[dashboard] erro no request', err));
      return;
    }

    json(405, { error: 'method_not_allowed' });
    return;
  }

  json(404, { error: 'not_found' });
}

/**
 * Arranca o servidor HTTP do Premium. Roteia:
 *   - GET/OPTIONS /api/me/premium -> Painel Premium (se `statusApi` presente), com CORS
 *   - POST (qualquer outro caminho) -> webhook do Ko-fi (se `token` presente)
 * No-op (devolve null) se NÃO houver nem token do Ko-fi nem API do painel. Devolve o Server.
 */
export function startKofiWebhook(deps: KofiWebhookDeps): Server | null {
  const { db, token, port, now, logInfo, logError, statusApi, apiOrigin, dashboardApi } = deps;
  if (!token && !statusApi) {
    logInfo('[premium] servidor HTTP inativo (sem webhook Ko-fi nem API do painel).');
    return null;
  }
  const rate = new Map<string, RateState>();
  const claimRate = new Map<string, RateState>(); // bucket SEPARADO do claim (limite apertado)
  const rateMaxEntries = Math.max(1, Math.floor(deps.apiRateMaxEntries ?? API_RATE_MAX_ENTRIES));

  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];

    // ── Painel Premium: GET/OPTIONS /api/me/premium ────────────────────────────────
    if (statusApi && apiOrigin && path === '/api/me/premium') {
      handleApiRequest(req, res, { statusApi, apiOrigin, now, rate, rateMaxEntries, logError });
      return;
    }

    // ── Claim de compra pendente: POST/OPTIONS /api/link ───────────────────────────
    if (statusApi && apiOrigin && path === '/api/link') {
      handleClaimRequest(req, res, {
        statusApi,
        apiOrigin,
        db,
        now,
        rate: claimRate,
        rateMaxEntries,
        logError,
        token,
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

    // ── Webhook do Ko-fi: POST ─────────────────────────────────────────────────────
    if (req.method !== 'POST' || !token) {
      res.writeHead(404).end('not found');
      return;
    }
    let body = '';
    let aborted = false;
    req.on('data', (chunk) => {
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
        // Segurança: só aceitamos payloads com o NOSSO token de verificação do Ko-fi.
        if (!verifyKofiToken(event, token)) {
          logError('[kofi] token de verificação inválido — ignorado', event.transactionId);
          res.writeHead(401).end('bad token');
          return;
        }
        const grant = mapKofiToGrant(event, now());
        if (!grant) {
          logInfo(`[kofi] evento ignorado (produto não reconhecido, type=${event.type}).`);
          res.writeHead(200).end('ok');
          return;
        }
        // Discord ID: da mensagem (1.ª compra, memorizada por email) ou pelo email (renovação).
        const resolved: KofiGrant = {
          ...grant,
          discordId: resolveKofiDiscordId(db, event, grant, now(), token),
        };
        // HASH do email (nunca em claro) para indexar um eventual pendente — ver hashKofiEmail.
        const emailHash = event.email && token ? hashKofiEmail(token, event.email) : null;
        // IDEMPOTÊNCIA: o Ko-fi reentrega em timeout/não-2xx. Registo do tx + grant são
        // UMA transação: num duplicado confirmamos 200 sem re-aplicar (o grant acumula
        // expiry — ver kofi_transaction em db.ts); se o grant falhar, o registo reverte
        // e um retry legítimo volta a ser aceite. Sem tx id (payload atípico) aplica na
        // mesma — fica o log para auditoria manual.
        const applied = db.transaction(
          (): { dup: boolean; exp: number | null; pending: boolean } => {
            if (event.transactionId && !recordKofiTransaction(db, event.transactionId, now())) {
              return { dup: true, exp: null, pending: false };
            }
            const exp = applyKofiGrant(db, resolved, now());
            // Sem Discord ID associável (o checkout de subscrição do Ko-fi não tem caixa de
            // mensagem): em vez de perder a compra, guardamo-la como PENDENTE para o comprador a
            // RECLAMAR no site (login Discord + código do recibo). Precisa do tx id como chave
            // (o comprador tem-no no recibo); sem tx id (atípico) fica só o log/grant manual.
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
          // Comprou mas não pôs o Discord ID (o normal nas subscrições): fica PENDENTE, o
          // comprador reclama no site; em último caso resolve-se à mão com /vozengrant.
          // Minimização de PII: NÃO registamos o nome do comprador; o tx id chega para
          // reconciliar a compra no painel do Ko-fi (onde o nome/email vivem).
          logError(
            `[kofi] compra SEM Discord ID — ${applied.pending ? 'PENDENTE (reclamável no site)' : 'grant MANUAL'}: ` +
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
        // Distinguir "payload não-processável" de "falha ao PERSISTIR": os primeiros já
        // responderam acima (400/401/200) e nunca chegam aqui; um throw aqui é a transação
        // do grant a rebentar (SQLITE_BUSY, disco cheio, I/O). Responder 200 diria ao Ko-fi
        // "recebido" e ele NÃO re-tentava → compra paga perdida. Respondemos 5xx para o
        // Ko-fi reentregar; o ledger kofi_transaction torna o retry idempotente.
        logError('[kofi] falha a PERSISTIR o grant — 503 para o Ko-fi re-tentar', err);
        try {
          res.writeHead(503).end('retry');
        } catch {
          /* resposta já enviada */
        }
      }
    });
    req.on('error', (err) => logError('[kofi] erro no request do webhook', err));
  });
  server.on('error', (err) => logError('[kofi] erro no servidor de webhook', err));
  hardenServerTimeouts(server); // timeouts curtos (anti-slowloris)
  // Loopback-only: o mundo exterior chega via Caddy (reverse_proxy localhost:3001).
  // Assim a garantia não depende só da firewall (defesa em profundidade).
  server.listen(port, '127.0.0.1', () => logInfo(`[kofi] webhook à escuta em 127.0.0.1:${port}.`));
  return server;
}
