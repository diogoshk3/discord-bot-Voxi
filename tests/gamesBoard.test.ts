import { describe, it, expect, vi } from 'vitest';
import { GameManager } from '../src/games/manager';
import type { Clock, GameEnv, TimerHandle } from '../src/games/types';
import { gameById } from '../src/games/index';
import { wordsForLocale } from '../src/games/content/words';
import { pickWordleWords } from '../src/games/content/wordleWords';
import { normalizeAnswer, seededIndex } from '../src/games/util';

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
  const send = vi.fn(async () => {});
  const persistScores = vi.fn();
  const logError = vi.fn();
  const env: GameEnv = {
    clock,
    availableModels: ['en_US-amy-medium'],
    defaultSpeed: 1,
    defaultVoiceOf: () => 'en_US-amy-medium',
    getPlayer: () => undefined, // jogos de tabuleiro nao falam
    sendToChannel: send,
    localeOf: () => 'en',
    translate: (key, _l, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    persistScores,
    logError,
  };
  return { env, clock, send, persistScores, logError };
}

const G = 'g1';
const C = 'c1';
const say = (mgr: GameManager, authorId: string, content: string): void => {
  mgr.handleMessage({ guildId: G, channelId: C, authorId, authorName: authorId, content });
};
// A semente da sessao = clock.now() no start = 0 (FakeClock comeca a 0).
const SEED = 0;

describe('Forca', () => {
  it('adivinhar a palavra inteira ganha o ponto', async () => {
    const { env, send, persistScores } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('hangman')!.create());
    await flush();
    const { words } = wordsForLocale('en');
    const word = normalizeAnswer(words[seededIndex(SEED, words.length)]);
    say(mgr, 'u', word);
    await flush();
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.hangman.win'))).toBe(true);
    expect(persistScores.mock.calls[0][1].get('u')).toBe(1);
    expect(mgr.active(G)).toBe(false);
  });

  it('6 letras erradas -> derrota, sem pontos', async () => {
    const { env, send, persistScores } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('hangman')!.create());
    await flush();
    const { words } = wordsForLocale('en');
    const word = normalizeAnswer(words[seededIndex(SEED, words.length)]);
    const wrong = 'qwertyuiopasdfghjklzxcvbnm'.split('').filter((l) => !word.includes(l)).slice(0, 6);
    for (const l of wrong) {
      say(mgr, 'u', l);
      await flush();
    }
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.hangman.lose'))).toBe(true);
    expect(persistScores).not.toHaveBeenCalled();
    expect(mgr.active(G)).toBe(false);
  });
});

describe('Termo/Wordle', () => {
  it('acertar a palavra de 5 letras ganha; mensagens não-5-letras são ignoradas', async () => {
    const { env, send, persistScores } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('wordle')!.create());
    await flush();
    // Chat qualquer (não 5 letras) não conta como palpite.
    say(mgr, 'u', 'ola pessoal');
    await flush();
    const { words } = pickWordleWords('en');
    const target = normalizeAnswer(words[seededIndex(SEED, words.length)]);
    say(mgr, 'u', target);
    await flush();
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.wordle.win'))).toBe(true);
    expect(persistScores.mock.calls[0][1].get('u')).toBe(1);
  });

  it('palpite errado mostra a linha 🟩🟨⬛ e conta uma tentativa', async () => {
    const { env, send } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('wordle')!.create());
    await flush();
    const { words } = pickWordleWords('en');
    const target = normalizeAnswer(words[seededIndex(SEED, words.length)]);
    // Um palpite de 5 letras diferente do alvo (garante ≠).
    const guess = target === 'zzzzz' ? 'aaaaa' : 'zzzzz';
    say(mgr, 'u', guess);
    await flush();
    const guessMsg = send.mock.calls.map((c) => String(c[1])).find((s) => s.startsWith('game.wordle.guess'));
    expect(guessMsg).toBeDefined();
    expect(guessMsg).toMatch(/[🟩🟨⬛]/u);
    expect(mgr.active(G)).toBe(true); // ainda a decorrer
  });
});

describe('Galo', () => {
  it('X faz linha e ganha; jogar fora da vez é recusado', async () => {
    const { env, send, persistScores } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('tictactoe')!.create());
    await flush();
    // X (ana) joga a 1; ana tenta jogar de novo fora da vez -> recusado.
    say(mgr, 'ana', '1');
    await flush();
    say(mgr, 'ana', '2');
    await flush();
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.tictactoe.notYourTurn'))).toBe(true);
    // O (rui) joga 4; segue a sequência até X fazer a linha 1-2-3.
    say(mgr, 'rui', '4');
    await flush();
    say(mgr, 'ana', '2');
    await flush();
    say(mgr, 'rui', '5');
    await flush();
    say(mgr, 'ana', '3');
    await flush();
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.tictactoe.win'))).toBe(true);
    expect(persistScores.mock.calls[0][1].get('ana')).toBe(1);
    expect(mgr.active(G)).toBe(false);
  });
});
