// src/commands/handlers/core.ts — handlers de join/leave/tts/skip/shutup + menu de contexto "Speak" (extraídos de index.ts, plano 015).
import {
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
  GuildMember,
  Guild,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import type { BotDeps } from '../../bot/deps';
import { getPlayer, removePlayer, getLimiter } from '../../bot/deps';
import { createVoiceSession, becomeSpeakerIfStage } from '../../voice/session';
import { getUserVoice } from '../../store/userVoice';
import { resolveUserEngine } from '../../tts/resolveEngine';
import { getGuildConfig } from '../../store/guildConfig';
import { getBlocklist } from '../../store/blocklist';
import { getUserPronunciations, getServerPronunciations } from '../../store/pronunciation';
import { getVoiceEffect } from '../../store/voiceEffect';
import { getClone } from '../../store/voiceClone';
import { forgetVoicePresence } from '../../store/voicePresence';
import { cleanText, collectUrlMedia, collectMarkdownMedia } from '../../textCleaning/clean';
import { prepareSpeech, redactRequest, hasReadableText } from '../prepareSpeech';
import { log } from '../../logging/logger';
import { t } from '../../i18n/index';
import { localeFor, localeForUser, reply } from '../helpers';

/**
 * Resultado (discriminado) de tentar juntar o Vozen ao canal de voz do invocador.
 * NAO contem texto de UI — quem chama e que renderiza a mensagem (via t()), para
 * que uma unica interacao produza uma unica resposta. Isto e o que permite
 * partilhar a logica entre /join (que responde) e /setup (que dobra o resultado
 * no seu checklist), sem arriscar um duplo-reply na mesma interacao.
 */
export type JoinOutcome =
  | { status: 'no-channel' }
  | { status: 'missing-perms'; channelName: string }
  | { status: 'joined'; channelName: string };

/**
 * Logica PARTILHADA de "entrar no canal de voz do invocador", extraida do antigo
 * handleJoin para poder ser reutilizada pelo /setup (onboarding guiado). Efeitos:
 * verifica Connect/Speak, (re)cria o player e a conexao. NAO responde a interacao
 * — devolve um JoinOutcome que o chamador traduz. Contrato preservado:
 *  - sem canal de voz            -> { status: 'no-channel' } (nao mexe no player)
 *  - faltam Connect/Speak        -> { status: 'missing-perms' } (nao destroi o player existente)
 *  - ok                          -> junta-se e devolve { status: 'joined' }
 */
export function joinUserVoice(i: ChatInputCommandInteraction, deps: BotDeps): JoinOutcome {
  const member = i.member as GuildMember;
  const channel = member?.voice?.channel;
  if (!channel) {
    return { status: 'no-channel' };
  }
  // Verificar permissoes Connect/Speak ANTES de tocar no player existente: um
  // /join para um canal proibido nao deve destruir um player que ja funciona.
  const me = deps.client.user;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms || !perms.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
    return { status: 'missing-perms', channelName: channel.name };
  }
  // Cria a sessão via helper partilhado (mesma lógica do autojoin). O guard de
  // identidade no onIdle vive lá.
  createVoiceSession(deps, i.guildId!, channel.id, i.guild!.voiceAdapterCreator);
  becomeSpeakerIfStage(channel); // no-op se não for um canal de palco
  return { status: 'joined', channelName: channel.name };
}

export async function handleJoin(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const outcome = joinUserVoice(i, deps);
  switch (outcome.status) {
    case 'no-channel':
      await reply(i, t('join.needVoiceChannel', locale));
      return;
    case 'missing-perms':
      await reply(i, t('join.missingPerms', locale, { channel: outcome.channelName }));
      return;
    case 'joined':
      // Anúncio PÚBLICO (todos no canal veem que o Vozen entrou, como um bot de TTS
      // faz) — NÃO ephemeral. Na língua da GUILD (localeFor), porque é uma mensagem
      // para toda a gente, não só para quem invocou. Os erros acima ficam ephemeral
      // (são feedback para o invocador). `i.reply` sem flags = mensagem pública.
      await i.reply({
        content: t('join.joined', localeFor(deps, i.guildId), { channel: outcome.channelName }),
      });
      return;
  }
}

