import type { Game, GameContext, GameDefinition } from './types';
import { pickPrompts } from './content/roulettePrompts';
import { seededIndex } from './util';

/**
 * "Roleta" (Verdade ou Consequência) — o Voxi le UM desafio aleatorio em voz alta e
 * publica-o no canal. Jogo de UM disparo: nao pontua, nao tem rondas nem timers — abre
 * e fecha na hora (por isso liberta o lock imediatamente). Corre-se de novo para outro
 * desafio. onMessage nunca e chamado (a partida termina em start).
 */
class RouletteGame implements Game {
  readonly id = 'roulette';

  async start(ctx: GameContext): Promise<void> {
    const prompts = pickPrompts(ctx.locale);
    const prompt = prompts[seededIndex(ctx.seed, prompts.length)];
    await ctx.send(`${ctx.t('game.roulette.header')}\n> ${prompt}`);
    await ctx.say(prompt);
    ctx.end();
  }

  onMessage(): void {
    /* one-shot: a partida ja terminou em start */
  }
}

export const rouletteDef: GameDefinition = {
  id: 'roulette',
  nameKey: 'game.roulette.name',
  descKey: 'game.roulette.desc',
  needsVoice: true,
  create: () => new RouletteGame(),
};
