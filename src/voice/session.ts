// src/voice/session.ts
//
// Cria uma sessão de voz (ligação + player) para uma guild/canal. É a FONTE ÚNICA
// desta lógica, partilhada pelo /join (joinUserVoice, a partir de uma interação) e
// pelo autojoin (a partir de uma mensagem) — para não divergirem (ex.: o guard de
// identidade no onIdle, que evita derrubar um player substituto).

import {
  joinVoiceChannel,
  getVoiceConnection,
  type DiscordGatewayAdapterCreator,
} from '@discordjs/voice';
import { GuildVoicePlayer } from './player';
import type { BotDeps } from '../bot/deps';
import { removePlayer } from '../bot/deps';

/**
 * (Re)cria a sessão de voz da guild no canal dado e devolve o player. Substitui
 * qualquer player anterior (removePlayer primeiro). O onIdle é identity-aware: só
 * derruba a sessão se ESTE player ainda for o registado (um /join durante uma
 * reconexão pode ter instalado outro no mesmo slot). NÃO verifica permissões — o
 * chamador é que valida Connect/Speak antes.
 */
export function createVoiceSession(
  deps: BotDeps,
  guildId: string,
  channelId: string,
  adapterCreator: DiscordGatewayAdapterCreator,
): GuildVoicePlayer {
  removePlayer(deps, guildId);
  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator,
    selfDeaf: true,
    selfMute: false,
  });
  const player = new GuildVoicePlayer(
    connection,
    deps.engine,
    deps.config.queueCap,
    deps.config.inactivityMs,
    () => {
      if (deps.players.get(guildId) !== player) return;
      removePlayer(deps, guildId);
      getVoiceConnection(guildId)?.destroy();
    },
  );
  deps.players.set(guildId, player);
  return player;
}
