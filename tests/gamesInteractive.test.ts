import { describe, it, expect, vi } from 'vitest';
import { GameManager } from '../src/games/manager';
import type { Clock, GameEnv, Sendable, TimerHandle } from '../src/games/types';
import type { SynthRequest } from '../src/tts/engine';
import { gameById } from '../src/games/index';
import { pickPrompts, ROULETTE_PROMPTS } from '../src/games/content/roulettePrompts';

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

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
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.time = due.at;
      due.fn();
    }
    this.time = target;
  }
}

function harness() {
  const clock = new FakeClock();
  // Params tipados p/ o typecheck: sem eles, .mock.calls fica tuplo vazio (TS2493/2352).
  const say = vi.fn(async (_req: SynthRequest) => true);
  const send = vi.fn(async (_channelId: string, _content: Sendable) => {});
  const persistScores = vi.fn((_guildId: string, _points: Map<string, number>) => {});
  const logError = vi.fn();
  const env: GameEnv = {
    clock,
    availableModels: ['en_US-amy-medium', 'de_DE-thorsten-medium'],
    defaultSpeed: 1,
    defaultVoiceOf: () => 'en_US-amy-medium',
    getPlayer: () => ({ say }),
    sendToChannel: send,
    localeOf: () => 'en',
    translate: (key, _l, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    persistScores,
    logError,
  };
  return { env, clock, say, send, persistScores, logError };
}

const G = 'g1';
const C = 'c1';
const sentKeys = (send: ReturnType<typeof vi.fn>): string[] =>
  send.mock.calls.map((c) => String(c[1]).split(' ')[0]);

describe('Reflexos', () => {
  it('false-start antes do GO nao pontua; depois do GO o 1o ganha', async () => {
    const { env, clock, send, persistScores } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('reflexes')!.create());
    await flush();

    // Antes do GO: uma mensagem e falsa partida (tooSoon), sem resolver a ronda.
    mgr.handleMessage({ guildId: G, channelId: C, authorId: 'jumpy', authorName: 'J', content: 'já!' });
    await flush();
    expect(sentKeys(send)).toContain('game.reflexes.tooSoon');

    // Abre a janela (delay maximo < 6s) e ganha a ronda 1.
    clock.advance(6_000);
    await flush();
    expect(sentKeys(send)).toContain('game.reflexes.go');
    mgr.handleMessage({ guildId: G, channelId: C, authorId: 'fast', authorName: 'Fast', content: 'aqui' });
    await flush();

    // Ganha as restantes 2 rondas da mesma forma.
    for (let r = 0; r < 2; r++) {
      clock.advance(6_000);
      await flush();
      mgr.handleMessage({ guildId: G, channelId: C, authorId: 'fast', authorName: 'Fast', content: 'x' });
      await flush();
    }
    expect(persistScores).toHaveBeenCalledTimes(1);
    expect(persistScores.mock.calls[0][1].get('fast')).toBe(3);
    expect(mgr.active(G)).toBe(false);
  });
});

describe('Vozen Diz', () => {
  it('obedecer numa ordem real pontua; cair numa ratoeira e apanhado (sem ponto)', async () => {
    const { env, say, send, persistScores } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('vozen-says')!.create());
    await flush();

    let realObeyed = 0;
    for (let r = 0; r < 6; r++) {
      // Ultimo announce indica real vs trap; a palavra e o ultimo token do ctx.say.
      const announce = [...send.mock.calls].reverse().find((c) =>
        String(c[1]).startsWith('game.vozenSays.real') || String(c[1]).startsWith('game.vozenSays.trap'),
      );
      const isReal = String(announce![1]).startsWith('game.vozenSays.real');
      const spoken = (say.mock.calls[say.mock.calls.length - 1][0] as { text: string }).text;
      const word = spoken.split(' ').pop()!;
      const before = send.mock.calls.length;
      mgr.handleMessage({ guildId: G, channelId: C, authorId: 'u', authorName: 'U', content: word });
      await flush();
      const newKeys = send.mock.calls.slice(before).map((c) => String(c[1]).split(' ')[0]);
      if (isReal) {
        expect(newKeys).toContain('game.vozenSays.obeyed');
        realObeyed++;
      } else {
        expect(newKeys).toContain('game.vozenSays.caught');
        // Ratoeira nao avanca a ronda -> força o timeout para seguir.
        env.clock && (env.clock as FakeClock).advance(12_000);
        await flush();
      }
    }
    // Terminou -> pontos == nº de ordens reais obedecidas.
    expect(persistScores).toHaveBeenCalledTimes(1);
    expect(persistScores.mock.calls[0][1].get('u')).toBe(realObeyed);
  });
});

describe('Roleta', () => {
  it('one-shot: lê um desafio, fala-o e termina de imediato', async () => {
    const { env, say, send } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('roulette')!.create());
    await flush();
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.roulette.header'))).toBe(true);
    expect(say).toHaveBeenCalledTimes(1);
    expect(mgr.active(G)).toBe(false); // terminou logo no start
  });

  it('pickPrompts resolve a língua (base do locale) e cai em inglês se não houver', () => {
    for (const lang of ['en', 'pt', 'es', 'fr', 'de', 'it']) {
      expect(pickPrompts(lang)).toBe(ROULETTE_PROMPTS[lang]);
      expect(pickPrompts(`${lang}-XX`)).toBe(ROULETTE_PROMPTS[lang]); // normaliza a base
    }
    expect(pickPrompts('zz')).toBe(ROULETTE_PROMPTS.en); // sem banco -> inglês
    // Cada banco tem desafios (não vazio).
    for (const arr of Object.values(ROULETTE_PROMPTS)) expect(arr.length).toBeGreaterThan(0);
  });
});
