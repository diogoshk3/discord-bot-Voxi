import { Message, PermissionFlagsBits } from 'discord.js';
import type { BotDeps } from '../bot/deps';
import { getPlayer, getLimiter } from '../bot/deps';
import { createVoiceSession, becomeSpeakerIfStage } from '../voice/session';
import type { GuildVoicePlayer } from '../voice/player';
import { cleanText, collectUrlMedia, collectMarkdownMedia } from '../textCleaning/clean';
import { mediaFromAttachments, mediaFromStickers } from '../language/attachmentMedia';
import type { MediaItem } from '../language/spokenPhrases';
import { sanitizeSpeakerName } from '../language/speakerName';
import { getNickname } from '../store/nickname';
import { getGuildConfig } from '../store/guildConfig';
import { getBlocklist } from '../store/blocklist';
import { redactBlocked } from '../moderation/filter';
import { getVoiceEffect } from '../store/voiceEffect';
import { getClone } from '../store/voiceClone';
import { bumpTalk } from '../store/talkStats';
import { getPronunciations } from '../store/pronunciation';
import { getUserVoice } from '../store/userVoice';
import { isOptedOut } from '../store/optout';
import { isDetectionOn } from '../store/langDetect';
import { prepareSpeech, redactRequest, hasReadableText } from './prepareSpeech';
import { recallLang, rememberLang } from '../language/langMemory';
import { log } from '../logging/logger';

/**
 * Recolhe a MEDIA a anunciar de uma mensagem: URLs no texto (link/gif, via
 * collectUrlMedia — mesmo RE_URL do cleanText), anexos por tipo (imagem/vídeo/…) e
 * stickers (pelo nome). A ordem é URLs -> anexos -> stickers. `?.values()` funciona
 * tanto para a Collection do discord.js como para o array dos mocks de teste; ausente
 * -> vazio. PURO em relação à `message` (só lê).
 */
function collectMessageMedia(message: Message): MediaItem[] {
  const content = message.content ?? '';
  const urls: MediaItem[] = collectUrlMedia(content).map((kind) => ({ kind }));
  const markdown: MediaItem[] = collectMarkdownMedia(content).map((kind) => ({ kind }));
  const atts = mediaFromAttachments([...(message.attachments?.values() ?? [])]);
  const stickers = mediaFromStickers([...(message.stickers?.values() ?? [])]);
  return [...urls, ...markdown, ...atts, ...stickers];
}

/**
 * Autojoin: quando o Vozen ainda não está numa call e o autor está num canal de voz,
 * entra sozinho nesse canal (se autojoin ON e o bot tiver Connect/Speak). Devolve o
 * player criado, ou undefined se não deu para entrar (autojoin OFF, autor fora de voz,
 * sem permissões). Falha silenciosa via try/catch — nunca crasha o handler.
 */
function maybeAutojoin(
  message: Message,
  deps: BotDeps,
  autojoinOn: boolean,
): GuildVoicePlayer | undefined {
  if (!autojoinOn || !message.guild || !message.guildId) return undefined;
  const channel = message.member?.voice?.channel;
  if (!channel || !channel.isVoiceBased()) return undefined;
  const me = deps.client.user;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms || !perms.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
    return undefined;
  }
  try {
    const player = createVoiceSession(
      deps,
      message.guildId,
      channel.id,
      message.guild.voiceAdapterCreator,
    );
    becomeSpeakerIfStage(channel); // no-op se não for um canal de palco
    return player;
  } catch (err) {
    log.warn('[messageHandler] autojoin falhou (ignorado)', err);
    return undefined;
  }
}

