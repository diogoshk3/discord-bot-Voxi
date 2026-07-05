import type { Game, GameContext, GameDefinition, GameMessage } from './types';
import { announceWinner } from './finish';
import { wordsForLocale } from './content/words';
import { normalizeAnswer, seededIndex } from './util';

const MAX_WRONG = 6;
const IDLE_MS = 180_000; // 3 min sem jogadas validas -> termina (nao fica pendurado)
/** Letras aceites (a-z + acentuadas latinas), sobre a forma ja normalizada. */
const LETTER = /^[a-zà-ſ]$/;

/**
 * "Forca" (Hangman) — colaborativo: qualquer um escreve UMA letra; quem revelar a
 * ultima letra (ou acertar a palavra inteira) ganha o ponto. 6 erros e perde-se. Jogo
 * de TEXTO (sem voz), renderizado no canal. A palavra vem do banco na lingua da
 * INTERFACE da guild. Comparacao normalizada (sem acentos) para ser amigavel.
 *
 * O timeout de inatividade re-arma-se a cada jogada valida via um contador (`moves`):
 * o timer captura o valor e so age se `moves` nao mudou — o mesmo padrao de guarda dos
 * jogos de voz, aqui a servir de "sem jogadas ha 3 min -> termina".
 */
class HangmanGame implements Game {
  readonly id = 'hangman';
  private word = '';
  private readonly revealed = new Set<string>();
  private readonly wrong = new Set<string>();
  private over = false;
  private moves = 0;

  async start(ctx: GameContext): Promise<void> {
    const { words } = wordsForLocale(ctx.locale);
    this.word = normalizeAnswer(words[seededIndex(ctx.seed, words.length)] ?? 'computer');
    await ctx.send(this.render(ctx, ctx.t('game.hangman.intro')));
    this.armIdle(ctx);
  }

  private armIdle(ctx: GameContext): void {
    const at = ++this.moves;
    ctx.after(IDLE_MS, () => {
      if (at === this.moves && !this.over) {
        this.over = true;
        void ctx.send(ctx.t('game.hangman.idle', { word: this.word.toUpperCase() }));
        ctx.end();
      }
    });
  }

  onMessage(ctx: GameContext, msg: GameMessage): void {
    if (this.over) return;
    const g = normalizeAnswer(msg.content);
    if (g.length === 0) return;

    // Palpite da PALAVRA inteira: so importa se acertar (nao pune o chat normal).
    if (g.length > 1) {
      if (g === this.word) this.win(ctx, msg);
      return;
    }
    // Uma letra.
    if (!LETTER.test(g)) return;
    if (this.revealed.has(g) || this.wrong.has(g)) return; // ja tentada
    this.armIdle(ctx);
    if (this.word.includes(g)) {
      this.revealed.add(g);
      if ([...this.word].every((ch) => ch === ' ' || this.revealed.has(ch))) {
        this.win(ctx, msg);
        return;
      }
      void ctx.send(this.render(ctx, ctx.t('game.hangman.hit', { user: msg.authorName, letter: g.toUpperCase() })));
    } else {
      this.wrong.add(g);
      if (this.wrong.size >= MAX_WRONG) {
        this.over = true;
        void ctx.send(this.render(ctx, ctx.t('game.hangman.lose', { word: this.word.toUpperCase() })));
        ctx.end();
        return;
      }
      void ctx.send(this.render(ctx, ctx.t('game.hangman.miss', { user: msg.authorName, letter: g.toUpperCase() })));
    }
  }

  private win(ctx: GameContext, msg: GameMessage): void {
    this.over = true;
    for (const ch of this.word) this.revealed.add(ch); // revela tudo no resumo
    ctx.award(msg.authorId, 1);
    void ctx.send(this.render(ctx, ctx.t('game.hangman.win', { user: msg.authorName, word: this.word.toUpperCase() })));
    announceWinner(ctx, msg.authorName);
    ctx.end();
  }

  private render(ctx: GameContext, header: string): string {
    const masked = [...this.word]
      .map((ch) => (ch === ' ' ? '  ' : this.revealed.has(ch) ? ch.toUpperCase() : '_'))
      .join(' ');
    const lives = '❤️'.repeat(MAX_WRONG - this.wrong.size) + '🖤'.repeat(this.wrong.size);
    const wrong = [...this.wrong].join(' ').toUpperCase();
    const wrongLine = wrong ? `\n${ctx.t('game.hangman.wrongLetters', { letters: wrong })}` : '';
    return `${header}\n\`${masked}\`\n${lives}${wrongLine}`;
  }
}

export const hangmanDef: GameDefinition = {
  id: 'hangman',
  nameKey: 'game.hangman.name',
  descKey: 'game.hangman.desc',
  needsVoice: false,
  create: () => new HangmanGame(),
};
