import type { Game, GameContext, GameDefinition, GameMessage } from './types';
import { announceWinner } from './finish';
import { pickWordleWords } from './content/wordleWords';
import { normalizeAnswer, seededIndex } from './util';

const MAX_GUESSES = 8;
const IDLE_MS = 180_000;

/**
 * "Termo/Wordle" — colaborativo: qualquer um escreve uma palavra de 5 letras; o Voxi
 * responde com 🟩 (certa no sitio), 🟨 (existe, sitio errado), ⬛ (nao existe). Quem
 * acertar a palavra ganha o ponto; {MAX} tentativas partilhadas. Jogo de TEXTO. So
 * mensagens com EXATAMENTE 5 letras contam (o chat normal e ignorado).
 */
class WordleGame implements Game {
  readonly id = 'wordle';
  private target = '';
  private guesses = 0;
  private over = false;
  private moves = 0;

  async start(ctx: GameContext): Promise<void> {
    const { words } = pickWordleWords(ctx.locale);
    this.target = normalizeAnswer(words[seededIndex(ctx.seed, words.length)] ?? 'apple');
    await ctx.send(ctx.t('game.wordle.intro', { max: MAX_GUESSES }));
    this.armIdle(ctx);
  }

  private armIdle(ctx: GameContext): void {
    const at = ++this.moves;
    ctx.after(IDLE_MS, () => {
      if (at === this.moves && !this.over) {
        this.over = true;
        void ctx.send(ctx.t('game.wordle.idle', { word: this.target.toUpperCase() }));
        ctx.end();
      }
    });
  }

  /** Linha 🟩🟨⬛ de um palpite, ciente da contagem de letras (regras do Wordle). */
  private scoreRow(guess: string): string {
    const res = ['⬛', '⬛', '⬛', '⬛', '⬛'];
    const counts = new Map<string, number>();
    for (const ch of this.target) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    for (let i = 0; i < 5; i++) {
      if (guess[i] === this.target[i]) {
        res[i] = '🟩';
        counts.set(guess[i], (counts.get(guess[i]) ?? 0) - 1);
      }
    }
    for (let i = 0; i < 5; i++) {
      if (res[i] === '🟩') continue;
      const left = counts.get(guess[i]) ?? 0;
      if (left > 0) {
        res[i] = '🟨';
        counts.set(guess[i], left - 1);
      }
    }
    return res.join('');
  }

  onMessage(ctx: GameContext, msg: GameMessage): void {
    if (this.over) return;
    const g = normalizeAnswer(msg.content).replace(/[^a-zà-ſ]/g, '');
    if (g.length !== 5) return; // so palpites de 5 letras contam
    this.armIdle(ctx);
    this.guesses++;
    const row = this.scoreRow(g);
    // As letras vão na 2ª linha, POR BAIXO dos quadrados (o Discord não deixa pôr texto
    // dentro dos emojis 🟩🟨⬛). Espaçadas para se alinharem sob os quadrados.
    const letters = g.toUpperCase().split('').join(' ');
    if (g === this.target) {
      this.over = true;
      ctx.award(msg.authorId, 1);
      void ctx.send(
        ctx.t('game.wordle.win', { user: msg.authorName, word: this.target.toUpperCase(), row, letters, n: this.guesses }),
      );
      announceWinner(ctx, msg.authorName);
      ctx.end();
      return;
    }
    if (this.guesses >= MAX_GUESSES) {
      this.over = true;
      void ctx.send(ctx.t('game.wordle.lose', { word: this.target.toUpperCase(), row, letters }));
      ctx.end();
      return;
    }
    void ctx.send(
      ctx.t('game.wordle.guess', {
        user: msg.authorName,
        row,
        letters,
        left: MAX_GUESSES - this.guesses,
      }),
    );
  }
}

export const wordleDef: GameDefinition = {
  id: 'wordle',
  nameKey: 'game.wordle.name',
  descKey: 'game.wordle.desc',
  needsVoice: false,
  create: () => new WordleGame(),
};
