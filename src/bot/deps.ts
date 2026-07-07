import type Database from 'better-sqlite3';
import type { Client } from 'discord.js';
import type { AppConfig } from '../config/index';
import type { TTSEngine } from '../tts/engine';
import { GuildVoicePlayer } from '../voice/player';
import { RateLimiter } from '../moderation/rateLimiter';
import type { AloneWatcher } from '../voice/aloneWatcher';
import type { GameManager } from '../games/manager';
import { log } from '../logging/logger';

export interface BotDeps {
  client: Client;
  db: Database.Database;
  engine: TTSEngine;
  config: AppConfig;
  availableModels: string[];
  players: Map<string, GuildVoicePlayer>;
  limiters: Map<string, { limiter: RateLimiter; perMin: number }>;
  /** Vigia "sozinho na call 5 min" -> sai. Injetado no bootstrap; opcional p/ testes. */
  aloneWatcher?: AloneWatcher;
  /**
   * Último autor que o Vozen leu em VOZ ALTA, por guild (guildId -> userId). Serve ao
   * xsaid para NÃO repetir "{nome} disse" em mensagens SEGUIDAS do mesmo autor. Limpo
   * quando o bot sai (removePlayer) para que ao voltar volte a anunciar. Opcional: sem
   * o mapa (ex. testes antigos) não há supressão (anuncia sempre).
   */
  lastSpeaker?: Map<string, string>;
  /**
   * Gestor dos minijogos (/game). Um jogo ativo por guild. Opcional (testes antigos
   * nao o injetam; sem ele nao ha jogos, so o TTS normal). Ver src/games.
   */
  games?: GameManager;
  /**
   * Há motor de clone de voz REALMENTE disponível nesta instância? Reflete o
   * `CloneEngine.available` (que inclui a AUTO-DETEÇÃO do venv em tools/clone-venv),
   * NÃO apenas o env CLONE_CMD. Sem isto, a UI olhava só para config.cloneCmd e dizia
   * "motor não instalado" mesmo com o venv detetado. Opcional: testes caem no env.
   */
  cloneAvailable?: boolean;
}

export function getPlayer(deps: BotDeps, guildId: string): GuildVoicePlayer | undefined {
  return deps.players.get(guildId);
}

export function removePlayer(
  deps: Pick<BotDeps, 'players' | 'aloneWatcher' | 'lastSpeaker' | 'games'>,
  guildId: string,
): void {
  // Cancela o timer de "sozinho" ANTES de tudo. Este e o FUNIL de todas as saidas
  // (/leave, guildDelete, desistencia-de-reconexao, saida-por-sozinho), por isso
  // limpar aqui garante que um timer armado nunca sobrevive para derrubar uma sessao
  // NOVA instalada entretanto (o bug classico de timer-fantasma).
  deps.aloneWatcher?.clear(guildId);
  // Mesma razao para os JOGOS DE VOZ: se o bot sai da call (ex. AloneWatcher sai
  // imediato quando o canal esvazia) a meio de uma partida de voz, os timers de ronda
  // tem de morrer aqui — senao ficavam vivos a chamar player.say num player destruido.
  // `onVoiceLeft` so termina jogos que PRECISAM de voz: um jogo de tabuleiro (texto)
  // nao deve morrer por uma saida de voz nao relacionada. O teardown total de qualquer
  // jogo (guild removida) vive no handleGuildDelete.
  deps.games?.onVoiceLeft(guildId);
  // Esquece o último locutor: ao voltar à call, o xsaid volta a anunciar quem falou.
  deps.lastSpeaker?.delete(guildId);
  const p = deps.players.get(guildId);
  if (p) {
    p.destroy();
    deps.players.delete(guildId);
  }
}

/**
 * O Vozen saiu (ou perdeu acesso a) uma guild — Events.GuildDelete. Liberta os
 * recursos retidos por guildId para evitar crescimento monotonico de heap em
 * uptime longo com muitas guilds:
 *  - apaga a entrada de `limiters` (e todos os buckets do RateLimiter dentro);
 *  - remove/destroi o player (sai do canal de voz se ainda la estava).
 *
 * Funcao pura/testavel (tal como shutdown): o handler do evento em client.ts so
 * a chama. try/catch para NUNCA crashar o gateway. Idempotente: se a guild ja
 * nao existir, `.delete` e removePlayer sao no-ops.
 */
export function handleGuildDelete(
  deps: Pick<BotDeps, 'players' | 'limiters' | 'aloneWatcher' | 'games'>,
  guildId: string,
): void {
  try {
    deps.limiters.delete(guildId);
    removePlayer(deps, guildId);
    // A guild desapareceu: termina QUALQUER jogo ativo (incl. tabuleiro), que o
    // removePlayer/onVoiceLeft deixaria vivo se nao precisasse de voz — senao a sessao
    // ficava presa no mapa (leak) apos a guild sair.
    deps.games?.endGuild(guildId);
  } catch (err) {
    log.warn('[client] falha ao libertar recursos da guild em guildDelete (ignorado)', err);
  }
}

export function getLimiter(deps: BotDeps, guildId: string, perMin: number): RateLimiter {
  let entry = deps.limiters.get(guildId);
  // Recria o limiter quando o perMin muda (ex.: /config rate-limit em runtime).
  if (!entry || entry.perMin !== perMin) {
    entry = { limiter: new RateLimiter(perMin), perMin };
    deps.limiters.set(guildId, entry);
  }
  return entry.limiter;
}
