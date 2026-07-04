import { Message } from 'discord.js';
import type { BotDeps } from '../bot/deps';
import { getPlayer, getLimiter } from '../bot/deps';
import { isBlocked } from '../moderation/filter';
import { cleanText } from '../textCleaning/clean';
import { getGuildConfig } from '../store/guildConfig';
import { getBlocklist } from '../store/blocklist';
import { getPronunciations } from '../store/pronunciation';
import { getUserVoice } from '../store/userVoice';
import { isOptedOut } from '../store/optout';
import { isDetectionOn } from '../store/langDetect';
import { prepareSpeech } from './prepareSpeech';
import { recallLang, rememberLang } from '../language/langMemory';
import { log } from '../logging/logger';

/**
 * Anexo e um GIF quando o contentType e image/gif ou o nome do ficheiro termina
 * em .gif. (Os GIFs do picker do Discord chegam como link tenor.com no content —
 * esses sao tratados no cleanText; aqui e so para .gif arrastados como anexo.)
 */
function hasGifAttachment(message: Message): boolean {
  return (
    message.attachments?.some(
      (a) => a.contentType === 'image/gif' || !!a.name?.toLowerCase().endsWith('.gif'),
    ) ?? false
  );
}

export async function handleMessage(message: Message, deps: BotDeps): Promise<void> {
  try {
    if (message.author.bot || !message.guild || !message.guildId) return;
    // Conteudo a falar: o texto da mensagem + "a gif" por cada GIF anexado (para
    // que um .gif arrastado sem texto seja anunciado como "a gif", tal como um
    // link do Tenor no content e). Sem texto e sem GIF -> nada a ler.
    let rawContent = message.content ?? '';
    if (hasGifAttachment(message)) rawContent = rawContent ? `${rawContent} a gif` : 'a gif';
    if (!rawContent) return;

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
    const cleaned = cleanText(rawContent, {
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

    // Personalizacao de palavras e agora so via /config pronunciation (aplicada
    // dentro do prepareSpeech). O texto limpo segue tal e qual como base.
    const personal = cleaned;

    // Expansao de girias EN, pronuncia da guild e escolha de voz(es) — incl. a
    // sintese MISTURADA quando a mensagem junta lingua-base + girias EN conhecidas
    // (a parte non-slang e detetada por si; as girias EN saem em voz inglesa como
    // segmento separado). O `spoken` (falado) e usado para a blocklist.
    const userVoice = getUserVoice(deps.db, message.guildId, message.author.id);
    const auto = isDetectionOn(deps.db, message.guildId, message.author.id);
    // Memoria de lingua (T3.2): recorda a lingua recente do user para desambiguar
    // fragmentos curtos; memoriza a deteccao confiante desta mensagem.
    const recentLang = recallLang(message.guildId, message.author.id);
    const { spoken, req, learnedLang } = prepareSpeech({
      personal,
      pronunciations: getPronunciations(deps.db, message.guildId),
      userVoice,
      available: deps.availableModels,
      guildDefaultVoice: cfg.defaultVoice,
      defaultVoice: deps.config.defaultVoice,
      defaultSpeed: deps.config.defaultSpeed,
      autoDetect: auto,
      recentLang,
    });
    if (learnedLang) rememberLang(message.guildId, message.author.id, learnedLang);

    // blocklist antes de sintetizar (sobre o texto REALMENTE falado)
    const blocklist = getBlocklist(deps.db, message.guildId);
    if (isBlocked(spoken, blocklist)) return;

    // Silêncio de arranque: o bot só começa a falar `messageLeadMs` depois da mensagem
    // (silêncio PREPENDido ao WAV). Configurável (MESSAGE_LEAD_MS); 0 = sem espera.
    if (deps.config.messageLeadMs > 0) req.leadSilenceMs = deps.config.messageLeadMs;

    await player.say(req);
  } catch (err) {
    log.error('[messageHandler] erro', err);
  }
}
