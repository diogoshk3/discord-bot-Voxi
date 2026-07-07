import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameManager } from '../src/games/manager';
import type { Clock, Game, GameContext, GameEnv, TimerHandle } from '../src/games/types';

/** Deixa correr as microtasks (o manager chama game.start/onMessage via Promise). */
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Relogio falso: avanca o tempo a mao e dispara os timers vencidos por ordem. */
class FakeClock implements Clock {
  time = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private seq = 1;
  now(): number {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.seq++;
    this.timers.push({ id, at: this.time + ms, fn });
    return id;
  }
  clearTimeout(handle: TimerHandle): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.time = due.at;
      due.fn();
    }
    this.time = target;
  }
  pending(): number {
    return this.timers.length;
  }
}

function makeEnv(overrides: Partial<GameEnv> = {}): GameEnv {
  const clock = new FakeClock();
  return {
    clock,
    availableModels: ['en_US-amy-medium', 'de_DE-thorsten-medium'],
    defaultSpeed: 1,
    defaultVoiceOf: () => 'en_US-amy-medium',
    getPlayer: () => ({ say: vi.fn(async () => true) }),
    sendToChannel: vi.fn(async () => {}),
    localeOf: () => 'en',
    translate: (key) => key,
    persistScores: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

/** Jogo-espia minimo: guarda o ctx e conta chamadas, sem logica propria. */
class SpyGame implements Game {
  readonly id = 'spy';
  ctx: GameContext | null = null;
  starts = 0;
  messages: string[] = [];
  start(ctx: GameContext): void {
    this.ctx = ctx;
    this.starts++;
  }
  onMessage(ctx: GameContext, msg: { content: string }): void {
    this.ctx = ctx;
    this.messages.push(msg.content);
  }
}

const GUILD = 'g1';
const CHAN = 'c1';

describe('GameManager', () => {
  let env: GameEnv;
  let clock: FakeClock;
  let mgr: GameManager;
  beforeEach(() => {
    env = makeEnv();
    clock = env.clock as FakeClock;
    mgr = new GameManager(env);
  });

  it('lock por-guild: 2o start na mesma guild -> already-active', () => {
    expect(mgr.start(GUILD, CHAN, new SpyGame())).toBe('started');
    expect(mgr.active(GUILD)).toBe(true);
    expect(mgr.channelOf(GUILD)).toBe(CHAN);
    expect(mgr.start(GUILD, 'outro-canal', new SpyGame())).toBe('already-active');
  });

  it('chama game.start ao iniciar', async () => {
    const g = new SpyGame();
    mgr.start(GUILD, CHAN, g);
    await flush();
    expect(g.starts).toBe(1);
  });

  it('handleMessage: consome (true) e encaminha SO no canal do jogo', async () => {
    const g = new SpyGame();
    mgr.start(GUILD, CHAN, g);
    await flush();
    const inChan = mgr.handleMessage({
      guildId: GUILD,
      channelId: CHAN,
      authorId: 'u',
      authorName: 'U',
      content: 'ola',
    });
    expect(inChan).toBe(true);
    // Noutro canal da mesma guild -> NAO consome (TTS normal segue).
    const otherChan = mgr.handleMessage({
      guildId: GUILD,
      channelId: 'c2',
      authorId: 'u',
      authorName: 'U',
      content: 'oi',
    });
    expect(otherChan).toBe(false);
    await flush();
    expect(g.messages).toEqual(['ola']);
  });

  it('sem jogo ativo -> handleMessage devolve false', () => {
    expect(
      mgr.handleMessage({ guildId: GUILD, channelId: CHAN, authorId: 'u', authorName: 'U', content: 'x' }),
    ).toBe(false);
  });

  it('ctx.after dispara com o avanco do relogio; end cancela os timers pendentes', async () => {
    const g = new SpyGame();
    mgr.start(GUILD, CHAN, g);
    await flush();
    const fired = vi.fn();
    g.ctx!.after(1000, fired);
    expect(clock.pending()).toBe(1);
    clock.advance(999);
    expect(fired).not.toHaveBeenCalled();
    clock.advance(1);
    expect(fired).toHaveBeenCalledTimes(1);

    // Novo timer + end -> o timer e cancelado (nao dispara).
    const fired2 = vi.fn();
    g.ctx!.after(500, fired2);
    expect(clock.pending()).toBe(1);
    g.ctx!.end();
    expect(clock.pending()).toBe(0);
    clock.advance(1000);
    expect(fired2).not.toHaveBeenCalled();
  });

  it('end() persiste os pontos acumulados (fim NORMAL da partida)', async () => {
    const g = new SpyGame();
    mgr.start(GUILD, CHAN, g);
    await flush();
    g.ctx!.award('a', 2);
    g.ctx!.award('a', 1);
    g.ctx!.award('b', 5);
    g.ctx!.end();
    expect(env.persistScores).toHaveBeenCalledTimes(1);
    const [gid, points] = (env.persistScores as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(gid).toBe(GUILD);
    expect(points).toEqual(new Map([['a', 3], ['b', 5]]));
    // Apos end o lock esta livre.
    expect(mgr.active(GUILD)).toBe(false);
  });

  it('stop() e endGuild() abortam SEM persistir pontos', async () => {
    const g = new SpyGame();
    mgr.start(GUILD, CHAN, g);
    await flush();
    g.ctx!.award('a', 9);
    expect(mgr.stop(GUILD)).toBe(true);
    expect(env.persistScores).not.toHaveBeenCalled();
    expect(mgr.active(GUILD)).toBe(false);
    // stop sem jogo -> false.
    expect(mgr.stop(GUILD)).toBe(false);

    // endGuild idem (funil de saida): aborta e nao persiste.
    const g2 = new SpyGame();
    mgr.start(GUILD, CHAN, g2);
    await flush();
    g2.ctx!.award('x', 3);
    mgr.endGuild(GUILD);
    expect(env.persistScores).not.toHaveBeenCalled();
    expect(mgr.active(GUILD)).toBe(false);
  });

  it('onVoiceLeft termina jogos de VOZ mas poupa os de tabuleiro; endGuild termina qualquer', async () => {
    // Jogo de VOZ (needsVoice default true): uma saida de voz termina-o.
    mgr.start(GUILD, CHAN, new SpyGame());
    await flush();
    mgr.onVoiceLeft(GUILD);
    expect(mgr.active(GUILD)).toBe(false);

    // Jogo de TABULEIRO (needsVoice=false): sobrevive a uma saida de voz nao relacionada.
    mgr.start(GUILD, CHAN, new SpyGame(), false);
    await flush();
    mgr.onVoiceLeft(GUILD);
    expect(mgr.active(GUILD)).toBe(true);
    // Mas a guild ser removida (endGuild) termina-o na mesma (sem leak).
    mgr.endGuild(GUILD);
    expect(mgr.active(GUILD)).toBe(false);
  });

  it('ctx.say usa o player; sem player devolve false', async () => {
    const say = vi.fn(async () => true);
    let hasPlayer = true;
    env = makeEnv({ getPlayer: () => (hasPlayer ? { say } : undefined) });
    mgr = new GameManager(env);
    const g = new SpyGame();
    mgr.start(GUILD, CHAN, g);
    await flush();
    await expect(g.ctx!.say('ola', { model: 'de_DE-thorsten-medium' })).resolves.toBe(true);
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'ola', model: 'de_DE-thorsten-medium', singleVoice: true }),
    );
    hasPlayer = false;
    await expect(g.ctx!.say('sem call')).resolves.toBe(false);
  });

  it('ctx.send delega no sendToChannel do env (com o canal do jogo)', async () => {
    const g = new SpyGame();
    mgr.start(GUILD, CHAN, g);
    await flush();
    await g.ctx!.send('mensagem');
    expect(env.sendToChannel).toHaveBeenCalledWith(CHAN, 'mensagem');
  });

  it('um throw dentro do jogo nao escapa (e logado)', async () => {
    const boom: Game = {
      id: 'boom',
      start: () => {
        throw new Error('crash no start');
      },
      onMessage: () => {},
    };
    mgr.start(GUILD, CHAN, boom);
    await flush();
    expect(env.logError).toHaveBeenCalled();
  });
});

