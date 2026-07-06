import { Chess } from 'chess.js';
import type { Game, GameContext, GameDefinition, GameMessage } from './types';
import { announceWinner } from './finish';

const IDLE_MS = 300_000; // 5 min — o xadrez pensa-se mais devagar que o Galo (180s)

/** Move solto (SAN "e4"/"Nf3"/"O-O") ou por-coordenadas ("e2e4", com promoção opcional "e7e8q"). */
const RE_COORD = /^[a-h][1-8][a-h][1-8][qrbn]?$/i;
const RE_SAN = /^(o-o-o|o-o|[kqrbn]?[a-h]?[1-8]?x?[a-h][1-8](=[qrbn])?)[+#]?$/i;
const RE_RESIGN = /^(resign|resigns|i resign|desisto|desistir)$/i;

/** Letra do tabuleiro: maiuscula = brancas, minuscula = pretas; ponto = casa vazia. */
function pieceLetter(p: { type: string; color: 'w' | 'b' } | null): string {
  if (!p) return '.';
  return p.color === 'w' ? p.type.toUpperCase() : p.type;
}

/**
 * Xadrez — 2 jogadores: os 2 PRIMEIROS a tentar uma jogada ficam brancas/pretas
 * (brancas comecam, como no Galo). Joga-se escrevendo a jogada em notação algébrica
 * ("e4", "Nf3", "O-O") ou por-coordenadas ("e2e4"); "resign"/"desisto" desiste.
 * Toda a legalidade (xeque, xeque-mate, empate, roque, en passant, promoção) é
 * validada pelo chess.js — não reinventamos regras de xadrez aqui. 💎 Premium.
 */
class ChessGame implements Game {
  readonly id = 'chess';
  private readonly chess = new Chess();
  private whiteId?: string;
  private blackId?: string;
  private readonly names: Record<string, string> = {};
  private over = false;
  private moves = 0;

  async start(ctx: GameContext): Promise<void> {
    await this.sendBoard(ctx, this.render(ctx), ctx.t('game.chess.intro'), true);
    this.armIdle(ctx);
  }

  private armIdle(ctx: GameContext): void {
    const at = ++this.moves;
    ctx.after(IDLE_MS, () => {
      if (at === this.moves && !this.over) {
        this.over = true;
        void ctx.send(ctx.t('game.chess.idle'));
        ctx.end();
      }
    });
  }

  /** Cor do assento de `uid`, ou null se ainda nao tem (espetador ou por atribuir). */
  private colorOf(uid: string): 'w' | 'b' | null {
    if (this.whiteId === uid) return 'w';
    if (this.blackId === uid) return 'b';
    return null;
  }

  onMessage(ctx: GameContext, msg: GameMessage): void {
    if (this.over) return;
    const content = msg.content.trim();
    const isResign = RE_RESIGN.test(content);
    const looksLikeMove = isResign || RE_COORD.test(content) || RE_SAN.test(content);
    if (!looksLikeMove) return; // conversa normal no canal -> ignora, nao e jogada

    this.names[msg.authorId] = msg.authorName;

    // Atribuicao de assentos: 1o a tentar -> brancas; 2o DISTINTO -> pretas; resto = espetador.
    let color = this.colorOf(msg.authorId);
    if (!color) {
      if (!this.whiteId) {
        this.whiteId = msg.authorId;
        color = 'w';
      } else if (!this.blackId && msg.authorId !== this.whiteId) {
        this.blackId = msg.authorId;
        color = 'b';
      } else {
        return; // assentos cheios -> espetador, ignora
      }
    }

    if (color !== this.chess.turn()) {
      void ctx.send(
        ctx.t('game.chess.notYourTurn', { user: msg.authorName, color: this.colorName(ctx, this.chess.turn()) }),
      );
      return;
    }

    if (isResign) {
      this.over = true;
      const winnerId = color === 'w' ? this.blackId : this.whiteId;
      if (winnerId) {
        ctx.award(winnerId, 3);
        void ctx.send(ctx.t('game.chess.resigned', { user: msg.authorName, winner: this.names[winnerId] }));
        announceWinner(ctx, this.names[winnerId]);
      }
      ctx.end();
      return;
    }

    let result: ReturnType<Chess['move']>;
    try {
      result = this.chess.move(content, { strict: false });
    } catch {
      void ctx.send(ctx.t('game.chess.illegalMove', { move: content }));
      return;
    }

    this.armIdle(ctx);

    if (this.chess.isCheckmate()) {
      this.over = true;
      const winnerId = color === 'w' ? this.whiteId! : this.blackId!;
      ctx.award(winnerId, 3);
      void this.sendBoard(
        ctx,
        this.render(ctx),
        ctx.t('game.chess.checkmate', { move: result.san, user: this.names[winnerId] }),
        true,
      );
      announceWinner(ctx, this.names[winnerId]);
      ctx.end();
      return;
    }
    if (this.chess.isDraw()) {
      this.over = true;
      if (this.whiteId) ctx.award(this.whiteId, 1);
      if (this.blackId) ctx.award(this.blackId, 1);
      void this.sendBoard(ctx, this.render(ctx), ctx.t('game.chess.draw', { move: result.san }), true);
      ctx.end();
      return;
    }

    const nextColor = this.chess.turn();
    const checkNote = this.chess.inCheck() ? ` ${ctx.t('game.chess.check')}` : '';
    const turnNote = `${ctx.t('game.chess.turn', {
      move: result.san,
      color: this.colorName(ctx, nextColor),
    })}${checkNote}`;
    void this.sendBoard(ctx, this.render(ctx), turnNote, false);
  }

  private colorName(ctx: GameContext, color: 'w' | 'b'): string {
    return color === 'w' ? ctx.t('game.chess.white') : ctx.t('game.chess.black');
  }

  /** Há emojis do tabuleiro carregados? (basta a casa vazia clara existir.) */
  private hasEmojis(ctx: GameContext): boolean {
    return ctx.emoji('el') !== undefined;
  }

  private render(ctx: GameContext): string {
    const seats = ctx.t('game.chess.seats', {
      white: this.whiteId ? this.names[this.whiteId] : '?',
      black: this.blackId ? this.names[this.blackId] : '?',
    });
    const board = this.hasEmojis(ctx) ? this.renderEmoji(ctx) : this.renderAscii();
    return `${seats}\n${board}`;
  }

  /** Tabuleiro em emojis: peça cburnett sobre casa clara/escura; letras dos ficheiros
   *  em cima (emojis regionais alinham com as colunas), números das filas à direita. */
  private renderEmoji(ctx: GameContext): string {
    const b = this.chess.board();
    const files = '🇦🇧🇨🇩🇪🇫🇬🇭'; // indicadores regionais A–H (largura de emoji => alinham)
    const lines: string[] = [files];
    for (let r = 0; r < 8; r++) {
      let row = '';
      for (let f = 0; f < 8; f++) {
        const sq = (r + f) % 2 === 0 ? 'l' : 'd'; // a8 (r0,f0) é casa CLARA
        const p = b[r][f];
        const name = p ? `${p.color}${p.type}${sq}` : `e${sq}`;
        row += ctx.emoji(name) ?? '';
      }
      lines.push(`${row} ${8 - r}`); // número da fila à direita (texto simples, não precisa alinhar)
    }
    return lines.join('\n');
  }

  /** Fallback ASCII (sem emojis instalados): letras num code block, como antes. */
  private renderAscii(): string {
    const board = this.chess.board();
    const files = 'abcdefgh';
    const lines: string[] = [`  ${files.split('').join(' ')}`];
    for (let rank = 0; rank < 8; rank++) {
      const rankLabel = 8 - rank;
      const row = board[rank].map((p) => pieceLetter(p)).join(' ');
      lines.push(`${rankLabel} ${row} ${rankLabel}`);
    }
    lines.push(`  ${files.split('').join(' ')}`);
    return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
  }

  /**
   * Envia o tabuleiro + uma nota (intro/jogada/fim). Em emojis o tabuleiro tem ~1700
   * chars; se a combinação passar o limite prático do Discord, divide em 2 mensagens.
   * `noteFirst` = a nota vem antes do tabuleiro (intro, xeque-mate) ou depois (jogada).
   */
  private async sendBoard(
    ctx: GameContext,
    board: string,
    note: string,
    noteFirst: boolean,
  ): Promise<void> {
    const combined = noteFirst ? `${note}\n${board}` : `${board}\n${note}`;
    if (combined.length <= 1990) {
      await ctx.send(combined);
      return;
    }
    if (noteFirst) {
      await ctx.send(note);
      await ctx.send(board);
    } else {
      await ctx.send(board);
      await ctx.send(note);
    }
  }
}

export const chessDef: GameDefinition = {
  id: 'chess',
  nameKey: 'game.chess.name',
  descKey: 'game.chess.desc',
  needsVoice: false,
  premium: true,
  create: () => new ChessGame(),
};
