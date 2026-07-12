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
import { isRepetitionSpam } from '../moderation/antispam';
import { metrics } from '../metrics';
import { getVoiceEffect } from '../store/voiceEffect';
import { getClone } from '../store/voiceClone';
import { bumpTalk, getTopSpeakers, type TalkBump } from '../store/talkStats';
import { renderLeaderboard } from '../leaderboard/randomPost';
import { getUserPronunciations, getServerPronunciations } from '../store/pronunciation';
import { getUserVoice } from '../store/userVoice';
import { resolveUserEngine } from '../tts/resolveEngine';
import { isOptedOut } from '../store/optout';
import { prepareSpeech, redactRequest, hasReadableText } from './prepareSpeech';
import { t } from '../i18n/index';
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

/**
 * Feedback VISÍVEL de rate-limit: reage com 🐢 à mensagem que foi limitada. Best-effort —
 * precisa de AddReactions; sem permissão/em falha, ignora-se (nunca parte o handler nem
 * enfileira rejeições). Antes, o drop do rate-limit era 100% silencioso e parecia "o bot
 * não fala"; a reação diz ao utilizador que está a ir depressa demais.
 */
function reactRateLimited(message: Message): void {
  try {
    void Promise.resolve(message.react?.('🐢')).catch(() => {});
  } catch {
    /* best-effort — ignora qualquer erro síncrono */
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
      // Observabilidade do routing dos jogos: uma partida em THREAD só funciona se as
      // mensagens da thread chegarem aqui (channelId == id da thread). Se um dia isto
      // deixar de acontecer, os palpites falhariam em SILÊNCIO — este log torna o
      // caminho visível (confirma que o jogo está a receber input).
      log.info(`[game] mensagem consumida no canal ${message.channelId}`);
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
      message.reference?.messageId != null && message.mentions.repliedUser?.id === me.id;
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

    // rate-limit por user (limiter persistente por guild). Corre AGORA — DEPOIS do guard de
    // texto legível — para que uma mensagem que nunca ia ser falada (emoji/link/vazio) NÃO
    // queime o orçamento e silencie a mensagem legível seguinte (bug antigo: o rate-limit
    // corria antes do cleanText). O drop é VISÍVEL: reação 🐢 + métrica + log info — antes
    // era um `return` silencioso e parecia "o bot não fala".
    const rl = getLimiter(deps, message.guildId, cfg.ratePerMin);
    if (!rl.allow(message.author.id, Date.now())) {
      metrics.inc('messagesRateLimited');
      log.info(`[rate] mensagem de ${message.author.id} saltada (limite ${cfg.ratePerMin}/min)`);
      reactRateLimited(message);
      return;
    }

    // Anti-spam (opt-in por guild, OFF por defeito): não lê mensagens spamadas —
    // repetição massiva de tokens NA mensagem (ex. "POKEBOLAS ×39") OU a MESMA
    // mensagem grande repetida pela mesma pessoa em janela curta. Corre sobre o texto
    // JÁ limpo/truncado; ANTES do lastSpeaker/bumpTalk (uma msg saltada não conta). O
    // tracker de duplicados só existe com o mapa injetado (testes antigos → sem dup).
    if (cfg.antispam) {
      const dup =
        deps.dupTracker?.isDuplicateSpam(message.guildId, message.author.id, cleaned, Date.now()) ??
        false;
      if (isRepetitionSpam(cleaned) || dup) {
        log.info(
          `[antispam] mensagem saltada (guild ${message.guildId}, autor ${message.author.id})`,
        );
        return;
      }
    }

    // Blocklist (buscada uma vez; reutilizada na redação do req mais abaixo).
    const blocklist = getBlocklist(deps.db, message.guildId);
    // Guard de corpo-só-bloqueado: se o CORPO do utilizador, depois de tirar as palavras
    // bloqueadas, fica sem nada legível E não há media, não vale a pena falar — nem sequer
    // anunciar "{nome} disse" (xsaid) para uma mensagem que era só palavra(s) banida(s).
    // (A redação real do que é sintetizado — incl. gírias expandidas — faz-se no req.)
    if (
      blocklist.length > 0 &&
      media.length === 0 &&
      !hasReadableText(redactBlocked(cleaned, blocklist))
    )
      return;

    // Personalizacao de palavras e agora so via /config pronunciation (aplicada
    // dentro do prepareSpeech). O texto limpo segue tal e qual como base.
    const personal = cleaned;

    // Expansao de girias EN, pronuncia da guild e escolha de voz(es) — incl. a
    // sintese MISTURADA quando a mensagem junta lingua-base + girias EN conhecidas
    // (a parte non-slang e detetada por si; as girias EN saem em voz inglesa como
    // segmento separado). A blocklist e aplicada depois, por REDACAO do req.
    const userVoice = getUserVoice(deps.db, message.guildId, message.author.id);
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
    const { req } = prepareSpeech({
      personal,
      // Pronúncias do autor PRIMEIRO (o termo dele ganha) + as do SERVIDOR a seguir.
      pronunciations: [
        ...getUserPronunciations(deps.db, message.author.id),
        ...getServerPronunciations(deps.db, message.guildId),
      ],
      userVoice,
      available: deps.availableModels,
      guildDefaultVoice: cfg.defaultVoice,
      defaultVoice: deps.config.defaultVoice,
      defaultSpeed: deps.config.defaultSpeed,
      media,
      announceSpeaker: announce ? speakerName : undefined,
    });
    // Motor escolhido pelo autor (google default | piper | kokoro | gcloud). O resolver
    // partilhado despromove 'gcloud'->'google' se o Premium não estiver ativo (gate
    // runtime) e (Fase 3) anexa o descritor de orçamento — os DOIS campos (engine +
    // gcloudBudget) são exatamente o que o ResolvedEngine devolve. O PerUserEngineRouter
    // despacha por req.engine.
    const resolvedEngine = resolveUserEngine(
      deps.db,
      message.guildId,
      message.author.id,
      userVoice?.engine,
      Date.now(),
    );
    req.engine = resolvedEngine.engine;
    req.gcloudBudget = resolvedEngine.gcloudBudget;

    // Blocklist: em vez de saltar a mensagem inteira, REDIGE as palavras bloqueadas do
    // texto REALMENTE falado (req.text + segmentos) — o Vozen lê a mensagem SEM dizer
    // essas palavras. Se depois de redigir não sobra nada legível (a mensagem era só
    // palavra(s) bloqueada(s)), não fala. (`blocklist` já foi buscada no guard acima.)
    const redacted = redactRequest(req, blocklist);
    const readable =
      hasReadableText(redacted.text) ||
      (redacted.segments?.some((s) => hasReadableText(s.text)) ?? false);
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
    let talk: TalkBump | null = null;
    try {
      talk = bumpTalk(deps.db, message.guildId, message.author.id, new Date());
    } catch (err) {
      log.warn('[messageHandler] falha a registar tagarela (ignorado)', err);
    }

    // Silêncio de arranque: o bot só começa a falar `messageLeadMs` depois da mensagem
    // (silêncio PREPENDido ao WAV). Configurável (MESSAGE_LEAD_MS); 0 = sem espera.
    if (deps.config.messageLeadMs > 0) outReq.leadSilenceMs = deps.config.messageLeadMs;

    const queued = await player.say(outReq);

    // Streak 🔥 (F1, estilo TikTok): aviso "Dia N" SÓ na 1.ª mensagem de cada dia, do Dia 2
    // em diante (anunciar o Dia 1 de cada pessoa todos os dias seria spam), e só se a fala
    // foi mesmo enfileirada e o toggle está ligado. A menção é VISÍVEL mas NÃO pinga
    // (allowedMentions vazio, igual ao leaderboard) — num servidor movimentado, notificar
    // cada pessoa todos os dias seria chato. Best-effort: um envio falhado (sem permissão de
    // escrita no canal, etc.) NUNCA pode partir a fala.
    if (queued && talk?.firstOfDay && talk.streak >= 2 && cfg.streakAnnounce) {
      try {
        const ch = message.channel;
        if ('send' in ch && typeof (ch as { send?: unknown }).send === 'function') {
          await (ch as { send: (c: unknown) => Promise<unknown> }).send({
            content: t('streak.day', cfg.locale, { user: message.author.id, n: talk.streak }),
            allowedMentions: { parse: [] },
          });
        }
      } catch (err) {
        log.warn('[messageHandler] falha a anunciar streak (ignorado)', err);
      }
    }

    // Leaderboard automático (F2): de vez em quando, o Vozen posta o top de tagarelas no
    // canal do /setup. Ativado por ATIVIDADE (só conta mensagens mesmo lidas, em guilds com
    // canal configurado); o decisor faz o limiar + cooldown + sorteio. As menções são
    // suprimidas (post não-solicitado não deve pingar 10 pessoas). Best-effort: um envio
    // falhado (sem permissão de escrita, etc.) NUNCA pode partir a fala.
    if (queued && cfg.ttsChannelId && deps.leaderboardPoster?.record(message.guildId)) {
      try {
        const rows = getTopSpeakers(deps.db, message.guildId, new Date(), 10);
        const ch = deps.client.channels.cache.get(cfg.ttsChannelId);
        if (
          rows.length > 0 &&
          ch &&
          'send' in ch &&
          typeof (ch as { send?: unknown }).send === 'function'
        ) {
          await (ch as { send: (c: unknown) => Promise<unknown> }).send({
            content: renderLeaderboard(rows, cfg.locale),
            allowedMentions: { parse: [] },
          });
        }
      } catch (err) {
        log.warn('[messageHandler] falha a postar leaderboard automatico (ignorado)', err);
      }
    }
  } catch (err) {
    log.error('[messageHandler] erro', err);
  }
}
