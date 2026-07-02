import { Message } from 'discord.js';
import type { BotDeps } from '../bot/deps';
import { getPlayer, getLimiter } from '../bot/deps';
import { isBlocked } from '../moderation/filter';
import { cleanText } from '../textCleaning/clean';
import { getGuildConfig } from '../store/guildConfig';
import { getBlocklist } from '../store/blocklist';
import { getPronunciations } from '../store/pronunciation';
import { getUserAbbrev } from '../store/userAbbrev';
import { getUserVoice } from '../store/userVoice';
import { isOptedOut } from '../store/optout';
import { isDetectionOn } from '../store/langDetect';
import { applyUserAbbrev } from '../textCleaning/userAbbrev';
import { prepareSpeech } from './prepareSpeech';
import { log } from '../logging/logger';

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

    // Gating por role: se a guild definiu um role permitido, so o autor com esse
    // role e lido por auto-leitura (cobre canal, mencao e resposta). Sem role
    // (null) mantem-se o comportamento atual (sem restricao). Membro ausente -> ignora.
    // Nota: aplica-se a /tts? Nao. /tts e uma accao explicita do utilizador (escreve
    // o comando), nao auto-leitura, por isso o gating de role e so para mensagens.
    if (cfg.ttsRoleId) {
      const member = message.member;
      if (!member || !member.roles.cache.has(cfg.ttsRoleId)) return;
    }

    // Opt-out por utilizador: so silencia a leitura PASSIVA do canal de auto-leitura.
    // Uma mencao/reply ao bot e uma accao EXPLICITA do utilizador (como /tts), por isso
    // NAO e bloqueada pelo opt-out — so a leitura automatica do canal e que e.
    if (
      isAutoreadChannel &&
      !isMention &&
      !isReplyToBot &&
      isOptedOut(deps.db, message.guildId, message.author.id)
    ) {
      return;
    }

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
    // Guard de vazio endurecido: exige pelo menos UMA letra ou numero (\p{L}\p{N}).
    // Cobre nao so o vazio '' como qualquer texto que ficou so com pontuacao,
    // simbolos ou residuo zero-width (rede de seguranca para o strip de emoji):
    // nada disso e "legivel", por isso nao vale a pena mandar ao synth (clipe
    // vazio/inutil). Nota: isto passa a ignorar tambem "!!!" (so-pontuacao).
    if (!/[\p{L}\p{N}]/u.test(cleaned)) return;

    // Abreviaturas PESSOAIS do utilizador (globais, chave = author.id): aplicadas
    // PRIMEIRO — precedencia pessoal > embutido. Em qualquer lingua; no-op se o user
    // nao tiver nenhuma.
    const personal = applyUserAbbrev(cleaned, getUserAbbrev(deps.db, message.author.id));

    // Expansao de girias EN, pronuncia da guild e escolha de voz(es) — incl. a
    // sintese MISTURADA quando a mensagem junta lingua-base + girias EN conhecidas
    // (a parte non-slang e detetada por si; as girias EN saem em voz inglesa como
    // segmento separado). O `spoken` (falado) e usado para a blocklist.
    const userVoice = getUserVoice(deps.db, message.guildId, message.author.id);
    const auto = isDetectionOn(deps.db, message.guildId, message.author.id);
    const { spoken, req } = prepareSpeech({
      personal,
      pronunciations: getPronunciations(deps.db, message.guildId),
      userVoice,
      available: deps.availableModels,
      guildDefaultVoice: cfg.defaultVoice,
      defaultVoice: deps.config.defaultVoice,
      defaultSpeed: deps.config.defaultSpeed,
      autoDetect: auto,
    });

    // blocklist antes de sintetizar (sobre o texto REALMENTE falado)
    const blocklist = getBlocklist(deps.db, message.guildId);
    if (isBlocked(spoken, blocklist)) return;

    await player.say(req);
  } catch (err) {
    log.error('[messageHandler] erro', err);
  }
}
