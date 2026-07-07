// src/ui/theme.ts
//
// Tema visual do Vozen: paleta de marca + fábrica de embeds. Um sítio ÚNICO para as
// cores, para todas as superfícies (comandos, jogos, placares) terem o mesmo aspeto
// em vez de hex soltos espalhados. Mantém-se propositadamente pequeno.

import { EmbedBuilder } from 'discord.js';

/**
 * Paleta de marca. `brand` (blurple) já era a cor intencional do /help e /welcome;
 * as restantes seguem as cores oficiais do Discord (semânticas familiares) + o dourado
 * do Premium. Números hex (ColorResolvable) — o que o EmbedBuilder.setColor espera.
 */
export const COLORS = {
  brand: 0x5865f2, // blurple — primária
  success: 0x57f287, // verde
  warning: 0xfee75c, // amarelo
  danger: 0xed4245, // vermelho
  premium: 0xf1c40f, // dourado — estados Premium ativos
} as const;

export type BrandColor = keyof typeof COLORS;

/**
 * Novo embed já com a cor de marca (ou a variante pedida). Base comum de TODAS as
 * superfícies em embed — mudar a cor aqui muda o bot inteiro.
 */
export function brandEmbed(color: BrandColor = 'brand'): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS[color]);
}

/** Rótulo de posição: medalha para o top 3, `#n` para o resto. Usado em placares. */
export function rankMedal(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
}
