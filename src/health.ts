// src/health.ts
//
// Health endpoint HTTP OPCIONAL para uptime monitors (ex.: UptimeRobot).
//
// Desenho:
//  - `healthResponse(path)` e uma funcao PURA (sem efeitos, sem abrir porta):
//    devolve { status, body } para um dado caminho de pedido. Testavel sem rede.
//  - `startHealthServer(config)` cria um http.Server que usa o handler e faz
//    listen(port) — mas SO se `config.healthPort` estiver definido. Sem porta,
//    devolve undefined e nao abre nada (default = sem servidor).
//
// O corpo e MINIMO de proposito: apenas {"status":"ok"}. Nao expomos tokens,
// IDs, contagem de guilds nem qualquer dado sensivel num endpoint sem auth.

import http from 'node:http';
import type { Server } from 'node:http';
import { log } from './logging/logger';
import type { AppConfig } from './config/index';

export interface HealthResult {
  status: number;
  body: string;
}

/**
 * Handler puro. GET a /health => 200 {"status":"ok"}; qualquer outro path => 404.
 *
 * Aceita o caminho cru do pedido (req.url). Faz match so pelo path, ignorando a
 * query string (ex.: alguns monitores acrescentam `?probe=...`), comparando
 * apenas a parte antes do primeiro '?'.
 */
export function healthResponse(reqPath: string | undefined): HealthResult {
  const path = (reqPath ?? '').split('?')[0];
  if (path === '/health') {
    return { status: 200, body: JSON.stringify({ status: 'ok' }) };
  }
  return { status: 404, body: JSON.stringify({ status: 'not_found' }) };
}

/**
 * Arranque OPCIONAL do servidor de health.
 *  - Se `config.healthPort` for undefined (default), NAO arranca nada e devolve
 *    undefined.
 *  - Caso contrario, cria um http.Server que responde via `healthResponse` e faz
 *    listen na porta. Devolve o handle do Server (para o chamador/tests poderem
 *    fechar ou ler o endereco efemero quando listen(0)).
 */
export function startHealthServer(config: Pick<AppConfig, 'healthPort'>): Server | undefined {
  const port = config.healthPort;
  if (port === undefined) return undefined;

  const server = http.createServer((req, res) => {
    // Um cliente que corte a ligação a meio do pedido emite 'error' no stream do
    // req; sem listener, o Node relança-o como exceção não-apanhada. Espelha o
    // servidor de webhook (vote.ts) que já tem este guard.
    req.on('error', (err) => {
      log.warn('[health] erro no stream do pedido (ignorado)', err);
    });
    const { status, body } = healthResponse(req.url);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  });

  server.on('error', (err) => {
    log.error(`[health] erro no servidor de health (porta ${port})`, err);
  });

  // Loopback-only (defesa em profundidade): o health é para monitorização local/proxy.
  server.listen(port, '127.0.0.1', () => {
    log.info(`[health] servidor de health a ouvir em 127.0.0.1:${port} (GET /health).`);
  });

  return server;
}
