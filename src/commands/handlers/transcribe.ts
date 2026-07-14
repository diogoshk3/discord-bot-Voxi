// src/commands/handlers/transcribe.ts — handler de /transcribe (STT, Fase 4).
//
// /transcribe start|stop|revoke. START (Manage-Guild + Premium): des-ensurdece o bot
// (selfDeaf:false — SEM isto não ouve nada), arranca uma TranscriptionSession e posta um
// ANÚNCIO com um botão de consentimento inline (só o próprio carrega, grava stt_consent).
// Consent-first: quem não consentiu nunca é transcrito; quem consente é lembrado para sempre
// nesse servidor. STOP restaura selfDeaf:true e anuncia. Auto-stop quando não resta ninguém
// consentido na call (ou a call esvazia). Sem sidecar Whisper => "indisponível" (inerte).
import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type Message,
} from 'discord.js';
import { getVoiceConnection, type VoiceConnection } from '@discordjs/voice';
import type { BotDeps } from '../../bot/deps';
import { resolveWhisperCmd, DEFAULT_WHISPER_MODEL } from '../../voice/whisperSidecar';
import { WhisperTranscriber, globalSttSemaphore } from '../../voice/whisperTranscriber';
import { TranscriptionSession, makeReceiverCapture } from '../../voice/transcriptionSession';
import { pcmToWavFile } from '../../voice/recorder';
import { hasSttConsent, grantSttConsent, revokeSttConsent } from '../../store/sttConsent';
import { isGuildPremium } from '../../store/premium';
import { evaluateTranscribeStart, shouldAutoStop, resolveTranscribeLang } from '../transcribeGate';
import { sanitizeSpeakerName } from '../../language/speakerName';
import { localeFor, reply } from '../helpers';
import { t } from '../../i18n/index';
import { log } from '../../logging/logger';

interface ActiveSession {
  session: TranscriptionSession;
  transcriber: WhisperTranscriber;
  connection: VoiceConnection;
  /** Canal de voz onde o bot está (para restaurar o selfDeaf ao parar). */
  voiceChannelId: string;
  onSpeaking: (userId: string) => void;
  announceMsg: Message;
  collector: { stop: (reason?: string) => void };
  autoStopTimer: ReturnType<typeof setInterval> | null;
  everConsented: boolean;
  /** Liberta o permit do cap GLOBAL de STT (plano 029) — idempotente, chamar uma ou mais vezes. */
  releaseSttSlot: () => void;
}

// Uma sessão de transcrição por servidor.
const activeSessions = new Map<string, ActiveSession>();
// Guildas com um /transcribe start EM CURSO (reservadas antes do 1.º await, libertadas
// no finally). Sem isto, dois `start` quase simultâneos liam `activeSessions` ANTES de
// `activeSessions.set` correr (só acontece depois do await no anúncio) e ambos passavam
// no gate — duplicava o listener de speaking (transcrição em duplicado + sessão órfã).
const startingGuilds = new Set<string>();

/** Ids dos HUMANOS (não-bots) no canal de voz onde o bot está. */
function humanIdsInVoice(i: ChatInputCommandInteraction, channelId: string): string[] {
  const ch = i.guild?.channels.cache.get(channelId);
  if (!ch || !ch.isVoiceBased()) return [];
  return [...ch.members.values()].filter((m) => !m.user.bot).map((m) => m.id);
}

