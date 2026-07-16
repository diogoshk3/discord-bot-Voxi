// src/commands/handlers/voice.ts — /voice handler (set/list/reset/optout/optin/preview/detection/nickname/effect + clone group) extracted from index.ts (plan 015).
import {
  ChatInputCommandInteraction,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  StringSelectMenuBuilder,
  type MessageComponentInteraction,
} from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import type { BotDeps } from '../../bot/deps';
import { getPlayer, getLimiter } from '../../bot/deps';
import { brandEmbed } from '../../ui/theme';
import { getUserVoice, setUserVoice, resetUserVoice, type UserEngine } from '../../store/userVoice';
import {
  seedPanelState,
  localesOf,
  voicesForLocale,
  needsVoiceRow,
  paginateLocales,
  validateSave,
  SPEED_PRESETS,
} from '../voiceConfigPanel';
import { getGuildConfig } from '../../store/guildConfig';
import { setOptOut, setOptIn } from '../../store/optout';
import { setDetection } from '../../store/langDetect';
import { setNickname, clearNickname } from '../../store/nickname';
import { isGuildPremium, isUserPremium } from '../../store/premium';
import { setVoiceEffect } from '../../store/voiceEffect';
import { isVoiceEffect, isPremiumEffect, effectLabel, type VoiceEffect } from '../../tts/effects';
import { sanitizeSpeakerName } from '../../language/speakerName';
import { formatVoiceList, makeLocalizedNamer } from '../../language/voiceMap';
import type { SynthRequest } from '../../tts/engine';
import { resolveUserEngine } from '../../tts/resolveEngine';
import {
  getClone,
  saveClone,
  setCloneEnabled,
  deleteClone,
  deleteClonesByTarget,
} from '../../store/voiceClone';
import { recordUserSample, pcmToWavFile } from '../../voice/recorder';
import { encryptSampleFileInPlace } from '../../tts/cloneSampleFile';
import { join, dirname } from 'node:path';
import { unlinkSync } from 'node:fs';
import { purgeCloneDerivedAudio } from '../../tts/cache';
import { log } from '../../logging/logger';
import { t } from '../../i18n/index';
import { localeFor, localeForUser, reply } from '../helpers';

// Users with a /voice clone record IN PROGRESS. Real BUG discovered
// (audit): connection.receiver.subscribe(userId, ...) from @discordjs/voice ALWAYS
// returns the SAME shared stream for an already-subscribed userId — two concurrent
// invocations by the SAME user (double-tap, two sessions) shared the audio and
// corrupted each other (the first to finish destroyed the second's stream mid-way).
// This guard blocks the 2nd invocation with a clear message instead of letting the two
// recordings step on each other. ALWAYS cleared in the 1st one's finally (success, "too short" or error).
const activeCloneRecordings = new Set<string>();

/**
 * /voice clone record|use|status|delete — clone of one's OWN voice, consent-first:
 *   - record: records ONLY the invoker's audio (per-user receiver) during ~15s of speech;
 *     the command itself is the consent (recorded with a timestamp). The bot lives
 *     deafened and only "uncovers its ears" during the recording window.
 *   - use: toggles reading of one's OWN messages with the clone (nobody else
 *     can use someone else's clone). Without an installed engine (config.cloneCmd), the
 *     toggle is saved but warns that synthesis is not active yet.
 *   - delete: deletes sample + record, leaving no trace.
 * record/use are 💎 Premium (own Plus OR the server's Premium).
 */
