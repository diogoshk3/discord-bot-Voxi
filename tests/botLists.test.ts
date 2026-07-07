import { describe, it, expect, vi } from 'vitest';
import { postTopggStats, startBotListUpdater } from '../src/botLists';

// Params tipados (url, opts) p/ o typecheck: sem eles .mock.calls fica tuplo vazio.
// O mock é passado com cast `as unknown as typeof fetch`, por isso o opts pode ter a
// forma que o teste lê (method+headers+body).
function okFetch() {
  return vi.fn(
    async (_url: string, _opts: { method: string; headers: { Authorization: string }; body: string }) =>
      ({ ok: true, status: 200 }) as Response,
  );
}

describe('postTopggStats', () => {
  it('POST para o endpoint certo com Authorization e server_count', async () => {
    const fetchImpl = okFetch();
    const ok = await postTopggStats('bot-123', 'tok-abc', 42, fetchImpl as unknown as typeof fetch);
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://top.gg/api/bots/bot-123/stats');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('tok-abc');
    expect(JSON.parse(opts.body)).toEqual({ server_count: 42 });
  });

  it('HTTP não-2xx -> false (não lança)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }) as Response);
    const ok = await postTopggStats('b', 't', 1, fetchImpl as unknown as typeof fetch);
    expect(ok).toBe(false);
  });

  it('erro de rede -> false (nunca lança)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const ok = await postTopggStats('b', 't', 1, fetchImpl as unknown as typeof fetch);
    expect(ok).toBe(false);
  });
});

describe('startBotListUpdater', () => {
  it('sem token -> no-op (não publica, stop() seguro)', () => {
    const fetchImpl = okFetch();
    const stop = startBotListUpdater({
      botId: 'b',
      token: undefined,
      serverCount: () => 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      setIntervalImpl: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: () => {},
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('com token -> publica JÁ e regista o intervalo; stop() cancela-o', () => {
    const fetchImpl = okFetch();
    let intervalFn: (() => void) | null = null;
    const cleared: number[] = [];
    const stop = startBotListUpdater({
      botId: 'b',
      token: 'tok',
      serverCount: () => 7,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      setIntervalImpl: (fn) => {
        intervalFn = fn;
        return 99 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalImpl: (h) => cleared.push(h as unknown as number),
    });
    // Publicação imediata.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // O tick do intervalo publica de novo com a contagem ATUAL.
    intervalFn!();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stop();
    expect(cleared).toEqual([99]);
  });
});