export async function handleMessage(message: Message, deps: BotDeps): Promise<void> {
  try {
    if (!message.guild || !message.guildId) return;
    // Client ainda não READY (client.user null): não há identidade nem sessão de voz
    // — ignora a mensagem. Captura `me` UMA vez (antes usávamos `client.user!` mais
    // abaixo, que contradizia este guard e lançava se chegasse uma mensagem pré-READY).
    const me = deps.client.user;
    if (!me) return;
    // O Vozen NUNCA se lê a si próprio — anti-loop, independentemente do read_bots.
    if (message.author.id === me.id) return;

    // Kill-switch da guild e gate de bots ANTES do hook dos jogos. O kill-switch
    // (/config enabled:off) tem de parar TUDO — incluindo um jogo /game a decorrer
    // (senão continuava a consumir mensagens e a falar). E as mensagens de OUTROS
    // bots/webhooks só devem chegar ao jogo (como palpites) se read_bots estiver ON.
    const cfg = getGuildConfig(deps.db, message.guildId);
    if (!cfg.enabled) return;
    if (message.author.bot && !cfg.readBots) return;

    // Minijogos (/game): se há um jogo ativo NO CANAL desta mensagem, entrega-a ao
    // jogo (um potencial palpite) e NÃO a lê em voz alta — as respostas dos jogadores
    // não são TTS. Colocado ANTES da auto-leitura/rate-limit (mas DEPOIS do kill-switch/
    // read-bots acima): um palpite não deve gastar rate-limit nem exigir canal de
    // auto-leitura configurado. handleMessage devolve true = consumida -> saímos.
    if (
      deps.games?.handleMessage({
        guildId: message.guildId,
        channelId: message.channelId,
        authorId: message.author.id,
        authorName: message.member?.displayName ?? message.author.username ?? 'alguém',
        content: message.content ?? '',
      })
    ) {
      return;
    }

    // Há algo a ler quando há TEXTO ou MEDIA (um .gif/imagem/sticker sem texto também
    // é anunciado). Sem nenhum dos dois -> nada a fazer.
    const media = collectMessageMedia(message);
    if (!message.content && media.length === 0) return;

    const isAutoreadChannel = cfg.autoread && cfg.ttsChannelId === message.channelId;
    const isMention = message.mentions.has(me.id, {
      ignoreEveryone: true,
      ignoreRoles: true,
      ignoreRepliedUser: true,
    });
    const isReplyToBot =
      message.reference?.messageId != null &&
      message.mentions.repliedUser?.id === me.id;
    // text-in-voice: mensagem enviada no chat de texto DENTRO do canal de voz onde o
    // Vozen está agora (o texto do canal de voz tem channelId == id do canal de voz).
    const botVoiceChannelId = message.guild.members?.me?.voice?.channelId ?? null;
    const isTextInVoice =
      cfg.textInVoice && botVoiceChannelId != null && botVoiceChannelId === message.channelId;

    if (!isAutoreadChannel && !isMention && !isReplyToBot && !isTextInVoice) return;

    // Gating por role: se a guild definiu um role permitido, so o autor com esse
    // role e lido por auto-leitura (cobre canal, mencao e resposta). Sem role
    // (null) mantem-se o comportamento atual (sem restricao). Membro ausente -> ignora.
    // Nota: aplica-se a /tts? Nao. /tts e uma accao explicita do utilizador (escreve
    // o comando), nao auto-leitura, por isso o gating de role e so para mensagens.
    if (cfg.ttsRoleId) {
      const member = message.member;
      if (!member || !member.roles.cache.has(cfg.ttsRoleId)) return;
    }

    // Opt-out por utilizador: so silencia a leitura PASSIVA (canal de auto-leitura OU
    // chat-em-voz). Uma mencao/reply ao bot e uma accao EXPLICITA do utilizador (como
    // /tts), por isso NAO e bloqueada pelo opt-out — so a leitura automatica e que e.
    if (
      (isAutoreadChannel || isTextInVoice) &&
      !isMention &&
      !isReplyToBot &&
      isOptedOut(deps.db, message.guildId, message.author.id)
    ) {
      return;
    }

    // gating: jogador ativo nesta guild. Com autojoin ON, se o Vozen ainda não está
    // numa call e o autor está num canal de voz (e o bot tem Connect/Speak), entra
    // sozinho no canal do autor — em vez de exigir um /join manual.
    let player = getPlayer(deps, message.guildId);
    if (!player) {
      player = maybeAutojoin(message, deps, cfg.autojoin);
      if (!player) return;
    }

    // rate-limit por user (limiter persistente por guild)
    const rl = getLimiter(deps, message.guildId, cfg.ratePerMin);
    if (!rl.allow(message.author.id, Date.now())) return;

    // limpeza com caches da guild
    const cleaned = cleanText(message.content ?? '', {
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
    // Guard de vazio endurecido: exige pelo menos UMA letra ou numero (\p{L}\p{N}) no
    // corpo — OU media a anunciar (um gif/imagem/sticker sem texto é falado na mesma).
    // Cobre o vazio '' e texto que ficou só com pontuação/símbolos/residuo zero-width
    // (rede de segurança do strip de emoji): nada disso é "legível". Sem corpo legível
    // E sem media -> não vale sintetizar.
    if (!/[\p{L}\p{N}]/u.test(cleaned) && media.length === 0) return;

    // Blocklist (buscada uma vez; reutilizada na redação do req mais abaixo).
    const blocklist = getBlocklist(deps.db, message.guildId);
    // Guard de corpo-só-bloqueado: se o CORPO do utilizador, depois de tirar as palavras
    // bloqueadas, fica sem nada legível E não há media, não vale a pena falar — nem sequer
    // anunciar "{nome} disse" (xsaid) para uma mensagem que era só palavra(s) banida(s).
    // (A redação real do que é sintetizado — incl. gírias expandidas — faz-se no req.)
    if (blocklist.length > 0 && media.length === 0 && !hasReadableText(redactBlocked(cleaned, blocklist)))
      return;

    // Personalizacao de palavras e agora so via /config pronunciation (aplicada
    // dentro do prepareSpeech). O texto limpo segue tal e qual como base.
    const personal = cleaned;

    // Expansao de girias EN, pronuncia da guild e escolha de voz(es) — incl. a
    // sintese MISTURADA quando a mensagem junta lingua-base + girias EN conhecidas
    // (a parte non-slang e detetada por si; as girias EN saem em voz inglesa como
    // segmento separado). A blocklist e aplicada depois, por REDACAO do req.
    const userVoice = getUserVoice(deps.db, message.guildId, message.author.id);
    const auto = isDetectionOn(deps.db, message.guildId, message.author.id);
    // Memoria de lingua (T3.2): recorda a lingua recente do user para desambiguar
    // fragmentos curtos; memoriza a deteccao confiante desta mensagem.
    const recentLang = recallLang(message.guildId, message.author.id);
    // xsaid: anuncia "{nome} disse …" antes da mensagem — MAS não repete o nome quando o
    // MESMO autor manda mensagens SEGUIDAS (compara com o último locutor lido nesta guild).
    // A leitura de `lastSpeaker` e a escrita (mais abaixo) ficam no mesmo bloco síncrono
    // (sem await entre elas), por isso não há corrida (evita o bug #99 do concorrente).
    const lastSpeaker = deps.lastSpeaker?.get(message.guildId);
    const announce = cfg.xsaid && lastSpeaker !== message.author.id;
    // Nome a anunciar: apelido fonético (/voice nickname), senão o displayName do
    // servidor, senão o username — sempre SANITIZADO p/ TTS (tira emojis/símbolos).
    // Se nada sobra legível, `speakerName` fica '' e o xsaid não anuncia (sem nome).
    const rawName =
      getNickname(deps.db, message.guildId, message.author.id) ??
      message.member?.displayName ??
      message.author.username ??
      '';
    const speakerName = sanitizeSpeakerName(rawName);
    const { req, learnedLang } = prepareSpeech({
      personal,
      pronunciations: getPronunciations(deps.db, message.guildId),
      userVoice,
      available: deps.availableModels,
      guildDefaultVoice: cfg.defaultVoice,
      defaultVoice: deps.config.defaultVoice,
      defaultSpeed: deps.config.defaultSpeed,
      autoDetect: auto,
      recentLang,
      media,
      announceSpeaker: announce ? speakerName : undefined,
    });
    if (learnedLang) rememberLang(message.guildId, message.author.id, learnedLang);
    // Motor escolhido pelo autor (google default | piper). O PerUserEngineRouter usa isto.
    req.engine = userVoice?.engine;

    // Blocklist: em vez de saltar a mensagem inteira, REDIGE as palavras bloqueadas do
    // texto REALMENTE falado (req.text + segmentos) — o Vozen lê a mensagem SEM dizer
    // essas palavras. Se depois de redigir não sobra nada legível (a mensagem era só
    // palavra(s) bloqueada(s)), não fala. (`blocklist` já foi buscada no guard acima.)
    const redacted = redactRequest(req, blocklist);
    const readable =
      hasReadableText(redacted.text) || (redacted.segments?.some((s) => hasReadableText(s.text)) ?? false);
    if (!readable) return;

    const outReq = redacted;
    // Efeito de voz (premium): aplicado ao WAV pelo EffectEngine (motor externo).
    outReq.effect = getVoiceEffect(deps.db, message.guildId, message.author.id);
    // Clone de voz (premium): se o autor tem clone LIGADO, o CloneEngine sintetiza na
    // voz dele. Sem motor instalado, o engine ignora e serve a voz normal.
    const clone = getClone(deps.db, message.author.id);
    if (clone?.enabled) outReq.cloneRef = clone.samplePath;

    // Passou tudo: esta mensagem VAI ser lida. Regista o autor como último locutor
    // (só agora — uma mensagem bloqueada/ignorada não conta para a supressão do xsaid).
    deps.lastSpeaker?.set(message.guildId, message.author.id);

    // "Tagarelas" (/topspeakers): conta esta mensagem lida + atualiza o streak diário do
    // autor. Só aqui (a mensagem foi mesmo lida). Best-effort — nunca deve impedir a fala.
    try {
      bumpTalk(deps.db, message.guildId, message.author.id, new Date());
    } catch (err) {
      log.warn('[messageHandler] falha a registar tagarela (ignorado)', err);
    }

    // Silêncio de arranque: o bot só começa a falar `messageLeadMs` depois da mensagem
    // (silêncio PREPENDido ao WAV). Configurável (MESSAGE_LEAD_MS); 0 = sem espera.
    if (deps.config.messageLeadMs > 0) outReq.leadSilenceMs = deps.config.messageLeadMs;

    await player.say(outReq);
  } catch (err) {
    log.error('[messageHandler] erro', err);
  }
}
