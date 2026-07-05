import type { Game, GameContext, GameDefinition, GameMessage } from './types';
import { firstInteger } from './util';

const IDLE_MS = 180_000;
type Mark = 'X' | 'O';
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // linhas
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // colunas
  [0, 4, 8], [2, 4, 6], // diagonais
];

/**
 * "Galo" (tic-tac-toe) — 2 jogadores: os 2 PRIMEIROS a jogar ficam X e O (X comeca).
 * Joga-se escrevendo o numero da casa (1-9). O vencedor ganha 1 ponto; empate nao
 * pontua. Jogo de TEXTO, tabuleiro renderizado num bloco de codigo. So numeros 1-9 de
 * quem esta em jogo, na sua vez, contam.
 */
class TicTacToeGame implements Game {
  readonly id = 'tictactoe';
  private readonly cells: ('' | Mark)[] = ['', '', '', '', '', '', '', '', ''];
  private xId?: string;
  private oId?: string;
  private readonly names: Record<string, string> = {};
  private turn: Mark = 'X';
  private over = false;
  private moves = 0;

  async start(ctx: GameContext): Promise<void> {
    await ctx.send(`${ctx.t('game.tictactoe.intro')}\n${this.render()}`);
    this.armIdle(ctx);
  }

  private armIdle(ctx: GameContext): void {
    const at = ++this.moves;
    ctx.after(IDLE_MS, () => {
      if (at === this.moves && !this.over) {
        this.over = true;
        void ctx.send(ctx.t('game.tictactoe.idle'));
        ctx.end();
      }
    });
  }

  private markOf(uid: string): Mark | null {
    if (this.xId === uid) return 'X';
    if (this.oId === uid) return 'O';
    return null;
  }

  onMessage(ctx: GameContext, msg: GameMessage): void {
    if (this.over) return;
    const n = firstInteger(msg.content);
    if (n === null || n < 1 || n > 9) return; // so jogadas 1-9 contam
    this.names[msg.authorId] = msg.authorName;

    // Atribuicao de assentos: 1o jogador -> X; 2o jogador DISTINTO -> O; restantes = espetadores.
    let mark = this.markOf(msg.authorId);
    if (!mark) {
      if (!this.xId) {
        this.xId = msg.authorId;
        mark = 'X';
      } else if (!this.oId && msg.authorId !== this.xId) {
        this.oId = msg.authorId;
        mark = 'O';
      } else {
        return; // lugares cheios -> espetador, ignora
      }
    }

    if (mark !== this.turn) {
      void ctx.send(ctx.t('game.tictactoe.notYourTurn', { user: msg.authorName, mark: this.turn }));
      return;
    }
    const idx = n - 1;
    if (this.cells[idx] !== '') {
      void ctx.send(ctx.t('game.tictactoe.taken', { cell: n }));
      return;
    }
    this.armIdle(ctx);
    this.cells[idx] = mark;

    const winLine = LINES.find((l) => l.every((i) => this.cells[i] === mark));
    if (winLine) {
      this.over = true;
      const uid = mark === 'X' ? this.xId! : this.oId!;
      ctx.award(uid, 1);
      void ctx.send(`${ctx.t('game.tictactoe.win', { user: this.names[uid], mark })}\n${this.render()}`);
      ctx.end();
      return;
    }
    if (this.cells.every((c) => c !== '')) {
      this.over = true;
      void ctx.send(`${ctx.t('game.tictactoe.draw')}\n${this.render()}`);
      ctx.end();
      return;
    }
    this.turn = mark === 'X' ? 'O' : 'X';
    void ctx.send(`${this.render()}\n${ctx.t('game.tictactoe.turn', { mark: this.turn })}`);
  }

  private render(): string {
    const c = (i: number): string => this.cells[i] || String(i + 1);
    return (
      '```\n' +
      ` ${c(0)} │ ${c(1)} │ ${c(2)}\n` +
      '───┼───┼───\n' +
      ` ${c(3)} │ ${c(4)} │ ${c(5)}\n` +
      '───┼───┼───\n' +
      ` ${c(6)} │ ${c(7)} │ ${c(8)}\n` +
      '```'
    );
  }
}

export const tictactoeDef: GameDefinition = {
  id: 'tictactoe',
  nameKey: 'game.tictactoe.name',
  descKey: 'game.tictactoe.desc',
  needsVoice: false,
  create: () => new TicTacToeGame(),
};
