import { describe, it, expect, vi } from 'vitest';
import { GameManager } from '../src/games/manager';
import type { Clock, GameEnv, Sendable, TimerHandle } from '../src/games/types';
import { gameById } from '../src/games/index';
import { wordsForLocale } from '../src/games/content/words';
import { pickWordleWords } from '../src/games/content/wordleWords';
import { normalizeAnswer, seededIndex } from '../src/games/util';
import { CHESS_EMOJI_NAMES } from '../src/games/boardEmojis';

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
  // Params tipados p/ o typecheck dos testes: sem eles, .mock.calls fica tuplo vazio
  // e c[1] / calls[0][1] dão TS2493 (assinaturas reais no GameEnv).
  const send = vi.fn(async (_channelId: string, _content: Sendable) => {});
  const persistScores = vi.fn((_guildId: string, _points: Map<string, number>) => {});
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

  it('com tiles instalados: mostra o boneco da forca no estágio certo (nº de erros)', async () => {
    const { env, send } = harness();
    env.boardEmojis = Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [`h${i}`, `<:h${i}:1234567890123456789>`]),
    );
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('hangman')!.create());
    await flush();
    const { words } = wordsForLocale('en');
    const word = normalizeAnswer(words[seededIndex(SEED, words.length)]);
    // Início: 0 erros -> estágio h0 (só a forca).
    expect(String(send.mock.calls[0][1])).toContain('<:h0:');
    // Uma letra errada -> estágio h1.
    const wrong = 'qwertyuiopasdfghjklzxcvbnm'.split('').find((l) => !word.includes(l))!;
    say(mgr, 'u', wrong);
    await flush();
    expect(String(send.mock.calls[send.mock.calls.length - 1][1])).toContain('<:h1:');
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
    expect(send.mock.calls.some((c) => String(c[1]).includes('game.wordle.win'))).toBe(true);
    expect(persistScores.mock.calls[0][1].get('u')).toBe(1);
  });

  it('palpite errado mostra as letras coloridas (bloco ansi) e conta uma tentativa', async () => {
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
    const guessMsg = send.mock.calls.map((c) => String(c[1])).find((s) => s.includes('game.wordle.guess'));
    expect(guessMsg).toBeDefined();
    // As letras coloridas vêm num bloco ```ansi com as letras do palpite (maiúsculas).
    expect(guessMsg).toContain('```ansi');
    expect(guessMsg).toContain(guess.toUpperCase()[0]);
    expect(mgr.active(G)).toBe(true); // ainda a decorrer
  });

  it('mostra o teclado com as letras descartadas (fora) após um palpite', async () => {
    const { env, send } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('wordle')!.create());
    await flush();
    const { words } = pickWordleWords('en');
    const target = normalizeAnswer(words[seededIndex(SEED, words.length)]);
    // Palpite de 5 letras que NÃO estão no alvo -> todas viram "fora".
    const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const notInTarget = alphabet.filter((l) => !target.includes(l)).slice(0, 5).join('');
    say(mgr, 'u', notInTarget);
    await flush();
    const guessMsg = send.mock.calls.map((c) => String(c[1])).find((s) => s.includes('game.wordle.guess'));
    expect(guessMsg).toContain('game.wordle.out'); // linha das letras descartadas
    // A 1ª letra descartada aparece na linha "fora".
    expect(guessMsg).toContain(notInTarget[0].toUpperCase());
  });

  // Mapa dos 78 tiles do wordle: w{g|y|x}{a-z} -> markup com id de 19 dígitos.
  const fakeWordleMap = (): Record<string, string> => {
    const m: Record<string, string> = {};
    for (const s of ['g', 'y', 'x']) {
      for (const l of 'abcdefghijklmnopqrstuvwxyz') m[`w${s}${l}`] = `<:w${s}${l}:1234567890123456789>`;
    }
    return m;
  };

  it('com tiles instalados: grelha em emojis (5 por palpite, acumula), sem bloco ansi', async () => {
    const { env, send } = harness();
    env.boardEmojis = fakeWordleMap();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('wordle')!.create());
    await flush();
    const { words } = pickWordleWords('en');
    const target = normalizeAnswer(words[seededIndex(SEED, words.length)]);
    const g1 = target === 'zzzzz' ? 'aaaaa' : 'zzzzz';
    const g2 = target === 'qqqqq' ? 'bbbbb' : 'qqqqq';
    say(mgr, 'u', g1);
    await flush();
    const msg1 = send.mock.calls.map((c) => String(c[1])).find((s) => s.includes('game.wordle.guess'));
    expect(msg1).toBeDefined();
    expect(msg1).not.toContain('```ansi'); // já não é o fallback
    expect((msg1!.match(/<:w[gyx]/g) ?? []).length).toBe(5); // 1 palpite = 5 tiles
    // 2º palpite -> a grelha acumula para 10 tiles.
    say(mgr, 'u', g2);
    await flush();
    const msg2 = send.mock.calls.map((c) => String(c[1])).reverse().find((s) => s.includes('game.wordle.guess'));
    expect((msg2!.match(/<:w[gyx]/g) ?? []).length).toBe(10);
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

  it('com tiles instalados: grelha em emojis (tx/to/números), sem code block', async () => {
    const { env, send } = harness();
    env.boardEmojis = {
      tx: '<:tx:1234567890123456789>',
      to: '<:to:1234567890123456789>',
      ...Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [`t${i + 1}`, `<:t${i + 1}:1234567890123456789>`]),
      ),
    };
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('tictactoe')!.create());
    await flush();
    say(mgr, 'ana', '1'); // X joga na casa 1
    await flush();
    const msg = send.mock.calls.map((c) => String(c[1])).reverse().find((s) => s.includes('game.tictactoe.turn'));
    expect(msg).toBeDefined();
    expect(msg).not.toContain('```'); // já não é o ASCII
    expect(msg).toContain('<:tx:'); // a jogada de X aparece como tile
    expect((msg!.match(/<:t/g) ?? []).length).toBe(9); // 9 casas, cada uma um tile
  });

  it('tabuleiro cheio sem linha -> empate, sem pontos', async () => {
    const { env, send, persistScores } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('tictactoe')!.create());
    await flush();
    // Sequência conhecida de "gato" (X começa): X:1 O:3 X:2 O:4 X:6 O:5 X:7 O:8 X:9.
    // Resultado: X em 1,2,6,7,9 e O em 3,4,5,8 — 9 casas, nenhuma linha.
    const seq: [string, string][] = [
      ['ana', '1'], ['rui', '3'], ['ana', '2'], ['rui', '4'], ['ana', '6'],
      ['rui', '5'], ['ana', '7'], ['rui', '8'], ['ana', '9'],
    ];
    for (const [u, n] of seq) {
      say(mgr, u, n);
      await flush();
    }
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.tictactoe.draw'))).toBe(true);
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.tictactoe.win'))).toBe(false);
    expect(persistScores).not.toHaveBeenCalled();
    expect(mgr.active(G)).toBe(false);
  });

  it('um 3º jogador é espetador (não ocupa casa)', async () => {
    const { env, send } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('tictactoe')!.create());
    await flush();
    say(mgr, 'ana', '1'); // X
    await flush();
    say(mgr, 'rui', '2'); // O
    await flush();
    say(mgr, 'carlos', '3'); // espetador -> ignorado
    await flush();
    say(mgr, 'ana', '3'); // X consegue jogar a 3 (não foi ocupada pelo carlos)
    await flush();
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.tictactoe.taken'))).toBe(false);
    expect(mgr.active(G)).toBe(true); // ainda a decorrer
  });
});

