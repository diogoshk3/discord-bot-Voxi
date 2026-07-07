import type { Game, GameContext, GameDefinition, GameMessage } from './types';
import { announceWinner } from './finish';
import { pickWordleWords } from './content/wordleWords';
import { normalizeAnswer, seededIndex } from './util';

const MAX_GUESSES = 8;
const IDLE_MS = 180_000;
// Byte ESC do ANSI (construído, não literal no código-fonte, para não haver bytes de
// controlo crus no ficheiro). Códigos de FUNDO do Discord: 42=verde, 43=amarelo/gold,
// 40=cinza-escuro; texto a preto/branco (30/37) e negrito (1). É assim que o palpite
// vira LETRAS coloridas (como o Wordle real), em vez de quadrados emoji + letras à parte.
const ESC = String.fromCharCode(27);
const SGR = { g: '1;30;42', y: '1;30;43', x: '1;37;40' } as const;

/** Estado de cada célula: verde (certo), amarelo (existe), cinza (ausente). */
type CellState = 'g' | 'y' | 'x';

/**
 * "Termo/Wordle" — colaborativo: qualquer um escreve uma palavra de 5 letras; o Vozen
 * responde com as LETRAS COLORIDAS (verde=certa no sítio, amarelo=existe/sítio errado,
 * cinza=não existe) num bloco ```ansi. Quem acertar a palavra ganha o ponto; {MAX}
 * tentativas partilhadas. Jogo de TEXTO. Só mensagens com EXATAMENTE 5 letras contam.
 */
class WordleGame implements Game {
  readonly id = 'wordle';
  private target = '';
  private guesses = 0;
  private over = false;
  private moves = 0;
  /** Letras JÁ SABIDAS: `present` estão na palavra; `absent` foram descartadas. */
  private readonly present = new Set<string>();
  private readonly absent = new Set<string>();
  /** Histórico de palpites (letras + estados) — para desenhar a grelha completa. */
  private readonly rows: { letters: string; states: CellState[] }[] = [];

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

  /**
   * Estado de cada célula do palpite (regras do Wordle, ciente da contagem de letras
   * repetidas): verde=certo no sítio, amarelo=existe/sítio errado, cinza=ausente.
   */
  private computeStates(guess: string): CellState[] {
    const state: CellState[] = ['x', 'x', 'x', 'x', 'x'];
    const counts = new Map<string, number>();
    for (const ch of this.target) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    for (let i = 0; i < 5; i++) {
      if (guess[i] === this.target[i]) {
        state[i] = 'g';
        counts.set(guess[i], (counts.get(guess[i]) ?? 0) - 1);
      }
    }
    for (let i = 0; i < 5; i++) {
      if (state[i] === 'g') continue;
      const left = counts.get(guess[i]) ?? 0;
      if (left > 0) {
        state[i] = 'y';
        counts.set(guess[i], left - 1);
      }
    }
    return state;
  }

  /** Há tiles do wordle carregados? (basta o cinza 'a' existir.) */
  private hasEmojis(ctx: GameContext): boolean {
    return ctx.emoji('wxa') !== undefined;
  }

  /**
   * Grelha COMPLETA (todos os palpites feitos), cada letra um tile-emoji colorido — o
   * verdadeiro aspeto do Wordle, e funciona no MOBILE (o ANSI não tem cor lá). Devolve
   * null se faltar algum tile (ex. letra fora de a–z) para o chamador cair no ANSI.
   */
  private renderGridEmoji(ctx: GameContext): string | null {
    const lines: string[] = [];
    for (const r of this.rows) {
      let line = '';
      for (let i = 0; i < r.states.length; i++) {
        const e = ctx.emoji(`w${r.states[i]}${r.letters[i].toLowerCase()}`);
        if (!e) return null;
        line += e;
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** Grelha completa em ANSI (fallback sem tiles): células coloridas em code block. */
  private renderGridAnsi(): string {
    const rows = this.rows.map((r) =>
      [...r.letters.toUpperCase()].map((ch, i) => `${ESC}[${SGR[r.states[i]]}m ${ch} ${ESC}[0m`).join(''),
    );
    return '```ansi\n' + rows.join('\n') + '\n```';
  }

  private renderGrid(ctx: GameContext): string {
    return (this.hasEmojis(ctx) ? this.renderGridEmoji(ctx) : null) ?? this.renderGridAnsi();
  }

  /** Regista as letras deste palpite: na palavra (present) ou descartadas (absent). */
  private trackLetters(guess: string): void {
    for (const l of new Set(guess)) {
      if (this.target.includes(l)) this.present.add(l);
      else this.absent.add(l);
    }
  }

  /**
   * "Teclado" de estado sob o palpite: letras JÁ NA palavra (verde) e letras
   * DESCARTADAS (riscadas). Linha vazia ('') enquanto não se sabe nada. Ordenadas.
   */
  private keyboard(ctx: GameContext): string {
    const up = (set: Set<string>): string =>
      [...set].sort().map((c) => c.toUpperCase()).join(' ');
    const parts: string[] = [];
    if (this.present.size) parts.push(ctx.t('game.wordle.inWord', { letters: up(this.present) }));
    if (this.absent.size) parts.push(ctx.t('game.wordle.out', { letters: up(this.absent) }));
    return parts.length ? '\n' + parts.join('   ') : '';
  }

  onMessage(ctx: GameContext, msg: GameMessage): void {
    if (this.over) return;
    const g = normalizeAnswer(msg.content).replace(/[^a-zà-ſ]/g, '');
    if (g.length !== 5) return; // so palpites de 5 letras contam
    this.armIdle(ctx);
    this.guesses++;
    this.rows.push({ letters: g, states: this.computeStates(g) });
    this.trackLetters(g);
    const grid = this.renderGrid(ctx);
    if (g === this.target) {
      this.over = true;
      ctx.award(msg.authorId, 1);
      void ctx.send(
        `${grid}\n${ctx.t('game.wordle.win', { user: msg.authorName, word: this.target.toUpperCase(), n: this.guesses })}`,
      );
      announceWinner(ctx, msg.authorName);
      ctx.end();
      return;
    }
    if (this.guesses >= MAX_GUESSES) {
      this.over = true;
      void ctx.send(`${grid}\n${ctx.t('game.wordle.lose', { word: this.target.toUpperCase() })}`);
      ctx.end();
      return;
    }
    void ctx.send(
      `${grid}\n${ctx.t('game.wordle.guess', { user: msg.authorName, left: MAX_GUESSES - this.guesses })}${this.keyboard(ctx)}`,
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
