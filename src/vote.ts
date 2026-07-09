// src/vote.ts
//
// Webhook top.gg OPCIONAL para registar votos do bot (P11.5).
//
// Desenho (espelha src/health.ts):
//  - `handleVoteWebhook({ authHeader, body, secret })` e uma funcao PURA (sem
//    rede, sem abrir porta): valida o secret, faz parse do payload do top.gg e
//    devolve { status, body }. Incrementa a metrica `votes` num upvote valido,
//    a la AudioCache.get (que tambem toca no singleton de metricas dentro da
//    unidade). Testavel sem rede.
//  - `startVoteWebhookServer(config)` cria um http.Server que recolhe o corpo do
//    POST e chama o handler — mas SO se `config.topggWebhookPort` estiver
//    definido. Sem porta, devolve undefined e nao abre nada (default = sem
//    servidor), exatamente como o health endpoint.
//
// Seguranca:
//  - Se `secret` estiver definido, o header Authorization TEM de bater certo
//    (401 caso contrario). A comparacao e constant-time (crypto.timingSafeEqual
//    sobre SHA-256 de ambos os lados) para nao vazar o secret via timing — ver
//    authMatches(). top.gg permite webhooks sem auth, mas e inseguro — por isso
//    recomendamos sempre definir TOPGG_WEBHOOK_SECRET (ver .env.example e o
//    aviso de arranque em startVoteWebhookServer).
//  - Sem `secret` configurado, o webhook por defeito NAO arranca (SEC-01) — sem
//    auth, qualquer um que descubra a porta forja votos. Para arrancar mesmo assim
//    (sem auth), e preciso o opt-in explicito TOPGG_WEBHOOK_ALLOW_INSECURE=true.
//
// O payload do top.gg (POST JSON) tem, entre outros, estes campos:
//   { bot: "<id>", user: "<id de quem votou>", type: "upvote" | "test", ... }
// "test" e um ping do dashboard do top.gg (botao "Test webhook"): respondemos
// 200 para o teste passar, mas NAO contamos como voto (so type === "upvote").
//
// NOTA — "ao vivo pendente": a listagem do bot no top.gg e o TOPGG_WEBHOOK_SECRET
// pertencem ao dono do bot. Esta parte constroi o codigo + testes; ligar o
// webhook ao vivo (criar a listagem, colar o secret, expor a porta) fica para o
// deploy do utilizador.

import http from 'node:http';
import type { Server } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { log } from './logging/logger';
import { metrics } from './metrics';
import type { AppConfig } from './config/index';

export interface VoteWebhookInput {
  /** Valor do header Authorization do pedido (ou undefined se ausente). */
  authHeader: string | undefined;
  /** Corpo cru do pedido (string JSON do top.gg). */
  body: string;
  /** Secret esperado. Se undefined/vazio, a auth NAO e verificada. */
  secret: string | undefined;
}

export interface VoteData {
  /** Id de quem votou (campo `user` do top.gg). */
  user: string;
  /** Tipo de evento: "upvote" (voto real) ou "test" (ping do dashboard). */
  type: string;
  /** Id do bot votado (campo `bot` do top.gg), se presente. */
  bot?: string;
}

/**
 * Compara o header de auth com o secret em tempo constante.
 *
 * `authHeader !== secret` curto-circuita no primeiro byte diferente, logo o
 * tempo de resposta revela quantos bytes batem certo — um canal lateral de
 * timing num caminho de autenticacao. Usamos `crypto.timingSafeEqual`.
 *
 * `timingSafeEqual` LANCA se os buffers tiverem comprimentos diferentes; por
 * isso hashamos ambos os lados para um SHA-256 de 32 bytes (comprimento fixo)
 * antes de comparar. Bonus: o digest tambem nao vaza o comprimento do secret.
 */
