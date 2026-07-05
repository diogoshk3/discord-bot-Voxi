import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameManager } from '../src/games/manager';
import type { Clock, GameEnv, TimerHandle } from '../src/games/types';
import {
  guessLanguageDef,
  guessableLanguages,
  acceptableAnswers,
} from '../src/games/guessLanguage';
import { baseCodeOf, localizedLanguageName } from '../src/games/util';

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

const G = 'g1';
const C = 'c1';

// ── funcoes puras ────────────────────────────────────────────────────────────
describe('guessLanguage — funcoes puras', () => {
  it('guessableLanguages: so linguas com voz E frase, sem duplicar a base', () => {
    const models = [
      'en_US-amy-medium',
      'en_GB-alan-medium', // 2a voz inglesa -> mesma base 'en', ignorada
      'de_DE-thorsten-medium',
      'xx_YY-foo-medium', // sem frase -> excluida
    ];
    const cands = guessableLanguages(models);
    expect(cands.map((c) => c.base)).toEqual(['en', 'de']);
    // A 1a voz de cada base e a escolhida.
    expect(cands[0].model).toBe('en_US-amy-medium');
    expect(cands[0].phrase.length).toBeGreaterThan(0);
  });

  it('acceptableAnswers: aceita codigo, autonimo, nome no locale e nome em ingles', () => {
    const set = acceptableAnswers('de', 'pt');
    expect(set.has('de')).toBe(true); // codigo
    expect(set.has('alemao')).toBe(true); // nome em PT (sem acento, normalizado)
    expect(set.has('german')).toBe(true); // nome em ingles
    expect(set.has('deutsch')).toBe(true); // autonimo
  });

  it('acceptableAnswers aceita o nome em VÁRIAS línguas (bug: "espanhol" era recusado)', () => {
    // Mesmo com o jogo em inglês, um jogador PT deve acertar com "espanhol".
    const set = acceptableAnswers('es', 'en');
    expect(set.has('espanhol')).toBe(true); // PT
    expect(set.has('spanish')).toBe(true); // EN
    expect(set.has('espanol')).toBe(true); // ES (autónimo, sem acento)
    expect(set.has('espagnol')).toBe(true); // FR
    expect(set.has('es')).toBe(true); // código
  });
});

// ── fluxo completo via o manager real ────────────────────────────────────────
function makeEnv(overrides: Partial<GameEnv> = {}): {
  env: GameEnv;
  clock: FakeClock;
  say: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const clock = new FakeClock();
  const say = vi.fn(async () => true);
  const send = vi.fn(async () => {});
  const env: GameEnv = {
    clock,
    availableModels: [
      'en_US-amy-medium',
      'de_DE-thorsten-medium',
      'fr_FR-siwis-medium',
      'es_ES-davefx-medium',
      'it_IT-riccardo-medium',
      'pt_BR-faber-medium',
    ],
    defaultSpeed: 1,
    defaultVoiceOf: () => 'en_US-amy-medium',
    getPlayer: () => ({ say }),
    sendToChannel: send,
    localeOf: () => 'en',
    translate: (key, _locale, params) => `${key}${params ? ' ' + JSON.stringify(params) : ''}`,
    persistScores: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
  return { env, clock, say, send };
}

describe('guessLanguage — partida completa', () => {
  it('anuncia rondas, aceita a resposta certa e persiste os pontos no fim', async () => {
    const { env, say } = makeEnv();
    const mgr = new GameManager(env);
    mgr.start(G, C, guessLanguageDef.create());
    await flush();

    // 6 linguas -> 5 rondas (min(ROUNDS,langs)). Responde certo a cada ronda lendo a
    // lingua REALMENTE falada (o model do ultimo ctx.say) e enviando o nome em ingles.
    for (let r = 0; r < 5; r++) {
      const lastSay = say.mock.calls[say.mock.calls.length - 1][0] as { model: string };
      const base = baseCodeOf(lastSay.model);
      mgr.handleMessage({
        guildId: G,
        channelId: C,
        authorId: 'u1',
        authorName: 'Ana',
        content: localizedLanguageName(base, 'en'),
      });
      await flush();
    }

    // Partida terminou -> persistScores chamado com u1 a somar 5 pontos.
    expect(env.persistScores).toHaveBeenCalledTimes(1);
    const [, points] = (env.persistScores as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(points.get('u1')).toBe(5);
    expect(mgr.active(G)).toBe(false);
  });

  it('resposta errada nao pontua; o timeout avanca a ronda', async () => {
    const { env, clock } = makeEnv();
    const mgr = new GameManager(env);
    mgr.start(G, C, guessLanguageDef.create());
    await flush();

    // Palpite errado -> ignorado (sem award).
    mgr.handleMessage({ guildId: G, channelId: C, authorId: 'u', authorName: 'U', content: 'klingon' });
    await flush();

    // Esgota as 5 rondas por TIMEOUT (25s cada). Ninguem pontuou -> nao persiste.
    for (let r = 0; r < 5; r++) clock.advance(25_000);
    await flush();
    expect(env.persistScores).not.toHaveBeenCalled();
    expect(mgr.active(G)).toBe(false);
  });

  it('sem linguas jogaveis -> avisa e termina sem crashar', async () => {
    const { env, send } = makeEnv({ availableModels: ['xx_YY-foo-medium'] });
    const mgr = new GameManager(env);
    mgr.start(G, C, guessLanguageDef.create());
    await flush();
    expect(send).toHaveBeenCalledWith(C, expect.stringContaining('game.guessLanguage.noLanguages'));
    expect(mgr.active(G)).toBe(false);
  });

  it('so o primeiro a acertar ganha o ponto da ronda (2a resposta certa ignorada)', async () => {
    const { env, say, clock } = makeEnv();
    const mgr = new GameManager(env);
    mgr.start(G, C, guessLanguageDef.create());
    await flush();
    const base = baseCodeOf((say.mock.calls[say.mock.calls.length - 1][0] as { model: string }).model);
    const answer = localizedLanguageName(base, 'en');
    // Dois acertos na MESMA ronda: so o 'first' conta.
    mgr.handleMessage({ guildId: G, channelId: C, authorId: 'first', authorName: 'F', content: answer });
    mgr.handleMessage({ guildId: G, channelId: C, authorId: 'second', authorName: 'S', content: answer });
    await flush();
    // Deixa as rondas restantes expirarem por timeout para a partida terminar e persistir.
    for (let r = 0; r < 5; r++) clock.advance(25_000);
    await flush();
    expect(env.persistScores).toHaveBeenCalledTimes(1);
    const [, points] = (env.persistScores as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(points.get('first')).toBe(1);
    expect(points.has('second')).toBe(false);
  });
});