export async function handleLeave(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  removePlayer(deps, i.guildId!);
  // 24/7 in-call: saída EXPLÍCITA -> esquece a presença para NÃO repor no arranque
  // (ao contrário de um restart/deploy, que preserva a linha de propósito).
  forgetVoicePresence(deps.db, i.guildId!);
  getVoiceConnection(i.guildId!)?.destroy();
  await reply(i, t('leave.left', localeForUser(deps, i)));
}

/** Resultado (discriminado) de tentar LER um texto em voz alta com a voz do user. */
export type SpeakOutcome =
  | { status: 'no-player' }
  | { status: 'rate-limited' }
  | { status: 'empty' }
  | { status: 'blocked' }
  | { status: 'queued' }
  | { status: 'busy' };

/**
 * Pipeline PARTILHADO "ler `raw` em voz alta com a voz do user", extraído do /tts para
 * ser reutilizado pelo context-menu "Speak". Faz TUDO (gating de player, rate-limit,
 * limpeza, media, gírias/pronúncia, escolha de voz, blocklist, say) MENOS responder à
 * interação — devolve um SpeakOutcome que o chamador traduz. Assim /tts e "Speak"
 * partilham o comportamento sem divergir. EXPORTADO também para o /randomizer (fala o
 * resultado do sorteio com a voz de quem o correu).
 */
export async function speakRawText(
  deps: BotDeps,
  guildId: string,
  userId: string,
  guild: Guild,
  raw: string,
): Promise<SpeakOutcome> {
  const player = getPlayer(deps, guildId);
  if (!player) return { status: 'no-player' };
  const cfg = getGuildConfig(deps.db, guildId);
  const rl = getLimiter(deps, guildId, cfg.ratePerMin);
  if (!rl.allow(userId, Date.now())) return { status: 'rate-limited' };

  const cleaned = cleanText(raw, {
    maxChars: cfg.maxChars,
    resolveUser: (id: string) =>
      guild.members.cache.get(id)?.displayName ??
      deps.client.users.cache.get(id)?.username ??
      'alguem',
    resolveChannel: (id: string) => {
      const ch = guild.channels.cache.get(id);
      return ch && 'name' in ch ? (ch.name as string) : 'canal';
    },
  });
  const media = [...collectUrlMedia(raw), ...collectMarkdownMedia(raw)];
  if (!/[\p{L}\p{N}]/u.test(cleaned) && media.length === 0) return { status: 'empty' };

  const userVoice = getUserVoice(deps.db, guildId, userId);
  const { req } = prepareSpeech({
    personal: cleaned,
    // Pronúncias de quem invocou (/tts e Speak leem com a voz + regras do próprio),
    // seguidas das do SERVIDOR (aplicam-se a todos).
    pronunciations: [
      ...getUserPronunciations(deps.db, userId),
      ...getServerPronunciations(deps.db, guildId),
    ],
    userVoice,
    available: deps.availableModels,
    guildDefaultVoice: cfg.defaultVoice,
    defaultVoice: deps.config.defaultVoice,
    defaultSpeed: deps.config.defaultSpeed,
    media: media.map((kind) => ({ kind })),
  });
  // Motor escolhido pelo user — resolvido pelo gate partilhado (gcloud->google sem
  // Premium; Fase 3 anexa o orçamento). Os dois campos que o resolver devolve são
  // exatamente engine + gcloudBudget do SynthRequest.
  const resolvedEngine = resolveUserEngine(deps.db, guildId, userId, userVoice?.engine, Date.now());
  req.engine = resolvedEngine.engine;
  req.gcloudBudget = resolvedEngine.gcloudBudget;

  // Blocklist: REDIGE as palavras bloqueadas (o Vozen lê o resto sem as dizer). Só devolve
  // 'blocked' se, depois de as remover, não sobrar nada legível (era só palavra bloqueada).
  const blocklist = getBlocklist(deps.db, guildId);
  const redacted = redactRequest(req, blocklist);
  const readable =
    hasReadableText(redacted.text) ||
    (redacted.segments?.some((s) => hasReadableText(s.text)) ?? false);
  if (!readable) return { status: 'blocked' };
  const outReq = redacted;
  outReq.effect = getVoiceEffect(deps.db, guildId, userId); // efeito de voz (premium)
  const cloneRow = getClone(deps.db, userId); // clone de voz (premium)
  if (cloneRow?.enabled) outReq.cloneRef = cloneRow.samplePath;
  if (deps.config.messageLeadMs > 0) outReq.leadSilenceMs = deps.config.messageLeadMs;
  const queued = await player.say(outReq);
  return { status: queued ? 'queued' : 'busy' };
}