function authMatches(authHeader: string | undefined, secret: string): boolean {
  const a = createHash('sha256')
    .update(authHeader ?? '')
    .digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

export interface VoteWebhookResult {
  status: number;
  /** Corpo JSON da resposta. */
  body: string;
  /** Dados do voto, presentes apenas num parse com sucesso (200). */
  vote?: VoteData;
}

/**
 * Handler PURO do webhook top.gg.
 *
 * Ordem (auth ANTES de qualquer parse, como num gateway):
 *  1. Se `secret` definido e o authHeader nao bater certo (comparacao
 *     constant-time) => 401 (NAO conta voto).
 *  2. Parse do body JSON. Body invalido/malformado => 400 (sem crash).
 *  3. Sucesso => 200 + dados do voto. Se type === "upvote", incrementa `votes`.
 *     type === "test" => 200 mas NAO conta (e um ping de teste do dashboard).
 */
export function handleVoteWebhook(input: VoteWebhookInput): VoteWebhookResult {
  const { authHeader, body, secret } = input;

  // 1. Auth — so quando ha secret configurado (leitura literal do contrato).
  //    Comparacao constant-time (timingSafeEqual) para nao vazar o secret via
  //    timing — ver authMatches().
  if (secret !== undefined && secret !== '' && !authMatches(authHeader, secret)) {
    return { status: 401, body: JSON.stringify({ status: 'unauthorized' }) };
  }

  // 2. Parse defensivo — input malformado NUNCA pode crashar.
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { status: 400, body: JSON.stringify({ status: 'invalid_json' }) };
  }
  // Exige um objeto JSON (nao null, nao array, nao primitivo). O payload do
  // top.gg e sempre um objeto { user, type, ... }; um array/numero/string nao e
  // acionavel => 400.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 400, body: JSON.stringify({ status: 'invalid_payload' }) };
  }

  const obj = parsed as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type : '';
  const user = typeof obj.user === 'string' ? obj.user : '';
  const bot = typeof obj.bot === 'string' ? obj.bot : undefined;

  // Um upvote valido precisa de um `user` (quem votou). Sem ele, o payload nao e
  // acionavel: aceitamos (200) mas nao contamos — evita inflar a metrica com
  // pings vazios. type "test" tambem cai aqui (nao conta), e isso e o desejado.
  const vote: VoteData = { user, type, ...(bot !== undefined ? { bot } : {}) };

  if (type === 'upvote' && user !== '') {
    metrics.inc('votes');
  }

  return { status: 200, body: JSON.stringify({ status: 'ok' }), vote };
}

/**
 * Arranque OPCIONAL do servidor de webhook top.gg (espelha startHealthServer).
 *  - Se `config.topggWebhookPort` for undefined (default), NAO arranca nada e
 *    devolve undefined.
 *  - Caso contrario, cria um http.Server que aceita POST /webhook/topgg,
 *    recolhe o corpo, chama `handleVoteWebhook` (com o secret da config) e
 *    responde. Qualquer outra rota/metodo => 404. Devolve o handle do Server.
 *
 * Porta DEDICADA (TOPGG_WEBHOOK_PORT), separada do HEALTH_PORT de proposito —
 * para nao misturar um endpoint de uptime publico com um endpoint de webhook
 * autenticado.
 */
export function startVoteWebhookServer(
  config: Pick<AppConfig, 'topggWebhookPort' | 'topggWebhookSecret' | 'topggWebhookAllowInsecure'>,
): Server | undefined {
  const port = config.topggWebhookPort;
  if (port === undefined) return undefined;

  const secret = config.topggWebhookSecret;
  if (secret === undefined || secret === '') {
    if (!config.topggWebhookAllowInsecure) {
      // SEC-01: sem secret, qualquer um que descubra a porta forja votos. Recusar
      // arrancar é o default seguro; o opt-in explícito fica para quem sabe o risco.
      log.error(
        `[vote] TOPGG_WEBHOOK_PORT definido (${port}) mas TOPGG_WEBHOOK_SECRET vazio — ` +
          'o webhook NÃO vai arrancar. Define TOPGG_WEBHOOK_SECRET, ou (por tua conta e ' +
          'risco) TOPGG_WEBHOOK_ALLOW_INSECURE=true para arrancar sem autenticação.',
      );
      return undefined;
    }
    log.warn(
      `[vote] TOPGG_WEBHOOK_PORT definido (${port}) sem TOPGG_WEBHOOK_SECRET e com ` +
        'TOPGG_WEBHOOK_ALLOW_INSECURE=true — webhook SEM autenticação (inseguro).',
    );
  }

  const server = http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'POST' || path !== '/webhook/topgg') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not_found' }));
      return;
    }

    // Recolhe o corpo do POST com um cap defensivo: um corpo gigante nao deve
    // esgotar memoria. O payload do top.gg e pequeno; 64KB e folgado.
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX = 64 * 1024;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const body = Buffer.concat(chunks).toString('utf8');
      const authHeader = req.headers['authorization'];
      const result = handleVoteWebhook({
        authHeader: typeof authHeader === 'string' ? authHeader : undefined,
        body,
        secret,
      });
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    });
    req.on('error', (err) => {
      log.error('[vote] erro ao ler o corpo do webhook', err);
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'bad_request' }));
      }
    });
  });

  server.on('error', (err) => {
    log.error(`[vote] erro no servidor de webhook top.gg (porta ${port})`, err);
  });

  // Loopback-only (defesa em profundidade): a exposição pública faz-se via reverse
  // proxy no mesmo host (Caddy), nunca com a porta crua na internet.
  server.listen(port, '127.0.0.1', () => {
    log.info(
      `[vote] servidor de webhook top.gg a ouvir em 127.0.0.1:${port} (POST /webhook/topgg).`,
    );
  });

  return server;
}
