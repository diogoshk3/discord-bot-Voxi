import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { isUserPremium } from '../src/store/premium';
import { startKofiWebhook } from '../src/premium/kofiWebhook';
import { claimVoteReward } from '../src/store/voteReward';

// A recompensa por voto passa a viajar no MESMO servidor HTTP do Ko-fi/painel (o que já
// está público via Caddy em api.vozen.org), na rota POST /webhook/topgg — para não exigir
// uma porta dedicada + rota de Caddy nova. Estes testes exercitam essa rota fim-a-fim.
const SECRET = 'topgg-s3cr3t';
const UPVOTE = JSON.stringify({ bot: 'b1', user: 'u-9', type: 'upvote' });

function urlOf(s: Server, path: string): string {
  const addr = s.address();
  if (!addr || typeof addr === 'string') throw new Error('porta efémera indisponível');
  return `http://127.0.0.1:${addr.port}${path}`;
}

describe('webhook top.gg na API pública (rota POST /webhook/topgg)', () => {
  let db: Database.Database;
  let server: Server | null = null;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    db.close();
  });

  async function start(opts: {
    secret?: string;
    onUpvote?: (id: string) => void;
  }): Promise<Server> {
    server = startKofiWebhook({
      db,
      token: 'tok', // Ko-fi ligado em paralelo — a rota top.gg não pode ser engolida por ele
      port: 0,
      now: () => 1_000_000,
      logInfo: () => {},
      logError: () => {},
      topggWebhookSecret: opts.secret,
      onUpvote: opts.onUpvote,
    });
    if (!server) throw new Error('servidor não arrancou');
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    return server;
  }

  async function post(s: Server, body: string, auth?: string): Promise<number> {
    const res = await fetch(urlOf(s, '/webhook/topgg'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body,
    });
    return res.status;
  }

  it('upvote com secret certo -> 200 e chama onUpvote com o id do votante', async () => {
    const rewarded: string[] = [];
    const s = await start({ secret: SECRET, onUpvote: (id) => rewarded.push(id) });
    expect(await post(s, UPVOTE, SECRET)).toBe(200);
    expect(rewarded).toEqual(['u-9']);
  });

  it('secret errado -> 401 e NÃO chama onUpvote', async () => {
    const rewarded: string[] = [];
    const s = await start({ secret: SECRET, onUpvote: (id) => rewarded.push(id) });
    expect(await post(s, UPVOTE, 'errado')).toBe(401);
    expect(rewarded).toEqual([]);
  });

  it('wiring real: onUpvote=claimVoteReward concede 24h de Plus ao votante', async () => {
    const s = await start({
      secret: SECRET,
      onUpvote: (id) => {
        claimVoteReward(db, id, 1_000_000);
      },
    });
    expect(await post(s, UPVOTE, SECRET)).toBe(200);
    expect(isUserPremium(db, 'u-9', 1_000_000 + 1000)).toBe(true);
  });

  it('sem topggWebhookSecret configurado -> a rota NÃO é endpoint de voto (não recompensa)', async () => {
    const rewarded: string[] = [];
    const s = await start({ onUpvote: (id) => rewarded.push(id) }); // sem secret
    await post(s, UPVOTE, SECRET); // status é indiferente; o que importa é não recompensar
    expect(rewarded).toEqual([]);
  });
});
