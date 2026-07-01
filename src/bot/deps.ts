import type Database from 'better-sqlite3';
import type { Client } from 'discord.js';
import type { AppConfig } from '../config/index';
import type { TTSEngine } from '../tts/engine';
import { GuildVoicePlayer } from '../voice/player';
import { RateLimiter } from '../moderation/rateLimiter';
import { log } from '../logging/logger';

export interface BotDeps {
  client: Client;
  db: Database.Database;
  engine: TTSEngine;
  config: AppConfig;
  availableModels: string[];
  players: Map<string, GuildVoicePlayer>;
  limiters: Map<string, { limiter: RateLimiter; perMin: number }>;
}

export function getPlayer(deps: BotDeps, guildId: string): GuildVoicePlayer | undefined {
  return deps.players.get(guildId);
}

export function removePlayer(deps: Pick<BotDeps, 'players'>, guildId: string): void {
  const p = deps.players.get(guildId);
  if (p) {
    p.destroy();
    deps.players.delete(guildId);
  }
}

/**
 * O Voxi saiu (ou perdeu acesso a) uma guild — Events.GuildDelete. Liberta os
 * recursos retidos por guildId para evitar crescimento monotonico de heap em
 * uptime longo com muitas guilds:
 *  - apaga a entrada de `limiters` (e todos os buckets do RateLimiter dentro);
 *  - remove/destroi o player (sai do canal de voz se ainda la estava).
 *
 * Funcao pura/testavel (tal como shutdown): o handler do evento em client.ts so
 * a chama. try/catch para NUNCA crashar o gateway. Idempotente: se a guild ja
 * nao existir, `.delete` e removePlayer sao no-ops.
 */
export function handleGuildDelete(deps: Pick<BotDeps, 'players' | 'limiters'>, guildId: string): void {
  try {
    deps.limiters.delete(guildId);
    removePlayer(deps, guildId);
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