export async function handleTranscribe(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
): Promise<void> {
  const guildId = i.guildId;
  if (!guildId) {
    await reply(i, t('stt.guildOnly', 'en'));
    return;
  }
  const sub = i.options.getSubcommand();
  const locale = localeFor(deps, guildId);

  if (sub === 'revoke') {
    const had = revokeSttConsent(deps.db, i.user.id, guildId);
    await reply(i, t(had ? 'stt.revoked' : 'stt.revokeNone', locale));
    return;
  }

  if (sub === 'stop') {
    if (!(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false)) {
      await reply(i, t('stt.noManage', locale));
      return;
    }
    const stopped = await stopSession(guildId, deps, locale, 'command');
    await reply(i, t(stopped ? 'stt.stopped' : 'stt.notRunning', locale));
    return;
  }

  // sub === 'start'
  const cmd = resolveWhisperCmd(process.env.WHISPER_MODEL || DEFAULT_WHISPER_MODEL);
  const connection = getVoiceConnection(guildId) ?? null;
  const verdict = evaluateTranscribeStart({
    canManage: i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
    isPremium: isGuildPremium(deps.db, guildId, Date.now()),
    sidecarAvailable: cmd !== null,
    botInVoice: connection !== null,
    alreadyRunning: activeSessions.has(guildId) || startingGuilds.has(guildId),
    // Peek SEM reservar (síncrono, sem IO — evaluateTranscribeStart tem de ficar puro).
    // A reserva a sério (tryAcquire) só acontece depois de o gate dizer 'ok', mais abaixo.
    atCapacity: globalSttSemaphore.available <= 0,
  });
  if (verdict !== 'ok') {
    const key = {
      noManage: 'stt.noManage',
      notPremium: 'stt.notPremium',
      unavailable: 'stt.unavailable',
      notInVoice: 'stt.notInVoice',
      alreadyRunning: 'stt.alreadyRunning',
      atCapacity: 'stt.atCapacity',
    }[verdict];
    await reply(i, t(key, locale));
    return;
  }
  // Reserva o permit GLOBAL (cap de concorrência STT, plano 029/ABUSE-01) e a guild — AMBOS
  // SEM qualquer await pelo meio, tal como o peek acima. `tryAcquire` é síncrono e nunca
  // deveria falhar logo a seguir ao peek (Node é single-threaded, não há await entre os
  // dois); o `if` é só rede de segurança caso isto alguma vez deixe de ser verdade.
  const releaseSttSlot = globalSttSemaphore.tryAcquire();
  if (!releaseSttSlot) {
    await reply(i, t('stt.atCapacity', locale));
    return;
  }
  // Reserva a guild JÁ (antes de qualquer await) — dois /transcribe start quase
  // simultâneos passavam ambos no gate acima e duplicavam listeners (mesmo padrão do
  // guard activeCloneRecordings no clone). O finally cobre TODO early-return abaixo
  // (noChannel, notInVoice) e o caminho feliz — assim que activeSessions.set correr,
  // é essa entrada que passa a bastar como "already running".
  startingGuilds.add(guildId);

  // A partir daqui verdict==='ok' garante cmd e connection não-nulos.
  const conn = connection as VoiceConnection;
  // Estado do rollback de erro (plano 029, parte B/DISCORD-02): cada variável documenta
  // até onde a sessão chegou, para o catch só desfazer o que foi mesmo feito.
  let voiceChannelId: string | null = null;
  let transcriber: WhisperTranscriber | null = null;
  let onSpeaking: ((uid: string) => void) | null = null;
  let undeafened = false;
  // true assim que activeSessions.set() corre — dali em diante stopTranscriptionForGuild
  // passa a ser o ÚNICO dono do teardown (evita o catch abaixo limpar em duplicado).
  let handedOff = false;
  try {
    // Defere JÁ (ephemeral): a partir daqui há IO que pode ser lento/falhar (o anúncio no
    // canal) — sem isto, os 3s da interação estouravam antes de conseguirmos responder.
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = i.channel;
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) {
      await i.editReply(t('stt.noChannel', locale));
      return;
    }

    const vcid = conn.joinConfig.channelId;
    if (!vcid) {
      await i.editReply(t('stt.notInVoice', locale));
      return;
    }
    voiceChannelId = vcid;

    // FORÇA a língua da transcrição: a escolhida em `language:` ganha; senão o locale do
    // servidor (2 letras, ex. 'pt'). A auto-deteção do Whisper em fala real curta transcreve
    // mal (PT sai como checo/sueco); o sidecar cai na auto-deteção se a língua for inválida.
    const lang = resolveTranscribeLang(i.options.getString('language'), locale);
    if (cmd) cmd.args.push('--lang', lang);
    const tr = new WhisperTranscriber(cmd);
    transcriber = tr;
    tr.prewarm();

    // Des-ensurdece o bot SÓ agora (senão o receiver não recebe áudio). selfMute fica
    // FALSE como em todos os outros join/rejoin — um bot self-muted não transmite áudio,
    // o que silenciava o TTS da guild inteira durante a transcrição.
    conn.rejoin({ channelId: voiceChannelId, selfDeaf: false, selfMute: false });
    // Invariante do plano 029: a partir daqui, SE algo falhar, o catch TEM de voltar a
    // ensurdecer — senão o bot fica a ouvir sem sessão registada (DISCORD-02).
    undeafened = true;

    const session = new TranscriptionSession({
      hasConsent: (uid) => hasSttConsent(deps.db, uid, guildId),
      displayName: (uid) => {
        const m = i.guild?.members.cache.get(uid);
        return sanitizeSpeakerName(m?.displayName ?? m?.user.username ?? uid);
      },
      transcribe: (wav) => tr.transcribe(wav),
      post: (text) =>
        channel.send({ content: text, allowedMentions: { parse: [] } }).then(() => {}),
      toWav: (pcm, out) => pcmToWavFile(pcm, out),
      capture: makeReceiverCapture(conn),
    });

    const speakingHandler = (uid: string): void => {
      void session.onSpeakingStart(uid);
    };
    onSpeaking = speakingHandler;
    conn.receiver.speaking.on('start', speakingHandler);

    // Anúncio no canal COM o botão de consentimento inline (transparência + 1-clique na call).
    const consentRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('sttconsent')
        .setLabel(t('stt.consentBtn', locale))
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
    );
    // PODE LANÇAR (SendMessages perdido, rate-limit, falha de rede) — é exatamente o caso
    // que o catch abaixo trata (DISCORD-02: bot fica des-ensurdecido e a ouvir sem sessão).
    const announceMsg = await channel.send({
      content: t('stt.announceStart', locale),
      components: [consentRow],
    });

    const collector = announceMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
    });
    const active: ActiveSession = {
      session,
      transcriber: tr,
      connection: conn,
      voiceChannelId,
      onSpeaking: speakingHandler,
      announceMsg,
      collector,
      autoStopTimer: null,
      everConsented: false,
      releaseSttSlot,
    };
    activeSessions.set(guildId, active);
    handedOff = true;

    collector.on('collect', (btn) => {
      grantSttConsent(deps.db, btn.user.id, guildId, Date.now());
      active.everConsented = true;
      void btn.reply({ content: t('stt.consentThanks', locale), flags: MessageFlags.Ephemeral });
    });

    // Auto-stop: verifica periodicamente se ainda faz sentido continuar (call vazia, ou
    // ninguém consentido resta depois de já ter havido consentimento).
    active.autoStopTimer = setInterval(() => {
      const humans = humanIdsInVoice(i, voiceChannelId!);
      if (
        shouldAutoStop(humans, (uid) => hasSttConsent(deps.db, uid, guildId), active.everConsented)
      ) {
        void stopSession(guildId, deps, locale, 'auto');
      }
    }, 15_000);
    active.autoStopTimer.unref?.();

    await i.editReply(t('stt.started', locale));
  } catch (err) {
    // Teardown de erro (plano 029, parte B/DISCORD-02). Se `handedOff` é false, a sessão
    // NUNCA chegou a `activeSessions` — nem /transcribe stop nem o funil de voice-left
    // (stopTranscriptionForGuild) sabem que ela existe, por isso o cleanup TEM de correr
    // aqui. Invariante garantida: se o bot alguma vez des-ensurdeceu, este catch volta
    // SEMPRE a ensurdecer, mesmo quando o `channel.send` do anúncio falha. O release do
    // permit global fica no `finally` abaixo (cobre também os early-return sem throw).
    log.warn(`[stt] falha ao arrancar sessão (guild ${guildId}):`, err);
    if (!handedOff) {
      if (onSpeaking) {
        try {
          conn.receiver.speaking.off('start', onSpeaking);
        } catch {
          // ligação pode ter morrido entretanto — inofensivo
        }
      }
      if (undeafened && voiceChannelId) {
        try {
          conn.rejoin({ channelId: voiceChannelId, selfDeaf: true, selfMute: false });
        } catch {
          // ligação pode ter morrido entretanto — inofensivo
        }
      }
      transcriber?.dispose();
      // Só reportamos "falhou, desfiz tudo" quando ISSO é verdade. Se `handedOff` já era
      // true aqui, a sessão está registada e viva (o único que pode ter lançado depois
      // disso é o `editReply(stt.started)` final) — mentir "nada está a ser gravado"
      // contradiria a própria invariante de confiança do plano 029/DISCORD-02.
      await i.editReply(t('stt.startFailed', locale)).catch(() => {});
    }
  } finally {
    // Liberta o permit global SE a sessão nunca chegou a `activeSessions` — cobre TANTO
    // os early-return acima (noChannel, notInVoice, sem throw) COMO o catch (channel.send
    // falhou). `releaseSttSlot` é idempotente (Semaphore.makeRelease), por isso mesmo que
    // o catch viesse a chamar-lo também não haveria dupla-libertação (stop 029: nunca
    // deixar o contador ir a negativo/bloquear STT).
    if (!handedOff) releaseSttSlot();
    startingGuilds.delete(guildId);
  }
}

