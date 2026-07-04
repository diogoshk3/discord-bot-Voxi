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
import { ChannelType, type VoiceBasedChannel } from 'discord.js';
import { GuildVoicePlayer } from './player';
import type { BotDeps } from '../bot/deps';
import { removePlayer } from '../bot/deps';
import { log } from '../logging/logger';

/**
 * STAGE channels: ao entrar num canal de palco, o bot fica como AUDIÊNCIA (suprimido)
 * e não é ouvido. Aqui pedimos para ser ORADOR (setSuppressed(false)); se não houver
 * permissão para isso, pedimos para falar (setRequestToSpeak). Best-effort e
 * fire-and-forget — NUNCA bloqueia nem crasha o join; num canal de voz normal é no-op.
 * NÃO testável em unit (precisa de um stage real do Discord).
 */
export function becomeSpeakerIfStage(channel: VoiceBasedChannel): void {
  if (channel.type !== ChannelType.GuildStageVoice) return;
  const voice = channel.guild?.members?.me?.voice;
  if (!voice) return;
  Promise.resolve(voice.setSuppressed(false)).catch(() => {
    // Sem permissão para se auto-promover -> pede para falar (o moderador aceita).
    Promise.resolve(voice.setRequestToSpeak(true)).catch((err) => {
      log.warn('[voice] não consegui tornar-me orador no stage (ignorado)', err);
    });
  });
}

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
