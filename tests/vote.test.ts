import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { handleVoteWebhook, startVoteWebhookServer } from '../src/vote';
import { metrics } from '../src/metrics';
import type { AppConfig } from '../src/config/index';

// Helper: AppConfig minima — so as 2 vars de webhook interessam ao server.
function cfg(topggWebhookPort?: number, topggWebhookSecret?: string): AppConfig {
  return { topggWebhookPort, topggWebhookSecret } as unknown as AppConfig;
}

const SECRET = 's3cr3t';
const UPVOTE = JSON.stringify({ bot: 'bot-1', user: 'u-123', type: 'upvote' });

describe('handleVoteWebhook — handler puro (sem rede)', () => {
  beforeEach(() => metrics.reset());

  it('(a) secret correto + upvote => 200 e incrementa votes', () => {
    const res = handleVoteWebhook({ authHeader: SECRET, body: UPVOTE, secret: SECRET });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ok');
    expect(res.vote).toMatchObject({ user: 'u-123', type: 'upvote', bot: 'bot-1' });
    expect(metrics.snapshot().votes).toBe(1);
  });

  it('(b) secret errado => 401 e NAO incrementa votes', () => {
    const res = handleVoteWebhook({ authHeader: 'errado', body: UPVOTE, secret: SECRET });
    expect(res.status).toBe(401);
    expect(metrics.snapshot().votes).toBe(0);
    // nao devolve dados de voto numa rejeicao
    expect(res.vote).toBeUndefined();
  });

  it('(b2) header de auth ausente com secret definido => 401', () => {
    const res = handleVoteWebhook({ authHeader: undefined, body: UPVOTE, secret: SECRET });
    expect(res.status).toBe(401);
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('(b3) secret errado de comprimento diferente => 401 sem crash (timingSafeEqual)', () => {
    // A comparacao constant-time (crypto.timingSafeEqual) lanca se os buffers
    // tiverem comprimentos diferentes — por isso hashamos ambos os lados para 32
    // bytes antes de comparar. Este teste exercita o caminho de comprimentos
    // distintos (curto e longo) que os outros testes de auth nao cobrem.
    for (const authHeader of ['x', 's3cr3t-com-muito-mais-bytes-que-o-secret-real']) {
      metrics.reset();
      const res = handleVoteWebhook({ authHeader, body: UPVOTE, secret: SECRET });
      expect(res.status, `authHeader=${authHeader}`).toBe(401);
      expect(metrics.snapshot().votes).toBe(0);
      expect(res.vote).toBeUndefined();
    }
  });

  it('(c) sem secret configurado => aceita o upvote (200) e conta', () => {
    // Decisao documentada (leitura literal do contrato B1): sem secret a auth NAO
    // e verificada. top.gg permite webhooks sem auth, mas e inseguro — por isso o
    // arranque do servidor avisa (ver teste do server). authHeader e ignorado.
    const res = handleVoteWebhook({ authHeader: undefined, body: UPVOTE, secret: undefined });
    expect(res.status).toBe(200);
    expect(metrics.snapshot().votes).toBe(1);
  });

  it('(c2) secret vazio ("") trata-se como sem secret => aceita', () => {
    const res = handleVoteWebhook({ authHeader: undefined, body: UPVOTE, secret: '' });
    expect(res.status).toBe(200);
    expect(metrics.snapshot().votes).toBe(1);
  });

  it('(d) body JSON malformado => 400 sem crash e sem contar', () => {
    const res = handleVoteWebhook({ authHeader: SECRET, body: '{nao e json', secret: SECRET });
    expect(res.status).toBe(400);
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('(d2) body vazio => 400 sem crash', () => {
    const res = handleVoteWebhook({ authHeader: SECRET, body: '', secret: SECRET });
    expect(res.status).toBe(400);
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('(d3) body JSON nao-objeto (array/numero/null) => 400', () => {
    for (const body of ['[]', '42', 'null', '"texto"']) {
      metrics.reset();
      const res = handleVoteWebhook({ authHeader: SECRET, body, secret: SECRET });
      expect(res.status, `body=${body}`).toBe(400);
      expect(metrics.snapshot().votes).toBe(0);
    }
  });

  it('(e) type "test" => 200 (o teste do dashboard passa) mas NAO conta', () => {
    const body = JSON.stringify({ bot: 'bot-1', user: 'u-123', type: 'test' });
    const res = handleVoteWebhook({ authHeader: SECRET, body, secret: SECRET });
    expect(res.status).toBe(200);
    expect(res.vote?.type).toBe('test');
    // ping de teste do top.gg nao e um voto real
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('upvote valido mas sem campo `user` => 200 mas nao conta (payload nao acionavel)', () => {
    const body = JSON.stringify({ bot: 'bot-1', type: 'upvote' });
    const res = handleVoteWebhook({ authHeader: SECRET, body, secret: SECRET });
    expect(res.status).toBe(200);
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('campos de tipo errado (user numerico) nao crasham; nao conta', () => {
    const body = JSON.stringify({ bot: 'bot-1', user: 123, type: 'upvote' });
    const res = handleVoteWebhook({ authHeader: SECRET, body, secret: SECRET });
    expect(res.status).toBe(200);
    // user nao e string => tratado como ausente => nao conta
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('dois upvotes validos acumulam (votes=2)', () => {
    handleVoteWebhook({ authHeader: SECRET, body: UPVOTE, secret: SECRET });
    handleVoteWebhook({ authHeader: SECRET, body: UPVOTE, secret: SECRET });
    expect(metrics.snapshot().votes).toBe(2);
  });
});

describe('startVoteWebhookServer — arranque opcional', () => {
  let server: Server | undefined;

  beforeEach(() => metrics.reset());

  afterEach(() => {
    if (server) {
      server.close();
      server = undefined;
    }
  });

  it('NAO arranca servidor quando topggWebhookPort e undefined', () => {
    server = startVoteWebhookServer(cfg(undefined, SECRET));
    expect(server).toBeUndefined();
  });

  it('arranca e aceita um POST real com secret correto (porta efemera) e conta o voto', async () => {
    server = startVoteWebhookServer(cfg(0, SECRET)); // porta 0 = efemera
    expect(server).toBeDefined();

    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const addr = server!.address();
    if (addr === null || typeof addr === 'string') {
      throw new Error('endereco inesperado do servidor de webhook');
    }

    const res = await fetch(`http://127.0.0.1:${addr.port}/webhook/topgg`, {
      method: 'POST',
      headers: { Authorization: SECRET, 'Content-Type': 'application/json' },
      body: UPVOTE,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('ok');
    expect(metrics.snapshot().votes).toBe(1);
  });

  it('POST com secret errado => 401 e nao conta', async () => {
    server = startVoteWebhookServer(cfg(0, SECRET));
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const addr = server!.address();
    if (addr === null || typeof addr === 'string') throw new Error('endereco inesperado');

    const res = await fetch(`http://127.0.0.1:${addr.port}/webhook/topgg`, {
      method: 'POST',
      headers: { Authorization: 'errado', 'Content-Type': 'application/json' },
      body: UPVOTE,
    });
    expect(res.status).toBe(401);
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('GET ou rota errada => 404 (so aceita POST /webhook/topgg)', async () => {
    server = startVoteWebhookServer(cfg(0, SECRET));
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const addr = server!.address();
    if (addr === null || typeof addr === 'string') throw new Error('endereco inesperado');

    const resGet = await fetch(`http://127.0.0.1:${addr.port}/webhook/topgg`);
    expect(resGet.status).toBe(404);
    const resWrong = await fetch(`http://127.0.0.1:${addr.port}/nope`, { method: 'POST' });
    expect(resWrong.status).toBe(404);
  });
});
