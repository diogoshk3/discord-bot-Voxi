// src/premium/kofiWebhook.ts
//
// Servidor HTTP FINO do webhook do Ko-fi. Recebe o POST, verifica o token, e aplica o
// grant (via a lógica pura em ./kofi). INERTE sem KOFI_WEBHOOK_TOKEN. Responde sempre
// depressa (o Ko-fi re-tenta em não-2xx). O host aponta o domínio para esta porta.

import { createServer, type Server } from 'node:http';
import type Database from 'better-sqlite3';
import { grantGuildPass, grantUserPremium } from '../store/premium';
import { parseKofiPayload, verifyKofiToken, mapKofiToGrant, type KofiGrant } from './kofi';

export interface KofiWebhookDeps {
  db: Database.Database;
  token: string | undefined;
  port: number;
  now: () => number;
  logInfo: (m: string) => void;
  logError: (m: string, err: unknown) => void;
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

/** Arranca o servidor de webhook (ou no-op se não houver token). Devolve o Server ou null. */
export function startKofiWebhook(deps: KofiWebhookDeps): Server | null {
  const { db, token, port, now, logInfo, logError } = deps;
  if (!token) {
    logInfo('[kofi] webhook inativo (sem KOFI_WEBHOOK_TOKEN) — vendas só por /vozengrant.');
    return null;
  }
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end('method not allowed');
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
        const exp = applyKofiGrant(db, grant, now());
        if (exp == null) {
          // Comprou mas não pôs (ou pôs mal) o Discord ID → resolve-se à mão com /vozengrant.
          logError(
            `[kofi] compra SEM Discord ID válido — grant MANUAL: ${grant.plan} ${grant.days}d, ` +
              `de "${event.fromName ?? '?'}" tx=${event.transactionId ?? '?'}`,
            null,
          );
        } else {
          logInfo(
            `[kofi] grant ${grant.plan} ${grant.days}d -> ${grant.discordId} (fim ${new Date(exp).toISOString()}).`,
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