// ── Jogos em THREAD descartável (servidores grandes) ──────────────────────────
const THREAD = 't1';
const PARENT = 'c1';
describe('GameManager — jogo em thread descartável', () => {
  let env: GameEnv;
  let clock: FakeClock;
  let deleteChannel: ReturnType<typeof vi.fn>;
  let mgr: GameManager;
  beforeEach(() => {
    deleteChannel = vi.fn(async () => {});
    // translate que inclui os params, para conseguirmos verificar o vencedor no resumo.
    env = makeEnv({
      deleteChannel,
      translate: (key, _loc, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    });
    clock = env.clock as FakeClock;
    mgr = new GameManager(env);
  });

  it('o jogo corre no channelId da THREAD; as mensagens da thread são encaminhadas', async () => {
    const g = new SpyGame();
    mgr.start(GUILD, THREAD, g, false, 'en', PARENT);
    await flush();
    expect(mgr.channelOf(GUILD)).toBe(THREAD);
    // Mensagem NA thread -> consumida; no canal-pai -> NÃO (é o chat normal).
    expect(mgr.handleMessage({ guildId: GUILD, channelId: THREAD, authorId: 'u', authorName: 'U', content: 'ola' })).toBe(true);
    expect(mgr.handleMessage({ guildId: GUILD, channelId: PARENT, authorId: 'u', authorName: 'U', content: 'oi' })).toBe(false);
    await flush();
    expect(g.messages).toEqual(['ola']);
  });

  it('fim normal: resumo do VENCEDOR vai ao canal-pai e a thread é apagada 5s depois', async () => {
    const g = new SpyGame();
    mgr.start(GUILD, THREAD, g, false, 'en', PARENT);
    await flush();
    g.ctx!.award('a', 2);
    g.ctx!.award('b', 9); // b vence
    g.ctx!.end();

    // Resumo no PAI (não na thread), com o mention do vencedor 'b'.
    const send = env.sendToChannel as ReturnType<typeof vi.fn>;
    const parentCall = send.mock.calls.find((c) => c[0] === PARENT);
    expect(parentCall).toBeDefined();
    expect(String(parentCall![1])).toContain('game.thread.winner');
    expect(String(parentCall![1])).toContain('<@b>');
    // A thread ainda NÃO foi apagada.
    expect(deleteChannel).not.toHaveBeenCalled();
    clock.advance(5000);
    expect(deleteChannel).toHaveBeenCalledWith(THREAD);
    // Pontos persistidos (fim normal).
    expect(env.persistScores).toHaveBeenCalledTimes(1);
  });

  it('abortado (stop, sem pontos): resumo "terminou" no pai + apaga a thread', async () => {
    const g = new SpyGame();
    mgr.start(GUILD, THREAD, g, false, 'en', PARENT);
    await flush();
    mgr.stop(GUILD);
    const send = env.sendToChannel as ReturnType<typeof vi.fn>;
    const parentCall = send.mock.calls.find((c) => c[0] === PARENT);
    expect(String(parentCall![1])).toContain('game.thread.ended');
    clock.advance(5000);
    expect(deleteChannel).toHaveBeenCalledWith(THREAD);
    expect(env.persistScores).not.toHaveBeenCalled();
  });

  it('SEM thread (parentChannelId undefined): não anuncia no pai nem apaga canal', async () => {
    const g = new SpyGame();
    mgr.start(GUILD, PARENT, g, false, 'en'); // sem parentChannelId
    await flush();
    g.ctx!.award('a', 1);
    g.ctx!.end();
    // O único send seria do próprio jogo (aqui não envia nada); nenhum delete agendado.
    clock.advance(5000);
    expect(deleteChannel).not.toHaveBeenCalled();
  });

  it('degrada sem env.deleteChannel: anuncia no pai mas não tenta apagar', async () => {
    const noDelete = makeEnv({ translate: (k, _l, p) => (p ? `${k} ${JSON.stringify(p)}` : k) });
    const c = noDelete.clock as FakeClock;
    const m = new GameManager(noDelete);
    const g = new SpyGame();
    m.start(GUILD, THREAD, g, false, 'en', PARENT);
    await flush();
    g.ctx!.end();
    expect(noDelete.sendToChannel).toHaveBeenCalled();
    // Sem deleteChannel no env, nenhum timer de delete foi agendado.
    expect(c.pending()).toBe(0);
  });
});
