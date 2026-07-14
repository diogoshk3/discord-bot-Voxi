import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameManager } from '../src/games/manager';
import type { Clock, GameEnv, TimerHandle } from '../src/games/types';
import { gameById } from '../src/games/index';

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

const PT_VOICE = 'pt_BR-faber-medium';
function harness() {
  const clock = new FakeClock();
  const say = vi.fn(async () => true);
  const send = vi.fn(async () => {});
  const persistScores = vi.fn();
  const logError = vi.fn();
  const env: GameEnv = {
    clock,
    availableModels: [PT_VOICE, 'en_US-amy-medium'],
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
const msg = (authorId: string, content: string) => ({
  guildId: G,
  channelId: C,
  authorId,
  authorName: authorId.toUpperCase(),
  content,
});
// A última chave enviada e os seus params (o translate mock devolve "key {json}").
function lastSend(send: ReturnType<typeof vi.fn>): {
  key: string;
  params: Record<string, unknown>;
} {
  const raw = String(send.mock.calls.at(-1)?.[1] ?? '');
  const sp = raw.indexOf(' ');
  const key = sp === -1 ? raw : raw.slice(0, sp);
  let params: Record<string, unknown> = {};
  try {
    params = sp === -1 ? {} : JSON.parse(raw.slice(sp + 1));
  } catch {
    /* sem params */
  }
  return { key, params };
}
const sentKeys = (send: ReturnType<typeof vi.fn>): string[] =>
  send.mock.calls.map((c) => String(c[1]).split(' ')[0]);

// Índice: 1.ª letra -> uma palavra PT real e curta (>=5 letras, para passar qualquer mínimo).
let wordByLetter: Map<string, string[]>;
beforeAll(() => {
  const file = join(__dirname, '..', 'assets', 'wordlists', 'pt.txt');
  // Split em /\r?\n/ (NAO so '\n'): num checkout CRLF (Windows, core.autocrlf=true) o
  // '\n' deixaria um '\r' final na palavra (ex.: "gabar\r"). Essa palavra e usada como
  // conteudo da mensagem E na asserção say({ text: word }); o jogo fala a forma
  // normalizada (sem '\r'), pelo que a asserção nunca casaria e o say nao seria detetado
  // — a raiz do teste flaky (0 chamadas ao say). Em LF fica byte-a-byte identico.
  const words = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  wordByLetter = new Map();
  for (const w of words) {
    if (w.length < 5 || w.length > 9) continue;
    const arr = wordByLetter.get(w[0]) ?? [];
    if (arr.length < 30) arr.push(w);
    wordByLetter.set(w[0], arr);
  }
});
/** Uma palavra PT real começada por `letter` e ainda não usada em `used`. */
function pickWord(letter: string, used: Set<string>): string {
  const arr = wordByLetter.get(letter.toLowerCase()) ?? [];
  const w = arr.find((x) => !used.has(x));
  if (!w) throw new Error(`sem palavra PT para a letra ${letter}`);
  return w;
}

describe('word-chain — integração (manager + clock falso, wordlist PT real)', () => {
  it('lobby: <2 jogadores -> cancela', async () => {
    const { env, clock, send } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('word-chain')!.create({ language: 'pt' }), false, 'pt');
    await flush();
    mgr.handleMessage(msg('u1', 'eu')); // só 1 jogador
    await flush();
    clock.advance(20000);
    await flush();
    expect(sentKeys(send)).toContain('game.wordChain.notEnough');
    expect(mgr.active(G)).toBe(false);
  });

  it('welcome falado na voz PT + palavra aceite é lida em voz alta', async () => {
    const { env, clock, send, say } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('word-chain')!.create({ language: 'pt' }), false, 'pt');
    await flush();
    mgr.handleMessage(msg('u1', 'entro'));
    mgr.handleMessage(msg('u2', 'eu tambem'));
    await flush();
    clock.advance(20000); // fim do lobby -> começa
    await flush();

    // Boas-vindas faladas na voz PT (o player.say recebe um SynthRequest completo).
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Bem-vindos'), model: PT_VOICE }),
    );
    expect(sentKeys(send)).toContain('game.wordChain.begin');

    // Turno anunciado: extrair a letra exigida e jogar uma palavra PT válida.
    const turn = lastSend(send);
    expect(turn.key).toBe('game.wordChain.turn');
    const letter = String(turn.params.letter);
    const word = pickWord(letter, new Set());
    say.mockClear();
    mgr.handleMessage(msg('u1', word)); // u1 é o 1.º da ordem
    await flush();

    // A palavra aceite foi LIDA em voz alta na voz PT + mensagem de aceitação.
    expect(say).toHaveBeenCalledWith(expect.objectContaining({ text: word, model: PT_VOICE }));
    expect(sentKeys(send)).toContain('game.wordChain.accepted');
  });

  it('mensagem de espectador (não é a sua vez) é ignorada', async () => {
    const { env, clock, send } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('word-chain')!.create({ language: 'pt' }), false, 'pt');
    await flush();
    mgr.handleMessage(msg('u1', 'a'));
    mgr.handleMessage(msg('u2', 'b'));
    await flush();
    clock.advance(20000);
    await flush();
    const before = send.mock.calls.length;
    // u2 fala fora da vez (a vez é do u1) -> nada acontece.
    mgr.handleMessage(msg('u2', 'palavra'));
    await flush();
    expect(send.mock.calls.length).toBe(before);
  });

  it('2 vidas: timeouts eliminam e declaram vencedor (pontos persistidos)', async () => {
    const { env, clock, send, persistScores } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('word-chain')!.create({ language: 'pt' }), false, 'pt');
    await flush();
    mgr.handleMessage(msg('u1', 'a'));
    mgr.handleMessage(msg('u2', 'b'));
    await flush();
    clock.advance(20000);
    await flush();
    // Ninguém joga: 3 timeouts (turnMs fixo em 15s sem palavras aceites).
    // u1 timeout (1 vida) -> u2 timeout (1 vida) -> u1 timeout (0 -> eliminado) -> u2 vence.
    for (let k = 0; k < 3; k++) {
      clock.advance(15000);
      await flush();
    }
    expect(sentKeys(send)).toContain('game.wordChain.eliminated');
    expect(sentKeys(send)).toContain('game.wordChain.winner');
    expect(mgr.active(G)).toBe(false);
    expect(persistScores).toHaveBeenCalledTimes(1); // fim NORMAL -> persiste
    const points = persistScores.mock.calls[0][1] as Map<string, number>;
    expect(points.get('u2') ?? 0).toBeGreaterThan(0); // vencedor pontuou
  });
});
