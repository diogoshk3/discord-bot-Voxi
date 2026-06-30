import { Message } from 'discord.js';
import type { BotDeps } from '../bot/deps';
import { getPlayer, getLimiter } from '../bot/deps';
import { isBlocked } from '../moderation/filter';
import { cleanText } from '../textCleaning/clean';
import { getGuildConfig } from '../store/guildConfig';
import { getBlocklist } from '../store/blocklist';
import { getUserVoice } from '../store/userVoice';
import { resolveSynth } from './resolveSynth';

export async function handleMessage(message: Message, deps: BotDeps): Promise<void> {
  try {
    if (message.author.bot || !message.guild || !message.guildId) return;
    if (!message.content) return;

    const cfg = getGuildConfig(deps.db, message.guildId);
    if (!cfg.enabled) return;

    const isAutoreadChannel = cfg.autoread && cfg.ttsChannelId === message.channelId;
    const isMention = message.mentions.has(deps.client.user!.id, {
      ignoreEveryone: true,
      ignoreRoles: true,
      ignoreRepliedUser: true,
    });
    const isReplyToBot =
      message.reference?.messageId != null &&
      message.mentions.repliedUser?.id === deps.client.user!.id;

    if (!isAutoreadChannel && !isMention && !isReplyToBot) return;

    // gating: jogador ativo nesta guild
    const player = getPlayer(deps, message.guildId);
    if (!player) return;

    // rate-limit por user (limiter persistente por guild)
    const rl = getLimiter(deps, message.guildId, cfg.ratePerMin);
    if (!rl.allow(message.author.id, Date.now())) return;

    // limpeza com caches da guild
    const cleaned = cleanText(message.content, {
      maxChars: cfg.maxChars,
      resolveUser: (id: string) =>
        message.guild!.members.cache.get(id)?.displayName ??
        deps.client.users.cache.get(id)?.username ??
        'alguem',
      resolveChannel: (id: string) => {
        const ch = message.guild!.channels.cache.get(id);
        return ch && 'name' in ch ? (ch.name as string) : 'canal';
      },
    });
    if (!cleaned) return;

    // blocklist antes de sintetizar
    const blocklist = getBlocklist(deps.db, message.guildId);
    if (isBlocked(cleaned, blocklist)) return;

    // escolha de voz: voz do user vence, senao deteta lingua
    const userVoice = getUserVoice(deps.db, message.guildId, message.author.id);
    const req = resolveSynth({
      text: cleaned,
      userVoice,
      available: deps.availableModels,
      defaultVoice: deps.config.defaultVoice,
      defaultSpeed: deps.config.defaultSpeed,
    });

    await player.say(req);
  } catch (err) {
    console.error('[messageHandler] erro', err);
  }
}
