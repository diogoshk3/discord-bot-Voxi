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
import { WhisperTranscriber } from '../../voice/whisperTranscriber';
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
}

// Uma sessão de transcrição por servidor.
const activeSessions = new Map<string, ActiveSession>();

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
    alreadyRunning: activeSessions.has(guildId),
  });
  if (verdict !== 'ok') {
    const key = {
      noManage: 'stt.noManage',
      notPremium: 'stt.notPremium',
      unavailable: 'stt.unavailable',
      notInVoice: 'stt.notInVoice',
      alreadyRunning: 'stt.alreadyRunning',
    }[verdict];
    await reply(i, t(key, locale));
    return;
  }
  // A partir daqui verdict==='ok' garante cmd e connection não-nulos.
  const conn = connection as VoiceConnection;
  const channel = i.channel;
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) {
    await reply(i, t('stt.noChannel', locale));
    return;
  }

  const { channelId: voiceChannelId } = conn.joinConfig;
  if (!voiceChannelId) {
    await reply(i, t('stt.notInVoice', locale));
    return;
  }

  // FORÇA a língua da transcrição: a escolhida em `language:` ganha; senão o locale do
  // servidor (2 letras, ex. 'pt'). A auto-deteção do Whisper em fala real curta transcreve
  // mal (PT sai como checo/sueco); o sidecar cai na auto-deteção se a língua for inválida.
  const lang = resolveTranscribeLang(i.options.getString('language'), locale);
  if (cmd) cmd.args.push('--lang', lang);
  const transcriber = new WhisperTranscriber(cmd);
  transcriber.prewarm();

  // Des-ensurdece o bot SÓ agora (senão o receiver não recebe áudio). selfMute mantém-se
  // (o bot não fala pela transcrição). Restaurado no stop.
  conn.rejoin({ channelId: voiceChannelId, selfDeaf: false, selfMute: true });

  const session = new TranscriptionSession({
    hasConsent: (uid) => hasSttConsent(deps.db, uid, guildId),
    displayName: (uid) => {
      const m = i.guild?.members.cache.get(uid);
      return sanitizeSpeakerName(m?.displayName ?? m?.user.username ?? uid);
    },
    transcribe: (wav) => transcriber.transcribe(wav),
    post: (text) => channel.send({ content: text, allowedMentions: { parse: [] } }).then(() => {}),
    toWav: (pcm, out) => pcmToWavFile(pcm, out),
    capture: makeReceiverCapture(conn),
  });

  const onSpeaking = (uid: string): void => {
    void session.onSpeakingStart(uid);
  };
  conn.receiver.speaking.on('start', onSpeaking);

  // Anúncio no canal COM o botão de consentimento inline (transparência + 1-clique na call).
  const consentRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('sttconsent')
      .setLabel(t('stt.consentBtn', locale))
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
  );
  const announceMsg = await channel.send({
    content: t('stt.announceStart', locale),
    components: [consentRow],
  });

  const collector = announceMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
  });
  const active: ActiveSession = {
    session,
    transcriber,
    connection: conn,
    voiceChannelId,
    onSpeaking,
    announceMsg,
    collector,
    autoStopTimer: null,
    everConsented: false,
  };
  activeSessions.set(guildId, active);

  collector.on('collect', (btn) => {
    grantSttConsent(deps.db, btn.user.id, guildId, Date.now());
    active.everConsented = true;
    void btn.reply({ content: t('stt.consentThanks', locale), flags: MessageFlags.Ephemeral });
  });

  // Auto-stop: verifica periodicamente se ainda faz sentido continuar (call vazia, ou
  // ninguém consentido resta depois de já ter havido consentimento).
  active.autoStopTimer = setInterval(() => {
    const humans = humanIdsInVoice(i, voiceChannelId);
    if (
      shouldAutoStop(humans, (uid) => hasSttConsent(deps.db, uid, guildId), active.everConsented)
    ) {
      void stopSession(guildId, deps, locale, 'auto');
    }
  }, 15_000);
  active.autoStopTimer.unref?.();

  await reply(i, t('stt.started', locale));
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
  activeSessions.delete(guildId);
  a.session.stop();
  try {
    a.connection.receiver.speaking.off('start', a.onSpeaking);
  } catch {
    // best-effort
  }
  a.collector.stop('stopped');
  if (a.autoStopTimer) clearInterval(a.autoStopTimer);
  a.transcriber.dispose();
  // Volta a ensurdecer o bot (deixa de ouvir).
  try {
    a.connection.rejoin({ channelId: a.voiceChannelId, selfDeaf: true, selfMute: false });
  } catch {
    // a ligação pode já ter caído
  }
  a.announceMsg.edit({ components: [] }).catch(() => {});
  const ch = a.announceMsg.channel;
  if (ch && ch.isTextBased() && 'send' in ch) {
    await ch.send({ content: t('stt.announceStop', locale) }).catch(() => {});
  }
  log.info(`[stt] sessão parada (guild ${guildId}, ${_reason})`);
  return true;
}
