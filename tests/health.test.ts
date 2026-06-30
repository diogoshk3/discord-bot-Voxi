import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { healthResponse, startHealthServer } from '../src/health';
import type { AppConfig } from '../src/config/index';

// Helper: AppConfig minima — so `healthPort` interessa ao startHealthServer.
function cfg(healthPort?: number): AppConfig {
  return { healthPort } as unknown as AppConfig;
}

describe('healthResponse — handler puro (sem abrir porta)', () => {
  it('(a) GET /health devolve 200 + corpo simples {status:"ok"}', () => {
    const res = healthResponse('/health');
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe('ok');
  });

  it('(a2) ignora query string em /health (path-only match)', () => {
    expect(healthResponse('/health?probe=1').status).toBe(200);
  });

  it('(b) qualquer outro path devolve 404', () => {
    expect(healthResponse('/').status).toBe(404);
    expect(healthResponse('/metrics').status).toBe(404);
    expect(healthResponse('/healthz').status).toBe(404);
  });

  it('(c) o corpo nao expoe dados sensiveis (so um estado simples)', () => {
    const res = healthResponse('/health');
    // Nada de tokens, ids, paths de ficheiros, etc. — so {status:"ok"}.
    expect(res.body).not.toMatch(/token|client|secret|guild|user|sk-/i);
    expect(Object.keys(JSON.parse(res.body))).toEqual(['status']);
  });
});

describe('startHealthServer — arranque opcional', () => {
  let server: Server | undefined;

  afterEach(() => {
    // Guarda o teardown — um servidor a ouvir pendura o vitest.
    if (server) {
      server.close();
      server = undefined;
    }
  });

  it('NAO arranca servidor quando healthPort e undefined', () => {
    server = startHealthServer(cfg(undefined));
    expect(server).toBeUndefined();
  });

  it('arranca e responde 200 a um GET real a /health (porta efemera)', async () => {
    server = startHealthServer(cfg(0)); // porta 0 = efemera, deterministico
    expect(server).toBeDefined();

    // Espera o evento listening para ter um endereco com porta atribuida.
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const addr = server!.address();
    if (addr === null || typeof addr === 'string') {
      throw new Error('endereco inesperado do servidor de health');
    }

    const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('ok');

    const res404 = await fetch(`http://127.0.0.1:${addr.port}/nope`);
    expect(res404.status).toBe(404);
  });
});
