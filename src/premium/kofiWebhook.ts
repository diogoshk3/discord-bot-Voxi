// src/premium/kofiWebhook.ts
//
// Servidor HTTP FINO do webhook do Ko-fi. Recebe o POST, verifica o token, e aplica o
// grant (via a lógica pura em ./kofi). INERTE sem KOFI_WEBHOOK_TOKEN. Responde sempre
// depressa (o Ko-fi re-tenta em não-2xx). O host aponta o domínio para esta porta.

import { createServer, type Server } from 'node:http';
import type Database from 'better-sqlite3';
import {
  grantGuildPass,
  grantUserPremium,
  rememberKofiSupporter,
  lookupKofiSupporter,
} from '../store/premium';
import {
  parseKofiPayload,
  verifyKofiToken,
  mapKofiToGrant,
  type KofiEvent,
  type KofiGrant,
} from './kofi';
import type { StatusApi } from './statusApi';

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
  /** Limite defensivo do mapa de rate-limit da API. Default 2048. */
  apiRateMaxEntries?: number;
}

// Rate-limit simples por IP para a API do painel (janela deslizante). Sem dependências:
// um Map em memória chega — reinicia com o processo, é best-effort anti-abuso.
const API_RATE_MAX = 30; // pedidos
const API_RATE_WINDOW_MS = 10_000; // por 10s
const API_RATE_MAX_ENTRIES = 2048;

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
): string | null {
  if (grant.discordId) {
    if (event.email) rememberKofiSupporter(db, event.email, grant.discordId, now);
    return grant.discordId;
  }
  return event.email ? lookupKofiSupporter(db, event.email) : null;
}

/** IP do pedido (respeita o X-Forwarded-For do reverse proxy; senão o socket). */
function clientIp(req: import('node:http').IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
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

/** true se o IP passou do limite na janela atual (e regista o pedido). */
function isRateLimited(
  rate: Map<string, RateState>,
  ip: string,
  now: number,
  maxEntries: number,
): boolean {
  const cur = rate.get(ip);
  if (!cur || cur.reset <= now) {
    if (cur) rate.delete(ip);
    pruneRateMap(rate, now, maxEntries);
    rate.set(ip, { count: 1, reset: now + API_RATE_WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > API_RATE_MAX;
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
  if (isRateLimited(ctx.rate, clientIp(req), ctx.now(), ctx.rateMaxEntries)) {
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

/**
 * Arranca o servidor HTTP do Premium. Roteia:
 *   - GET/OPTIONS /api/me/premium -> Painel Premium (se `statusApi` presente), com CORS
 *   - POST (qualquer outro caminho) -> webhook do Ko-fi (se `token` presente)
 * No-op (devolve null) se NÃO houver nem token do Ko-fi nem API do painel. Devolve o Server.
 */
export function startKofiWebhook(deps: KofiWebhookDeps): Server | null {
  const { db, token, port, now, logInfo, logError, statusApi, apiOrigin } = deps;
  if (!token && !statusApi) {
    logInfo('[premium] servidor HTTP inativo (sem webhook Ko-fi nem API do painel).');
    return null;
  }
  const rate = new Map<string, RateState>();
  const rateMaxEntries = Math.max(1, Math.floor(deps.apiRateMaxEntries ?? API_RATE_MAX_ENTRIES));

  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];

    // ── Painel Premium: GET/OPTIONS /api/me/premium ────────────────────────────────
    if (statusApi && apiOrigin && path === '/api/me/premium') {
      handleApiRequest(req, res, { statusApi, apiOrigin, now, rate, rateMaxEntries, logError });
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
          discordId: resolveKofiDiscordId(db, event, grant, now()),
        };
        const exp = applyKofiGrant(db, resolved, now());
        if (exp == null) {
          // Comprou mas não pôs (ou pôs mal) o Discord ID → resolve-se à mão com /vozengrant.
          logError(
            `[kofi] compra SEM Discord ID válido — grant MANUAL: ${grant.plan} ${grant.days}d, ` +
              `de "${event.fromName ?? '?'}" tx=${event.transactionId ?? '?'}`,
            null,
          );
        } else {
          logInfo(
            `[kofi] grant ${resolved.plan} ${resolved.days}d -> ${resolved.discordId} (fim ${new Date(exp).toISOString()}).`,
          );
        }
        res.writeHead(200).end('ok');
      } catch (err) {
        logError('[kofi] erro a processar webhook (ignorado)', err);
        try {
          res.writeHead(200).end('ok');
        } catch {
          /* resposta já enviada */
        }
      }
    });
    req.on('error', (err) => logError('[kofi] erro no request do webhook', err));
  });
  server.on('error', (err) => logError('[kofi] erro no servidor de webhook', err));
  server.listen(port, () => logInfo(`[kofi] webhook à escuta na porta ${port}.`));
  return server;
}
