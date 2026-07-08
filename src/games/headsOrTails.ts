import type { Game, GameContext, GameDefinition, GameMessage } from './types';
import { bump, sendStandings, type Tally } from './finish';
import { makeRng } from './util';

const ROUNDS = 5;
const GUESS_WINDOW_MS = 8_000; // tempo para escrever heads/tails depois do anúncio

// Palavras aceites como palpite (minúsculas). Multilingue à séria seria via i18n,
// mas os sinónimos base cobrem os servidores reais sem complicar o parsing.
const HEADS_WORDS = new Set(['heads', 'head', 'h', 'cara', 'cabeça', 'cabeca']);
const TAILS_WORDS = new Set(['tails', 'tail', 't', 'coroa', 'cruz']);

type Side = 'heads' | 'tails';

/**
 * "Heads or Tails" — o Vozen anuncia a ronda, cada jogador escreve `heads` ou `tails`
 * (1 palpite por ronda; o primeiro conta), e ao fim da janela o Vozen atira a moeda e
 * DIZ o resultado em voz alta. Quem acertou ganha 1 ponto. 5 rondas, placar no fim.
 * Segue o padrão do Reflexos: `my` captura o nº da ronda para os timers não agirem
 * numa ronda já avançada.
 */
class HeadsOrTailsGame implements Game {
  readonly id = 'headsOrTails';
  private round = 0;
  private open = false;
  private guesses = new Map<string, { side: Side; name: string }>();
  private rng: () => number = () => 0;
  private readonly tally: Tally = new Map();

  async start(ctx: GameContext): Promise<void> {
    this.rng = makeRng(ctx.seed);
    await ctx.send(ctx.t('game.headsOrTails.intro', { rounds: ROUNDS }));
    void ctx.say(ctx.t('game.headsOrTails.introVoice'));
    this.nextRound(ctx);
  }

  private nextRound(ctx: GameContext): void {
    if (this.round >= ROUNDS) {
      void this.finish(ctx);
      return;
    }
    this.round++;
    this.open = true;
    this.guesses = new Map();
    const my = this.round;
    void ctx.send(ctx.t('game.headsOrTails.round', { n: this.round, total: ROUNDS }));
    void ctx.say(ctx.t('game.headsOrTails.roundVoice'));
    ctx.after(GUESS_WINDOW_MS, () => {
      if (this.round !== my || !this.open) return;
      this.open = false;
      this.reveal(ctx);
    });
  }

  private reveal(ctx: GameContext): void {
    const flip: Side = this.rng() % 2 === 0 ? 'heads' : 'tails';
    const flipName = ctx.t(`game.headsOrTails.${flip}`);
    void ctx.say(ctx.t('game.headsOrTails.resultVoice', { side: flipName }));
    const winners: string[] = [];
    for (const [userId, g] of this.guesses) {
      if (g.side === flip) {
        ctx.award(userId, 1);
        bump(this.tally, userId, g.name, 1);
        winners.push(g.name);
      }
    }
    const line =
      winners.length > 0
        ? ctx.t('game.headsOrTails.winners', { side: flipName, users: winners.join(', ') })
        : ctx.t('game.headsOrTails.noWinners', { side: flipName });
    void ctx.send(`🪙 ${line}`);
    // Pausa curta entre rondas para a fala não atropelar o anúncio seguinte.
    ctx.after(2_500, () => this.nextRound(ctx));
  }

  onMessage(ctx: GameContext, msg: GameMessage): void {
    if (!this.open) return;
    const w = msg.content.trim().toLowerCase();
    const side: Side | null = HEADS_WORDS.has(w) ? 'heads' : TAILS_WORDS.has(w) ? 'tails' : null;
    if (!side) return; // conversa normal no canal — ignora
    if (this.guesses.has(msg.authorId)) return; // 1 palpite por ronda (o primeiro conta)
    this.guesses.set(msg.authorId, { side, name: msg.authorName });
  }

  private async finish(ctx: GameContext): Promise<void> {
    await sendStandings(ctx, this.tally);
    ctx.end();
  }
}

export const headsOrTailsDef: GameDefinition = {
  id: 'headsOrTails',
  nameKey: 'game.headsOrTails.name',
  descKey: 'game.headsOrTails.desc',
  needsVoice: true,
  create: () => new HeadsOrTailsGame(),
};
