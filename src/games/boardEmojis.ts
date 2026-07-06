// src/games/boardEmojis.ts
//
// Carrega os APPLICATION EMOJIS do tabuleiro de xadrez (26: 12 peças × 2 cores de casa
// + 2 casas vazias) uma vez no arranque, para o render do xadrez desenhar peças a sério
// em vez de letras ASCII. App emojis funcionam em QUALQUER servidor sem Nitro nem slots
// de guild. Best-effort: se o fetch falhar (ou o setup de emojis não tiver corrido), o
// mapa fica vazio e o jogo cai no tabuleiro ASCII — nunca crasha.
//
// Faz upload dos assets com: node tools/upload-chess-emojis.mjs

import type { Client } from 'discord.js';
import { log } from '../logging/logger';

/** Os 26 nomes esperados: {cor}{tipo}{casa} (ex. wpl, bkd) + casas vazias (el, ed). */
export const CHESS_EMOJI_NAMES: readonly string[] = (() => {
  const names: string[] = ['el', 'ed'];
  for (const color of ['w', 'b']) {
    for (const type of ['p', 'n', 'b', 'r', 'q', 'k']) {
      for (const sq of ['l', 'd']) names.push(`${color}${type}${sq}`);
    }
  }
  return names;
})();

/**
 * Preenche `target` (por referência) com nome->markup (`<:wpl:123>`) dos application
 * emojis conhecidos do tabuleiro. Chamar 1x no ClientReady (a `client.application` já
 * está preenchida). Só regista os nomes de tabuleiro — ignora outros app emojis.
 */
export async function loadBoardEmojis(client: Client, target: Record<string, string>): Promise<void> {
  try {
    if (!client.application) return;
    const known = new Set(CHESS_EMOJI_NAMES);
    const coll = await client.application.emojis.fetch();
    let n = 0;
    for (const e of coll.values()) {
      if (e.name && known.has(e.name)) {
        target[e.name] = e.toString();
        n++;
      }
    }
    log.info(`[chess] ${n}/${CHESS_EMOJI_NAMES.length} emojis do tabuleiro carregados${n === 0 ? ' (usa ASCII)' : ''}`);
  } catch (err) {
    log.warn('[chess] falha a carregar emojis do tabuleiro (usa ASCII)', err);
  }
}