/** Traduz um SpeakOutcome na mensagem (ephemeral) a mostrar ao user. */
function speakOutcomeMessage(outcome: SpeakOutcome, locale: string): string {
  switch (outcome.status) {
    case 'no-player':
      return t('tts.notInVoice', locale);
    case 'rate-limited':
      return t('tts.tooFast', locale);
    case 'empty':
      return t('tts.nothingAfterClean', locale);
    case 'blocked':
      return t('tts.blocked', locale);
    case 'busy':
      return t('tts.busy', locale);
    case 'queued':
      return t('tts.queued', locale);
  }
}

export async function handleTts(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  // A sintese pode demorar ate ~15s; defer imediato para nao perder o token (3s).
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const locale = localeForUser(deps, i);
  const raw = i.options.getString('text', true).trim();
  if (!raw) {
    await i.editReply(t('tts.nothingToRead', locale));
    return;
  }
  const outcome = await speakRawText(deps, i.guildId!, i.user.id, i.guild!, raw);
  await i.editReply(speakOutcomeMessage(outcome, locale));
}

/**
 * Context-menu "Speak" (botão direito numa mensagem -> Apps -> Speak): lê essa mensagem
 * em voz alta com a voz de quem clicou. Mesmo pipeline do /tts (speakRawText), mas o
 * texto vem da mensagem-alvo em vez de um argumento.
 */
export async function handleMessageContextMenu(
  i: MessageContextMenuCommandInteraction,
  deps: BotDeps,
): Promise<void> {
  if (i.commandName !== 'Speak') return;
  const locale = localeForUser(deps, i);
  // Ao contrário dos comandos slash (todos protegidos pelo try/catch de
  // handleInteraction), o context-menu é despachado direto em client.ts com
  // `void handleMessageContextMenu(...)` — SEM catch. Sem este try/catch, um throw
  // no speakRawText deixava o utilizador preso em "Vozen is thinking…" para sempre
  // (o deferReply nunca era editado) + unhandledRejection. Espelha o catch do slash.
  try {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (!i.guildId || !i.guild) {
      await i.editReply(t('error.generic', locale));
      return;
    }
    const raw = (i.targetMessage.content ?? '').trim();
    if (!raw) {
      await i.editReply(t('speak.emptyMessage', locale));
      return;
    }
    const outcome = await speakRawText(deps, i.guildId, i.user.id, i.guild, raw);
    await i.editReply(speakOutcomeMessage(outcome, locale));
  } catch (err) {
    log.error('[speak] erro no context-menu Speak:', err);
    if (!i.isRepliable()) return;
    const msg = t('error.generic', locale);
    if (i.deferred && !i.replied) {
      await i.editReply({ content: msg }).catch(() => {});
    } else if (!i.replied) {
      await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

export async function handleSkip(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await reply(i, t('skip.notInVoice', locale));
    return;
  }
  // Ha player, mas pode estar parado (nada a tocar nem na fila). Ler isActive()
  // ANTES de skip() — skip() faria stop()/emit(Idle) e distorceria o estado — para
  // nao fingir que saltou algo quando nao havia nada. skip.notInVoice cobre o
  // "sem player de todo"; skip.nothing cobre "ha player mas esta parado".
  if (!player.isActive()) {
    await reply(i, t('skip.nothing', locale));
    return;
  }
  player.skip();
  await reply(i, t('skip.skipped', locale));
}

/** /shutup — cala o Vozen já: esvazia a fila e pára o que está a tocar (fica na call). */
export async function handleShutup(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await reply(i, t('shutup.notInVoice', locale));
    return;
  }
  // Ler isActive() ANTES de silence() (silence faz stop()/emit(Idle) e distorceria o
  // estado): distingue "não havia nada a falar" de "calei mesmo".
  if (!player.isActive()) {
    await reply(i, t('shutup.nothing', locale));
    return;
  }
  player.silence();
  await reply(i, t('shutup.done', locale));
}