/**
 * Teardown externo: chamado pelo FUNIL de saída de voz (removePlayer) quando o bot
 * sai da call (kick, /leave, saída-por-sozinho) a meio de uma transcrição. Melhor-
 * -esforço e idempotente (no-op se não havia sessão) — NÃO tenta `rejoin` (a ligação
 * já morreu nesse ponto) nem anuncia no canal, ao contrário de stopSession.
 */
export function stopTranscriptionForGuild(guildId: string): void {
  const a = activeSessions.get(guildId);
  if (!a) return;
  activeSessions.delete(guildId);
  a.session.stop();
  try {
    a.connection.receiver.speaking.off('start', a.onSpeaking);
  } catch {
    // ligação pode já ter morrido
  }
  a.collector.stop('voice-left');
  if (a.autoStopTimer) clearInterval(a.autoStopTimer);
  a.transcriber.dispose();
  // Liberta o permit do cap GLOBAL de STT (plano 029) — este é o FUNIL onde TODA sessão
  // registada em `activeSessions` acaba por passar (stop() chama-o também, ver abaixo).
  // Idempotente: mesmo que algo o chamasse duas vezes, não sobre-liberta.
  a.releaseSttSlot();
  a.announceMsg.edit({ components: [] }).catch(() => {});
}

/** Pára a sessão do servidor: restaura selfDeaf, limpa listeners/timers, anuncia. */
async function stopSession(
  guildId: string,
  deps: BotDeps,
  locale: string,
  _reason: 'command' | 'auto',
): Promise<boolean> {
  const a = activeSessions.get(guildId);
  if (!a) return false;
  stopTranscriptionForGuild(guildId);
  // Volta a ensurdecer o bot (deixa de ouvir) — só aqui, porque só aqui a ligação
  // ainda existe (o teardown por saída-de-voz acima NUNCA deve tentar rejoin nela).
  try {
    a.connection.rejoin({ channelId: a.voiceChannelId, selfDeaf: true, selfMute: false });
  } catch {
    // a ligação pode já ter caído
  }
  const ch = a.announceMsg.channel;
  if (ch && ch.isTextBased() && 'send' in ch) {
    await ch.send({ content: t('stt.announceStop', locale) }).catch(() => {});
  }
  log.info(`[stt] sessão parada (guild ${guildId}, ${_reason})`);
  return true;
}
