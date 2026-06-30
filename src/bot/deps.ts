import type Database from 'better-sqlite3';
import type { Client } from 'discord.js';
import type { AppConfig } from '../config/index';
import type { TTSEngine } from '../tts/engine';
import { GuildVoicePlayer } from '../voice/player';
import { RateLimiter } from '../moderation/rateLimiter';

export interface BotDeps {
  client: Client;
  db: Database.Database;
  engine: TTSEngine;
  config: AppConfig;
  availableModels: string[];
  players: Map<string, GuildVoicePlayer>;
  limiters: Map<string, RateLimiter>;
}

export function getPlayer(deps: BotDeps, guildId: string): GuildVoicePlayer | undefined {
  return deps.players.get(guildId);
}

export function removePlayer(deps: BotDeps, guildId: string): void {
  const p = deps.players.get(guildId);
  if (p) {
    p.destroy();
    deps.players.delete(guildId);
  }
}

export function getLimiter(deps: BotDeps, guildId: string, perMin: number): RateLimiter {
  let l = deps.limiters.get(guildId);
  if (!l) {
    l = new RateLimiter(perMin);
    deps.limiters.set(guildId, l);
  }
  return l;
}
