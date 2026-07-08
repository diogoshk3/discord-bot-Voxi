// src/premium/statusApi.ts
//
// API de LEITURA do estado premium para o Painel Premium do site (login com Discord).
// O site é estático (GitHub Pages) e usa OAuth2 implicit (scope `identify`): recebe um
// access_token do Discord e chama GET /api/me/premium com `Authorization: Bearer <token>`.
// Aqui NÃO confiamos em nenhum ID vindo do cliente — perguntamos à Discord "de quem é este
// token?" (/users/@me) e só então lemos o SQLite desse utilizador. Assim é impossível ver
// o estado de outra pessoa. Cache curto (token->identidade) para não bater na Discord a
// cada refresh. Lógica isolada do servidor HTTP (montado em kofiWebhook.ts) para ser testável.

import type Database from 'better-sqlite3';
import { buildPremiumStatus } from '../store/premium';

/** Identidade mínima que tiramos do /users/@me da Discord. */
export interface DiscordIdentity {
  id: string;
  username: string;
  avatar: string | null;
}

export interface StatusApiDeps {
  db: Database.Database;
  now: () => number;
  /** Injetável para testes; em produção é o fetch global do Node. */
  fetchImpl: typeof fetch;
  /** Resolve o nome de um servidor pelo ID (cache de guilds do bot). Ausente => só ID. */
  resolveGuildName?: (guildId: string) => string | null;
  /** TTL da cache token->identidade (ms). Default 60s. */
  identityTtlMs?: number;
  logError?: (m: string, err: unknown) => void;
}

export interface StatusResponse {
  code: number;
  body: unknown;
}

export interface StatusApi {
  getStatus(token: string | null): Promise<StatusResponse>;
  resolveIdentity(token: string): Promise<DiscordIdentity | null>;
}

const DISCORD_ME = 'https://discord.com/api/v10/users/@me';

/**
 * Cria a API do painel. Mantém uma cache token->identidade (TTL curto) — evita bater na
 * Discord a cada refresh do painel e limita o dano de spam de tokens inválidos (um token
 * inválido também fica em cache como `null` durante o TTL).
 */
export function createStatusApi(deps: StatusApiDeps): StatusApi {
  const ttl = deps.identityTtlMs ?? 60_000;
  const cache = new Map<string, { identity: DiscordIdentity | null; exp: number }>();

  async function resolveIdentity(token: string): Promise<DiscordIdentity | null> {
    const now = deps.now();
    const hit = cache.get(token);
    if (hit && hit.exp > now) return hit.identity;

    let identity: DiscordIdentity | null = null;
    try {
      const res = await deps.fetchImpl(DISCORD_ME, {
        headers: { Authorization: `Bearer ${token}` },
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
      deps.logError?.('[premium-api] falha a validar token na Discord', err);
      identity = null;
    }
    // Cacheia mesmo o `null` (token inválido) para não repetir o fetch em spam.
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

  return { getStatus, resolveIdentity };
}