describe('Xadrez', () => {
  it('mate do pastor invertido (fool\'s mate): brancas=1º a jogar, pretas dão xeque-mate em 4 jogadas', async () => {
    const { env, send, persistScores } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('chess')!.create());
    await flush();
    say(mgr, 'ana', 'f3'); // ana -> brancas
    await flush();
    say(mgr, 'rui', 'e5'); // rui -> pretas
    await flush();
    say(mgr, 'ana', 'g4');
    await flush();
    say(mgr, 'rui', 'Qh4'); // xeque-mate
    await flush();
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.chess.checkmate'))).toBe(true);
    expect(persistScores.mock.calls[0][1].get('rui')).toBe(3); // rui (pretas) ganhou
    expect(mgr.active(G)).toBe(false);
  });

  it('jogar fora da vez é recusado; jogada ilegal é recusada sem mudar o turno', async () => {
    const { env, send } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('chess')!.create());
    await flush();
    say(mgr, 'ana', 'f3'); // ana -> brancas, joga
    await flush();
    say(mgr, 'ana', 'f4'); // ana tenta jogar de novo fora da vez -> recusado
    await flush();
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.chess.notYourTurn'))).toBe(true);
    say(mgr, 'rui', 'e6'); // rui -> pretas, joga bem
    await flush();
    say(mgr, 'ana', 'Qh8'); // brancas: jogada ilegal (dama nao chega ali)
    await flush();
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.chess.illegalMove'))).toBe(true);
    expect(mgr.active(G)).toBe(true); // jogo continua, ninguem ganhou por engano
  });

  it('desistir ("resign") termina o jogo e dá a vitória ao adversário', async () => {
    const { env, send, persistScores } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('chess')!.create());
    await flush();
    say(mgr, 'ana', 'f3'); // ana -> brancas
    await flush();
    say(mgr, 'rui', 'e5'); // rui -> pretas
    await flush();
    say(mgr, 'ana', 'resign');
    await flush();
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.chess.resigned'))).toBe(true);
    expect(persistScores.mock.calls[0][1].get('rui')).toBe(3);
    expect(mgr.active(G)).toBe(false);
  });

  it('um 3º jogador é espetador; conversa normal não conta como jogada', async () => {
    const { env, send } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('chess')!.create());
    await flush();
    say(mgr, 'ana', 'hello everyone, good luck!'); // conversa, nao e jogada -> ignorado
    await flush();
    say(mgr, 'ana', 'f3'); // so agora ana reclama as brancas
    await flush();
    say(mgr, 'rui', 'e5'); // rui -> pretas
    await flush();
    say(mgr, 'carlos', 'Nc3'); // espetador (assentos cheios) -> ignorado, mesmo sendo jogada válida
    await flush();
    expect(send.mock.calls.some((c) => String(c[1]).startsWith('game.chess.illegalMove'))).toBe(false);
    expect(mgr.active(G)).toBe(true); // ainda a decorrer, vez das brancas
  });

  // Mapa nome->markup dos 26 emojis, com IDs de 19 dígitos (como os reais) para o teste
  // de comprimento refletir o orçamento verdadeiro dos 2000 chars.
  const fakeEmojiMap = (): Record<string, string> =>
    Object.fromEntries(CHESS_EMOJI_NAMES.map((n) => [n, `<:${n}:1234567890123456789>`]));

  it('render em emojis: 64 casas, alternância clara/escura correta, cabe em <2000 chars', async () => {
    const { env, send } = harness();
    env.boardEmojis = fakeEmojiMap();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('chess')!.create());
    await flush();
    const msg = String(send.mock.calls[0][1]);
    // Nova partida = 64 casas + 8 tiles de etiqueta de ficheiro = 72 emojis.
    expect((msg.match(/<:/g) ?? []).length).toBe(72);
    // Mapeamento peça×casa: a8 (canto sup. esq.) é casa CLARA -> torre preta clara (brl);
    // b8 é escura -> cavalo preto escuro (bnd); a1 é escura -> torre branca escura (wrd).
    expect(msg).toContain('<:brl:');
    expect(msg).toContain('<:bnd:');
    expect(msg).toContain('<:wrd:');
    // Etiquetas dos ficheiros são tiles próprios (fa..fh), NÃO indicadores regionais
    // (esses combinavam-se em bandeiras: 🇨🇩=Congo, 🇬🇭=Gana).
    expect(msg).toContain('<:fa:');
    expect(msg).toContain('<:fh:');
    expect(msg).not.toContain('🇦');
    // Orçamento do Discord (UTF-16 length é um limite conservador vs code points).
    expect(msg.length).toBeLessThan(2000);
  });

  it('sem emojis instalados: cai no tabuleiro ASCII (code block), sem markup de emoji', async () => {
    const { env, send } = harness(); // harness normal NÃO define boardEmojis
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('chess')!.create());
    await flush();
    const msg = String(send.mock.calls[0][1]);
    expect(msg).toContain('```'); // code block ASCII
    expect(msg).not.toContain('<:'); // nenhum emoji custom
  });
});
