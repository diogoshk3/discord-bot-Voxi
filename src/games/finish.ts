import type { GameContext } from './types';

/** Placar local de uma partida: userId -> nome + pontos. */
export type Tally = Map<string, { name: string; points: number }>;

/** Soma `points` (default 1) a `userId` no placar local, atualizando o nome mostrado. */
export function bump(tally: Tally, userId: string, name: string, points = 1): void {
  const entry = tally.get(userId) ?? { name, points: 0 };
  entry.points += points;
  entry.name = name;
  tally.set(userId, entry);
}

/**
 * Envia o resumo final partilhado (game.finish.*) ordenado por pontos desc. Usado
 * pelos jogos que NAO assentam no QuizGame (Reflexos, Voxi Diz). Sem pontos ->
 * mensagem "ninguem pontuou".
 */
export async function sendStandings(ctx: GameContext, tally: Tally): Promise<void> {
  const ranked = [...tally.values()].sort((a, b) => b.points - a.points);
  if (ranked.length === 0) {
    await ctx.send(ctx.t('game.finish.noScores'));
    return;
  }
  const lines = ranked.map((r, i) =>
    ctx.t('game.finish.line', { rank: i + 1, user: r.name, points: r.points }),
  );
  await ctx.send(`${ctx.t('game.finish.title')}\n${lines.join('\n')}`);
}