async function handleVoiceClone(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
  locale: string,
): Promise<void> {
  const sub = i.options.getSubcommand();
  const userId = i.user.id;

  if (sub === 'status') {
    const c = getClone(deps.db, userId);
    if (!c) {
      await reply(i, t('clone.none', locale));
      return;
    }
    // Card: green when the clone is ON, blurple when only recorded.
    const embed = brandEmbed(c.enabled ? 'success' : 'brand').setDescription(
      t('clone.status', locale, {
        date: `<t:${Math.floor(c.consentAt / 1000)}:D>`,
        state: c.enabled ? t('clone.stateOn', locale) : t('clone.stateOff', locale),
      }),
    );
    await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'delete') {
    // Deletes MY clone (I am the owner) AND revokes any clone made from MY voice
    // by someone else (I am the target) — the recorded person can always withdraw consent.
    const ownPath = deleteClone(deps.db, userId);
    const revoked = deleteClonesByTarget(deps.db, userId);
    for (const p of [ownPath, ...revoked.map((r) => r.samplePath)]) {
      if (!p) continue;
      try {
        unlinkSync(p);
      } catch {
        // file already removed — the record is what matters
      }
    }
    if (!ownPath && revoked.length === 0) {
      await reply(i, t('clone.none', locale));
      return;
    }
    // "No trace": besides the sample and the record, purges the generated cloned AUDIO cache
    // (audio-cache/clone/ AND audio-cache/fx/ — the EffectEngine wraps the CloneEngine, so
    // clone+effect audio ends up in the 'fx' namespace). The keys are irreversible hashes,
    // so we cannot delete only this voice's entries, hence we clear the whole namespaces. It is
    // regenerable and the clone is the only feature that records someone's real voice — the right to
    // erasure (GDPR) requires leaving no derived audio behind.
    purgeCloneDerivedAudio(join(dirname(deps.config.dbPath), 'audio-cache'));
    const parts: string[] = [];
    if (ownPath) parts.push(t('clone.deleted', locale));
    if (revoked.length) parts.push(t('clone.revoked', locale, { count: revoked.length }));
    await reply(i, parts.join('\n'));
    return;
  }

  // record and use require Premium (the canonical example of "extras that cost compute").
  const now = Date.now();
  const premium = isUserPremium(deps.db, userId, now) || isGuildPremium(deps.db, i.guildId!, now);
  if (!premium) {
    await reply(i, t('clone.locked', locale));
    return;
  }

  if (sub === 'use') {
    const on = i.options.getBoolean('active', true);
    const ok = setCloneEnabled(deps.db, userId, on);
    if (!ok) {
      await reply(i, t('clone.noSample', locale));
      return;
    }
    // REAL engine availability (includes the auto-detected venv), not just the CLONE_CMD env —
    // otherwise we'd say "engine not installed" with the sidecar detected and the clone working.
    const engineAvailable = deps.cloneAvailable ?? !!deps.config.cloneCmd;
    if (on && !engineAvailable) {
      await reply(i, t('clone.enabledNoEngine', locale));
      return;
    }
    await reply(i, on ? t('clone.enabled', locale) : t('clone.disabled', locale));
    return;
  }

  // ── record ──
  // Choosable target: by default the invoker themselves (auto-clone, the trivial consent-first
  // case); if `user` is someone else, we record THEIR voice — but only with their explicit
  // consent (button), preserving the invariant "never record third parties silently".
  // The `user` option is STRING+autocomplete (the id of the person in the call); empty = self. If
  // text that is not an id comes through (typed by hand without picking from the list), it asks to pick.
  const rawTarget = i.options.getString('user')?.trim();
  if (rawTarget && !/^\d{5,25}$/.test(rawTarget)) {
    await reply(i, t('clone.pickFromList', locale));
    return;
  }
  const targetId = rawTarget || userId;
  const isSelf = targetId === userId;
  const who = `<@${targetId}>`;
  // Choosable duration: seconds of real SPEECH to capture (5–30, default 15). The wall-clock cap
  // and the acceptable minimum derive from the target, so short samples can still work.
  const seconds = Math.min(30, Math.max(5, i.options.getInteger('seconds') ?? 15));
  const targetVoicedMs = seconds * 1000;
  const maxWallMs = Math.min(90_000, Math.max(30_000, targetVoicedMs * 3));
  const minMs = Math.min(4_000, targetVoicedMs);

  const connection = getVoiceConnection(i.guildId!);
  const botChannelId = i.guild?.members.me?.voice?.channelId ?? null;
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  // Voice-state events already provide the only fact needed here. Avoiding a member
  // fetch lets the bot operate without the privileged GuildMembers gateway intent.
  const targetChannelId = i.guild?.voiceStates.cache.get(targetId)?.channelId ?? null;
  if (!connection || !botChannelId) {
    await i.editReply({ content: t('clone.notInVoice', locale) });
    return;
  }
  if (targetChannelId !== botChannelId) {
    await i.editReply({
      content: isSelf
        ? t('clone.notInVoice', locale)
        : t('clone.targetNotInVoice', locale, { who }),
    });
    return;
  }
  if (activeCloneRecordings.has(targetId)) {
    await i.editReply({ content: t('clone.alreadyRecording', locale) });
    return;
  }
  // Reserve the target NOW (before the 60s consent window), otherwise two people pointing
  // at the same victim would both pass the has() and fire two requests. Released on
  // ALL exits: in the early consent returns and in the recording's finally.
  activeCloneRecordings.add(targetId);

  const { channelId } = connection.joinConfig;

  // CONSENT (only when the target is not the invoker): asks the target for explicit OK with a
  // button on a public message (which also notifies them). Without their "yes", nothing is recorded.
  if (!isSelf) {
    const ch = i.channel;
    if (!ch || !ch.isTextBased() || ch.isDMBased()) {
      activeCloneRecordings.delete(targetId);
      await i.editReply({ content: t('clone.failed', locale) });
      return;
    }
    // The target reads this — use the guild locale (neutral), not the invoker's.
    const gLocale = localeFor(deps, i.guildId);
    const consentRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cloneok:${targetId}`)
        .setLabel(t('clone.consentAllow', gLocale))
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`cloneno:${targetId}`)
        .setLabel(t('clone.consentDeny', gLocale))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️'),
    );
    await i.editReply({ content: t('clone.consentWaiting', locale, { who }) });
    const consentMsg = await ch.send({
      content: t('clone.consentRequest', gLocale, { invoker: `<@${userId}>`, target: seconds }),
      components: [consentRow],
    });
    const granted = await new Promise<boolean>((resolve) => {
      const col = consentMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60_000,
      });
      col.on('collect', (btn) => {
        if (btn.user.id !== targetId) {
          void btn.reply({
            content: t('clone.consentNotYou', gLocale),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const ok = btn.customId.startsWith('cloneok:');
        void btn.update({
          content: t(ok ? 'clone.consentGranted' : 'clone.consentRefused', gLocale, { who }),
          components: [],
        });
        resolve(ok);
        col.stop('answered');
      });
      col.on('end', (_c, reason) => {
        if (reason !== 'answered') resolve(false);
      });
    });
    if (!granted) {
      activeCloneRecordings.delete(targetId);
      await i.editReply({ content: t('clone.consentRefused', locale, { who }) }).catch(() => {});
      await consentMsg.edit({ components: [] }).catch(() => {}); // clear buttons if it was a timeout
      return;
    }
  }

  // Minimal handle (just the .stop() the finally needs) kept OUTSIDE the try, so the
  // finally can stop the collector on ANY exit — including if recordUserSample
  // throws before the normal collector.stop('done'). .stop() is idempotent (calling it again
  // where it already ran does no harm); this just covers the missing exit. Minimal type instead of the
  // real ReturnType (which is a UNION of all possible componentTypes and does not narrow
  // well to the specific Button used here) — same pattern as `ChildLike` in piperPool.ts.
  let collectorHandle: { stop(reason?: string): void } | undefined;
  try {
    // "Stop now" button: besides the auto-stop (SPEECH target or wall-clock cap), both the
    // invoker and the target can end whenever they want.
    const stopBtn = new ButtonBuilder()
      .setCustomId(`clonestop:${targetId}`)
      .setLabel(t('clone.stopBtn', locale))
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⏹️');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(stopBtn);
    // Uncover the ears ONLY for this window (selfDeaf false), recording only the target.
    connection.rejoin({ channelId, selfDeaf: false, selfMute: false });
    const msg = await i.editReply({
      content: isSelf
        ? t('clone.recording', locale, { target: seconds })
        : t('clone.recordingOther', locale, { who, target: seconds }),
      components: [row],
    });

    // Manual stop signal: the button collector sets it; the recorder polls it.
    let stopped = false;
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: maxWallMs + 5_000,
    });
    collectorHandle = collector;
    collector.on('collect', (btn) => {
      if (btn.user.id !== userId && btn.user.id !== targetId) {
        void btn.reply({ content: t('clone.stopNotYours', locale), flags: MessageFlags.Ephemeral });
        return;
      }
      stopped = true;
      void btn.deferUpdate();
      collector.stop('user');
    });

    // Live feedback with throttle (~2.5s) — helps whoever is recording know they need to
    // keep speaking until the target (the #1 cause of samples that are too short).
    let lastEdit = Date.now();
    const { pcm, voicedMs, diag } = await recordUserSample(connection, targetId, {
      targetVoicedMs,
      maxWallMs,
      shouldStop: () => stopped,
      onProgress: (ms) => {
        const now = Date.now();
        if (now - lastEdit < 2_500) return;
        lastEdit = now;
        void i
          .editReply({
            content: t('clone.recordingProgress', locale, {
              got: Math.round(ms / 1000),
              target: seconds,
            }),
            components: [row],
          })
          .catch(() => {});
      },
    });
    collector.stop('done');
    // DIAGNOSTIC of the short-sample cause (real evidence > theory): if framesSeen is
    // high but framesVoiced is low, it is the RMS gate eating the audio (not the user speaking little).
    // rmsMedian vs threshold tells right away if the floor is mis-calibrated for this mic/channel.
    log.info(
      `[clone] diag user=${userId} target=${targetId} voicedMs=${voicedMs} ` +
        `framesSeen=${diag.framesSeen} framesVoiced=${diag.framesVoiced} ` +
        `rms[min/med/max]=${diag.rmsMin}/${diag.rmsMedian}/${diag.rmsMax} ` +
        `threshold=${diag.threshold} rounds=${diag.rounds}`,
    );
    if (voicedMs < minMs) {
      await i.editReply({
        content: t('clone.tooShort', locale, {
          seconds: Math.round(voicedMs / 1000),
          min: Math.round(minMs / 1000),
          target: seconds,
        }),
        components: [],
      });
      return;
    }
    // File VERSIONED by timestamp: a re-recording is a new path -> new cache key
    // (cacheKey includes the ref's basename) -> the old voice is never heard. Deletes the previous
    // sample afterward (the old file is no longer referenced). The clone is ALWAYS the
    // invoker's (it is they who will speak with this voice), even when they recorded someone else's voice.
    const stamp = Date.now();
    const prev = getClone(deps.db, userId);
    const outPath = join(dirname(deps.config.dbPath), 'voice-clones', `${userId}-${stamp}.wav`);
    await pcmToWavFile(pcm, outPath);
    // Encrypts the biometric sample AT REST (ToS §5(c)). No-op without CLONE_KEY (in the clear).
    encryptSampleFileInPlace(outPath, deps.config.cloneKey);
    // targetId = the person whose voice was recorded (the invoker in an auto-clone). It is recorded
    // so that person can revoke the clone with /voice clone delete (Phase 2 compliance).
    saveClone(deps.db, userId, outPath, stamp, targetId);
    if (prev && prev.samplePath !== outPath) {
      try {
        unlinkSync(prev.samplePath);
      } catch {
        // old file already removed — harmless
      }
    }
    await i.editReply({
      content: isSelf
        ? t('clone.saved', locale, { seconds: Math.round(voicedMs / 1000) })
        : t('clone.savedOther', locale, { seconds: Math.round(voicedMs / 1000), who }),
      components: [],
    });
  } catch (err) {
    log.error('[clone] recording failed:', err);
    await i.editReply({ content: t('clone.failed', locale), components: [] }).catch(() => {});
  } finally {
    collectorHandle?.stop('finally');
    // ALWAYS deafen again (privacy by default), no matter what happens.
    try {
      connection.rejoin({ channelId, selfDeaf: true, selfMute: false });
    } catch {
      // the connection may have died in the meantime — harmless
    }
    activeCloneRecordings.delete(targetId);
  }
}

/**
 * /voice config — interactive panel (dropdowns + Save) so the whole voice setup is done
 * with clicks and NOTHING is saved until the user presses Save. This removes the
 * accidental-Enter-mid-configuration problem of a slash command with options. All the
 * testable decisions (state seeding, language pagination, per-locale voices, presets,
 * Save validation) live in the pure `voiceConfigPanel` module; this handler is only the
 * discord.js glue and is verified live in Discord.
 */
async function handleVoiceConfig(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
  locale: string,
): Promise<void> {
  const models = deps.availableModels;
  if (!models.length) {
    await reply(i, t('voice.listEmpty', locale));
    return;
  }
  const localeOf = (m: string): string => {
    const d = m.indexOf('-');
    return d === -1 ? m : m.slice(0, d);
  };
  const cfg = getGuildConfig(deps.db, i.guildId!);
  const defaultModel =
    cfg.defaultVoice || deps.config.defaultVoice || models[0] || 'en_US-amy-medium';
  const state = seedPanelState(getUserVoice(deps.db, i.guildId!, i.user.id), {
    model: models.includes(defaultModel) ? defaultModel : models[0]!,
    speed: deps.config.defaultSpeed,
  });
  // Guard: a saved model that is no longer installed would leave the language select
  // with no matching default — fall back to the first available voice.
  if (!models.includes(state.model)) state.model = models[0]!;

  const langNamer = makeLocalizedNamer(i.locale, models, { voice: false });
  const fullNamer = makeLocalizedNamer(i.locale, models);
  const engineName = (e: UserEngine): string =>
    e === 'piper'
      ? 'Piper'
      : e === 'kokoro'
        ? 'Kokoro'
        : e === 'gcloud'
          ? 'Google HD'
          : t('voice.config.engDefault', locale);

  const locales = localesOf(models);
  const clip = (s: string): string => (s.length > 100 ? s.slice(0, 99) + '…' : s);

  function render(): {
    content: string;
    components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
  } {
    const curLocale = localeOf(state.model);
    const page = paginateLocales(locales, state.langPage);
    // Row 1 — language (24 langs + "More" sentinel when there are more pages).
    const langOptions = page.slice.map((loc) => ({
      label: clip(langNamer(voicesForLocale(models, loc)[0] ?? loc)),
      value: loc,
      default: loc === curLocale,
    }));
    if (page.hasMore)
      langOptions.push({
        label: t('voice.config.more', locale),
        value: '__more__',
        default: false,
      });
    const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`vcfg:lang:${i.id}`)
          .setPlaceholder(t('voice.config.pickLanguage', locale))
          .addOptions(langOptions),
      ),
    ];
    // Row 2 — voice, ONLY when this language has more than one installed voice.
    if (needsVoiceRow(models, curLocale)) {
      rows.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`vcfg:voice:${i.id}`)
            .setPlaceholder(t('voice.config.pickVoice', locale))
            .addOptions(
              voicesForLocale(models, curLocale).map((m) => ({
                label: clip(fullNamer(m)),
                value: m,
                default: m === state.model,
              })),
            ),
        ),
      );
    }
    // Row 3 — engine.
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`vcfg:engine:${i.id}`)
          .setPlaceholder(t('voice.config.pickEngine', locale))
          .addOptions(
            {
              label: t('voice.config.engDefault', locale),
              value: 'google',
              default: state.engine === 'google',
            },
            { label: 'Piper', value: 'piper', default: state.engine === 'piper' },
            { label: 'Kokoro', value: 'kokoro', default: state.engine === 'kokoro' },
            { label: '💎 Google HD', value: 'gcloud', default: state.engine === 'gcloud' },
          ),
      ),
    );
    // Row 4 — speed presets.
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`vcfg:speed:${i.id}`)
          .setPlaceholder(t('voice.config.pickSpeed', locale))
          .addOptions(
            SPEED_PRESETS.map((s) => ({
              label: `${s}×`,
              value: String(s),
              default: s === state.speed,
            })),
          ),
      ),
    );
    // Row 5 — Save / Cancel.
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`vcfg:save:${i.id}`)
          .setLabel(t('voice.config.save', locale))
          .setStyle(ButtonStyle.Success)
          .setEmoji('💾'),
        new ButtonBuilder()
          .setCustomId(`vcfg:cancel:${i.id}`)
          .setLabel(t('voice.config.cancel', locale))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✖️'),
      ),
    );
    const summary = t('voice.config.summary', locale, {
      voice: fullNamer(state.model),
      engine: engineName(state.engine),
      speed: state.speed,
    });
    return { content: `${t('voice.config.title', locale)}\n${summary}`, components: rows };
  }

  await i.reply({ ...render(), flags: MessageFlags.Ephemeral });
  const msg = await i.fetchReply();
  let done = false;
  const collector = msg.createMessageComponentCollector({ time: 120_000 });
  const onCollect = async (ci: MessageComponentInteraction): Promise<void> => {
    // The panel is ephemeral (only the invoker sees it), but guard anyway.
    if (ci.user.id !== i.user.id) {
      await ci.reply({ content: t('clone.stopNotYours', locale), flags: MessageFlags.Ephemeral });
      return;
    }
    if (ci.isButton() && ci.customId === `vcfg:cancel:${i.id}`) {
      done = true;
      await ci.update({ content: t('voice.config.cancelled', locale), components: [] });
      collector.stop('cancelled');
      return;
    }
    if (ci.isButton() && ci.customId === `vcfg:save:${i.id}`) {
      const now = Date.now();
      const premium =
        isUserPremium(deps.db, i.user.id, now) || isGuildPremium(deps.db, i.guildId!, now);
      const check = validateSave(state, { premium });
      if (!check.ok) {
        // Keep the panel open; tell them via a follow-up so they can pick another engine.
        await ci.reply({
          content: t('voice.engine.gcloudLocked', locale),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      setUserVoice(deps.db, i.guildId!, i.user.id, state.model, state.speed, state.engine);
      done = true;
      await ci.update({
        content: t('voice.set', locale, {
          name: fullNamer(state.model),
          model: state.model,
          speed: state.speed,
          engine: engineName(state.engine),
        }),
        components: [],
      });
      collector.stop('saved');
      return;
    }
    if (ci.isStringSelectMenu()) {
      const value = ci.values[0]!;
      if (ci.customId === `vcfg:lang:${i.id}`) {
        if (value === '__more__') {
          state.langPage = paginateLocales(locales, state.langPage).nextPage;
        } else {
          const first = voicesForLocale(models, value)[0];
          if (first) state.model = first; // switch to the language's first voice
        }
      } else if (ci.customId === `vcfg:voice:${i.id}`) {
        state.model = value;
      } else if (ci.customId === `vcfg:engine:${i.id}`) {
        state.engine = value as UserEngine;
      } else if (ci.customId === `vcfg:speed:${i.id}`) {
        state.speed = Number(value);
      }
      await ci.update(render());
    }
  };
  collector.on('collect', (ci) => void onCollect(ci));
  collector.on('end', () => {
    if (done) return;
    void i
      .editReply({ content: t('voice.config.expired', locale), components: [] })
      .catch(() => {});
  });
}

export async function handleVoice(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  // The /voice clone group dispatches to its own handler (getSubcommand() would return the
  // sub INSIDE the group and collide with the top-level names).
  if (i.options.getSubcommandGroup(false) === 'clone') {
    await handleVoiceClone(i, deps, locale);
    return;
  }
  const sub = i.options.getSubcommand();
  if (sub === 'config') {
    await handleVoiceConfig(i, deps, locale);
    return;
  }
  if (sub === 'set') {
    const model = i.options.getString('model', true);
    if (!deps.availableModels.includes(model)) {
      await reply(i, t('voice.unknownModel', locale));
      return;
    }
    // Beginner-friendly range guard: the `speed` builder has NO min/max, so
    // Discord does NOT reject client-side (e.g. speed:5). Previously it did a silent clamp
    // (5 -> 2×) and replied "success" — a silent surprise. It only validates when the
    // value WAS provided (getNumber returns null if omitted) AND it falls OUTSIDE 0.5–2.0;
    // in that case a friendly error with the range and NOTHING saved (rejection, not clamp).
    // Boundaries 0.5 and 2.0 remain valid. Omitted -> falls to defaultSpeed (unchanged).
    const rawSpeed = i.options.getNumber('speed');
    if (rawSpeed !== null && (rawSpeed < 0.5 || rawSpeed > 2.0)) {
      await reply(i, t('voice.badSpeed', locale));
      return;
    }
    const speed = rawSpeed ?? deps.config.defaultSpeed;
    // Clamp preserved: no-op for valid provided values (already in [0.5,2.0]); keeps
    // the old behavior for the omitted->defaultSpeed path.
    const clamped = Math.min(2.0, Math.max(0.5, speed));
    // Per-user engine: new option (google/piper/kokoro/gcloud). If OMITTED, PRESERVES
    // the user's current engine — otherwise changing only the voice would reset the engine to Google (read-first).
    const engineOpt = i.options.getString('engine') as
      'google' | 'piper' | 'kokoro' | 'gcloud' | null;
    const currentEngine = getUserVoice(deps.db, i.guildId!, i.user.id)?.engine ?? 'google';
    const engine = engineOpt ?? currentEngine;
    // Premium GATE: the Google HD engine (gcloud) requires Vozen Plus (user) OR the server's
    // Premium. Only here, when SAVING — at runtime resolveUserEngine revalidates (expired
    // Premium -> gTTS). Same pattern as the premium effects (voice.effect.locked).
    if (engine === 'gcloud') {
      const now = Date.now();
      const unlocked =
        isUserPremium(deps.db, i.user.id, now) || isGuildPremium(deps.db, i.guildId!, now);
      if (!unlocked) {
        await reply(i, t('voice.engine.gcloudLocked', locale));
        return;
      }
    }
    setUserVoice(deps.db, i.guildId!, i.user.id, model, clamped, engine);
    // Beginner-friendly copy: voice name IN THE USER'S LANGUAGE (i.locale) + raw
    // copy-pasteable id. Includes the chosen engine.
    await reply(
      i,
      t('voice.set', locale, {
        name: makeLocalizedNamer(i.locale, deps.availableModels)(model),
        model,
        speed: clamped,
        engine:
          engine === 'piper'
            ? 'Piper'
            : engine === 'kokoro'
              ? 'Kokoro'
              : engine === 'gcloud'
                ? 'Google HD'
                : 'Google',
      }),
    );
  } else if (sub === 'list') {
    // Beginner-friendly: instead of a flat list of Piper ids, groups by language
    // with human names (formatVoiceList). The raw id stays in parentheses so
    // /voice set remains copy-pasteable. Language headers IN THE USER'S
    // LANGUAGE (i.locale); message header i18n.
    const list = deps.availableModels.length
      ? formatVoiceList(deps.availableModels, i.locale)
      : t('voice.listEmpty', locale);
    // Card: fits comfortably in an embed description's 4096 chars (groups by language).
    const embed = brandEmbed().setDescription(`${t('voice.listHeader', locale)}\n${list}`);
    await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } else if (sub === 'reset') {
    resetUserVoice(deps.db, i.guildId!, i.user.id);
    await reply(i, t('voice.reset', locale));
  } else if (sub === 'detection') {
    // Opt-in per (guild,user): ON => the message language is detected and the voice picked
    // per language (the speaker may change); OFF (default) => one fixed voice reads all.
    const active = i.options.getBoolean('active', true);
    setDetection(deps.db, i.guildId!, i.user.id, active);
    await reply(i, active ? t('voice.detection.on', locale) : t('voice.detection.off', locale));
  } else if (sub === 'optout') {
    // Per-user (no admin gate): each person manages their own opt-out of auto-read.
    setOptOut(deps.db, i.guildId!, i.user.id);
    await reply(i, t('voice.optout', locale));
  } else if (sub === 'optin') {
    setOptIn(deps.db, i.guildId!, i.user.id);
    await reply(i, t('voice.optin', locale));
  } else if (sub === 'nickname') {
    // PHONETIC nickname for xsaid. Empty/omitted -> clears (back to the server name).
    const raw = i.options.getString('name');
    if (raw === null || raw.trim() === '') {
      clearNickname(deps.db, i.guildId!, i.user.id);
      await reply(i, t('voice.nickname.cleared', locale));
    } else {
      // Saves ALREADY sanitized (strips emojis/symbols); if nothing legible remains, refuses.
      const clean = sanitizeSpeakerName(raw);
      if (!clean) {
        await reply(i, t('voice.nickname.invalid', locale));
        return;
      }
      setNickname(deps.db, i.guildId!, i.user.id, clean);
      await reply(i, t('voice.nickname.set', locale, { name: clean }));
    }
  } else if (sub === 'effect') {
    const raw = i.options.getString('effect', true);
    const effect: VoiceEffect = isVoiceEffect(raw) ? raw : 'none';
    // Premium GATE: premium effects require Vozen Premium (server) OR Vozen Plus (user).
    // Only here, when SAVING — the player blindly applies whatever is saved.
    if (isPremiumEffect(effect)) {
      const now = Date.now();
      const unlocked =
        isGuildPremium(deps.db, i.guildId!, now) || isUserPremium(deps.db, i.user.id, now);
      if (!unlocked) {
        await reply(i, t('voice.effect.locked', locale, { effect: effectLabel(effect) }));
        return;
      }
    }
    setVoiceEffect(deps.db, i.guildId!, i.user.id, effect);
    await reply(
      i,
      effect === 'none'
        ? t('voice.effect.cleared', locale)
        : t('voice.effect.set', locale, { effect: effectLabel(effect) }),
    );
  } else if (sub === 'preview') {
    const SAMPLE = t('preview.sample', locale);
    const explicitModel = i.options.getString('model');

    // Validates the explicit model BEFORE checking the player.
    if (explicitModel !== null && !deps.availableModels.includes(explicitModel)) {
      await reply(i, t('voice.unknownModel', locale));
      return;
    }

    const player = getPlayer(deps, i.guildId!);
    if (!player) {
      await reply(i, t('voice.notInVoice', locale));
      return;
    }

    const cfg = getGuildConfig(deps.db, i.guildId!);

    // Per-user rate-limit (SAME limiter as /tts and /laugh — ABUSE-03): without this
    // the preview would queue without limit -> monopolize the voice queue (1 worker per
    // guild) and force cache-miss syntheses by cycling the `model:` option. Same pattern
    // as handleLaugh in fun.ts.
    const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
    if (!rl.allow(i.user.id, Date.now())) {
      await reply(i, t('tts.tooFast', locale));
      return;
    }

    const stored = getUserVoice(deps.db, i.guildId!, i.user.id);
    // Preview does NOT go through resolveSynth on purpose: resolveSynth now lets the
    // message LANGUAGE decide the voice, but /voice preview is a DEMO of ONE specific
    // voice — it must play exactly the requested model (or the saved/default one),
    // regardless of the sample-phrase language. So we build the
    // SynthRequest directly. Precedence: explicit model > user's saved voice >
    // guild default_voice > .env > amy. Speed: the user's, otherwise the default.
    const model =
      (explicitModel ?? stored?.model) ||
      cfg.defaultVoice ||
      deps.config.defaultVoice ||
      'en_US-amy-medium';
    const speed = stored?.speed ?? deps.config.defaultSpeed;
    // singleVoice: the preview is a DEMO of ONE specific voice; detection must never
    // override it nor split the sample phrase by language. The engine is the user's (the preview
    // must sound like what they will actually hear).
    const req: SynthRequest = {
      text: SAMPLE,
      model,
      speed,
      singleVoice: true,
      // the preview must sound like what the user will hear; the resolver applies the gcloud gate
      // (->google without Premium) and the budget (Phase 3) — engine + gcloudBudget.
      ...resolveUserEngine(deps.db, i.guildId!, i.user.id, stored?.engine, Date.now()),
    };
    // say() returns false when the queue is at the cap: in that case do NOT lie "now
    // playing" — we reuse the same tts.busy key as /tts (consistency).
    const queued = await player.say(req);
    await reply(i, queued ? t('voice.previewPlaying', locale) : t('tts.busy', locale));
  }
}
