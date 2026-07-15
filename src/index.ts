import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getVoiceConnection } from '@discordjs/voice';
import { Events, Routes, PermissionFlagsBits } from 'discord.js';
import { loadConfig } from './config/index';
import { startBotListUpdater } from './botLists';
import { log } from './logging/logger';
import { initDb } from './store/db';
import { startDepartedPurgeJob } from './store/guildDeparted';
import { startPendingPurgeJob } from './store/kofiPending';
import { purgeOldGcloudUsage, monthKeyUTC } from './store/gcloudUsage';
import { sweepOrphanClones } from './store/voiceCloneSweep';
import { sweepOrphanSttTemps } from './voice/transcriptionSession';
import { AudioCache } from './tts/cache';
import {
  createEngine,
  createPerUserEngine,
  selectEngine,
  unofficialGttsEnabled,
} from './tts/factory';
import { syntheticGttsModels } from './language/voiceMap';
import { EffectEngine } from './tts/effects';
import { ProsodyEngine } from './tts/prosody';
import { CloneEngine, resolveCloneCmd } from './tts/cloneEngine';
import { GuildVoicePlayer } from './voice/player';
import { AloneWatcher } from './voice/aloneWatcher';
import { GreetCooldown } from './voice/greetCooldown';
import { LeaderboardPoster } from './leaderboard/randomPost';
import { DuplicateTracker } from './moderation/antispam';
import { CountGate } from './moderation/countGate';
import type { BotDeps } from './bot/deps';
import { removePlayer } from './bot/deps';
import { GameManager } from './games/manager';
import { systemClock } from './games/types';
import { isGuildPremium } from './store/premium';
import { claimVoteReward, VOTE_REWARD_HOURS } from './store/voteReward';
import { createVoiceSession, becomeSpeakerIfStage } from './voice/session';
import { listVoicePresence, forgetVoicePresence } from './store/voicePresence';
import { planRejoin, type ChannelState } from './voice/rejoin';
import { loadBoardEmojis } from './games/boardEmojis';
import { deleteChannelSafe } from './games/thread';
import { getGuildConfig } from './store/guildConfig';
import { persistGameScores } from './store/gameScore';
import { t, DEFAULT_LOCALE } from './i18n/index';
import { createClient, bindEvents } from './bot/client';
import { registerCommands, registerOwnerCommands } from './bot/registerCommands';
import { installSignalHandlers } from './bot/shutdown';
import { startHealthServer } from './health';
import { checkFfmpeg } from './health/ffmpeg';
import { startLoopLagMonitor } from './health/loopLag';
import { startEntitlementSync } from './premium/entitlementSync';
import { startKofiWebhook } from './premium/kofiWebhook';
import { createStatusApi } from './premium/statusApi';
import { createDashboardApi } from './premium/dashboardApi';
import { startVoteWebhookServer } from './vote';

function discoverModels(modelsDir: string): string[] {
  if (!existsSync(modelsDir)) return [];
  return readdirSync(modelsDir)
    .filter((f) => f.endsWith('.onnx'))
    .map((f) => path.basename(f, '.onnx'))
    .sort();
}

async function main(): Promise<void> {
  const config = loadConfig();
  // Event-loop blocking watchdog (diagnosis of "Failed to load options"):
  // stalls go to the log + metrics.loopStalls. Timer unref'd — never holds the process.
  startLoopLagMonitor();
  const db = initDb(config.dbPath);
  const cache = new AudioCache(path.join(path.dirname(config.dbPath), 'audio-cache'));

  // Models DELIBERATELY excluded from the options/detection. Since 2026-07-10 Diogo
  // asked to REMOVE the European Portuguese Piper (pt_PT-tugao-medium): pt-PT is now
  // served ONLY by Google (syntheticGttsModels generates 'pt_PT-google-medium' because
  // no Piper covers pt_PT) and by Kokoro (opt-in engine, independent of these models).
  // The saved prefs that pointed to the Piper were migrated to the Google voice (see
  // db.ts). The mechanism stays in place: just add/remove an id from this Set (the .onnx
  // stays on disk until deleted by hand).
  const EXCLUDED_MODELS = new Set<string>(['pt_PT-tugao-medium']);
  const piperModels = discoverModels(config.modelsDir).filter((m) => !EXCLUDED_MODELS.has(m));
  if (piperModels.length === 0) {
    if (unofficialGttsEnabled(config.ttsEngine)) {
      log.warn(
        `[index] no .onnx models found in ${config.modelsDir}; only gTTS voices are available.`,
      );
    } else if (config.ttsEngine === 'piper') {
      throw new Error(
        `TTS_ENGINE=piper requires at least one .onnx voice model in ${config.modelsDir}`,
      );
    }
  }
  // Google-ONLY voices: for EACH known language (LOCALE_NAMES) WITHOUT a Piper model on
  // disk, we inject a synthetic voice `{locale}-google-medium`, so that /voice set and
  // automatic detection offer it and it speaks via Google (the default engine). This makes
  // the catalog INDEPENDENT of the disk: even with ./models empty (e.g. a fresh deploy
  // without the .onnx) the ~40 languages still appear, instead of collapsing to only
  // Japanese. The name follows the Piper convention (locale-voice-quality) so gttsLangOfModel
  // derives the tl (ja_JP-... -> 'ja') and LOCALE_NAMES gives the autonym. Excluded in neural (no gTTS).
  const GTTS_ONLY_MODELS = syntheticGttsModels(
    piperModels,
    unofficialGttsEnabled(config.ttsEngine),
  );
  const availableModels = [...piperModels, ...GTTS_ONLY_MODELS].sort();

  // P13.2 — ffmpeg health-check at STARTUP. @discordjs/voice transcodes the
  // audio via prism-media -> ffmpeg; if the binary is missing/from the wrong
  // platform, the 1st playback would blow up late with a raw unhandledRejection. Here
  // we check early and, if it fails, log a CLEAR and actionable ERROR (loud &
  // early — this was exactly the silent failure mode of the 1st live test).
  // We do NOT process.exit/throw: the bot still starts (only playback would
  // fail), the goal is to trade the late error for an early warning. The check
  // goes in a try/catch so it can never prevent the boot.
  try {
    const ff = checkFfmpeg();
    if (ff.ok) {
      log.info(`[health] ffmpeg OK (${ff.version})`);
    } else {
      log.error(`[health] ${ff.error}`);
    }
  } catch (err) {
    log.error('[health] unexpected FFmpeg health-check failure (ignored)', err);
  }

  // The hosted/default path is the per-user router. Piper is local by default; gTTS is
  // created only by the explicit legacy modes. Neural mode uses a single OpenAI engine.
  const baseEngine =
    config.ttsEngine === 'neural'
      ? createEngine(config, cache)
      : createPerUserEngine(config, cache, db); // db => persistent Google HD counters
  // External decorators, from inside out:
  //   selectEngine (multi-segment) -> CloneEngine (cloned voice) -> ProsodyEngine
  //   (question intonation) -> EffectEngine (voice effect)
  // CloneEngine replaces the SYNTHESIS when req.cloneRef is present (the person's voice);
  // EffectEngine applies the effect ON TOP of the result. Both fall back to the normal/clean
  // voice on failure and have their own cache. The clone sidecar is auto-detected (tools/clone-venv)
  // or comes from CLONE_CMD; absent => inert clone (always serves the normal voice).
  const cloneCmd = resolveCloneCmd(config.cloneCmd);
  const cloneEngine = new CloneEngine(
    selectEngine(baseEngine, config, availableModels, cache),
    cache.withNamespace('clone'),
    cloneCmd,
    undefined, // spawnImpl (default)
    undefined, // readyTimeoutMs (default)
    config.cloneKey, // encryption at rest of the samples (no-op without CLONE_KEY)
  );
  log.info(
    `[index] voice clone: ${cloneEngine.available ? 'engine detected' : 'no engine (normal voice)'}`,
  );
  // Plan 024 (SECRET-02) — genuine fail-open: with the clone engine available
  // but WITHOUT CLONE_KEY, the samples (biometric data, ToS §5(c) + GDPR) are
  // stored/read in the clear (see src/tts/cloneEngine.ts) with no signal to the
  // operator. It only warns (does not change behavior — the missing encryption is a
  // deferred decision, not fixed here).
  if (cloneEngine.available && config.cloneKey === undefined) {
    log.warn(
      '[index] CLONE_KEY is not set while the clone engine is active; cloned voice samples ' +
        '(biometric data) will be stored without encryption at rest. Set CLONE_KEY in .env.',
    );
  }
  // Pre-warms the clone model at startup (~35s of GPU), so the 1st cloned message
  // does not pay the cold-load. No-op without an engine; failure falls back to the normal voice.
  cloneEngine.prewarm();
  // ProsodyEngine: QUESTION INTONATION (raises the pitch at the end of utterances with `?`). It sits
  // OUTSIDE the clone/multiseg (applies to the FINAL WAV of the utterance) and INSIDE the effect (a
  // voice effect comes on top). Own cache 'q'; only runs when the utterance ends in `?`.
  const prosodyEngine = new ProsodyEngine(cloneEngine, cache.withNamespace('q'));
  const engine = new EffectEngine(prosodyEngine, cache.withNamespace('fx'));
  log.info(
    `[index] motor TTS ativo: ${config.ttsEngine === 'neural' ? 'neural' : 'per-user (google+piper)'}`,
  );
  if (config.multilingualSegments) {
    log.warn(
      '[index] MULTILINGUAL_SEGMENTS ON; experimental per-segment multilingual synthesis is active.',
    );
  }

  const client = createClient();
  const deps: BotDeps = {
    client,
    db,
    engine,
    config,
    availableModels,
    players: new Map<string, GuildVoicePlayer>(),
    limiters: new Map(),
    // xsaid: last author read per guild, to avoid repeating "{name} said" back-to-back.
    lastSpeaker: new Map<string, string>(),
    // 5-min cooldown of the join greeting (anti-spam of joining/leaving the call).
    greetCooldown: new GreetCooldown(),
    leaderboardPoster: new LeaderboardPoster(),
    // Duplicate tracker for the reading anti-spam (opt-in per guild).
    dupTracker: new DuplicateTracker(),
    countGate: new CountGate(),
    // REAL clone availability (includes venv auto-detection), so the UI does not say
    // "engine not installed" when the sidecar was detected without CLONE_CMD in the env.
    cloneAvailable: cloneEngine.available,
  };

  // Leave rule: Vozen only leaves the call when it becomes ALONE (zero humans in its
  // channel) — and by default it leaves IMMEDIATELY (ALONE_LEAVE_MS=0). It NEVER leaves due
  // to TTS inactivity: with at least 1 human, it stays in the call forever. The
  // AloneWatcher is re-evaluated in the
  // VoiceStateUpdate handler (client.ts). `humansInBotChannel` counts the non-bots
  // of the bot's current channel (null = the bot is not in voice); `leave` is the same path
  // as onIdle (removePlayer -> destroy the connection).
  deps.aloneWatcher = new AloneWatcher({
    humansInBotChannel: (guildId) => {
      const guild = client.guilds.cache.get(guildId);
      const chanId = guild?.members?.me?.voice?.channelId;
      if (!guild || !chanId) return null;
      const chan = guild.channels.cache.get(chanId);
      if (!chan || !chan.isVoiceBased()) return null;
      return chan.members.filter((m) => !m.user.bot).size;
    },
    leave: (guildId) => {
      removePlayer(deps, guildId);
      getVoiceConnection(guildId)?.destroy();
    },
    // 24/7 in-call: the guild stays in the channel even when alone only if it is Premium AND has the
    // toggle on (/config always-on, default OFF). isGuildPremium covers direct Premium + passes.
    stayInCall: (guildId) =>
      isGuildPremium(db, guildId, Date.now()) && getGuildConfig(db, guildId).stayInCall,
  });

  // Minigames (/game). The GameManager is decoupled from discord.js/SQLite: it receives a
  // GameEnv with the capabilities it needs (speak, send to channel, locale,
  // translate, persist scores), all backed by `deps`/`db`/`client`. `singleVoice`
  // and the system clock live in the manager. It sits in `deps.games`, read by
  // handleMessage (guesses) and by the leave funnel (removePlayer -> endGuild).
  const defaultVoiceOf = (guildId: string): string => {
    try {
      return getGuildConfig(db, guildId).defaultVoice || config.defaultVoice || 'en_US-amy-medium';
    } catch {
      return config.defaultVoice || 'en_US-amy-medium';
    }
  };
  // Chess board emojis: name->markup map filled BY REFERENCE in the
  // ClientReady (see below). Starts empty -> chess uses ASCII until it loads.
  const boardEmojis: Record<string, string> = {};
  deps.games = new GameManager({
    clock: systemClock,
    availableModels,
    defaultSpeed: config.defaultSpeed,
    defaultVoiceOf,
    boardEmojis,
    getPlayer: (guildId) => deps.players.get(guildId),
    sendToChannel: async (channelId, content) => {
      const ch = client.channels.cache.get(channelId);
      if (ch && 'send' in ch && typeof (ch as { send?: unknown }).send === 'function') {
        await (ch as { send: (c: unknown) => Promise<unknown> }).send(content);
      }
    },
    // Deletes a game's disposable thread at the end (via games/thread — best-effort).
    deleteChannel: (channelId) => deleteChannelSafe(client, channelId),
    localeOf: (guildId) => {
      try {
        return getGuildConfig(db, guildId).locale;
      } catch {
        return DEFAULT_LOCALE;
      }
    },
    translate: (key, locale, params) => t(key, locale, params),
    persistScores: (guildId, points) => persistGameScores(db, guildId, points),
    logError: (msg, err) => log.error(msg, err),
  });

  bindEvents(deps);
  installSignalHandlers(deps);

  // P9.7 — OPTIONAL HTTP health endpoint (uptime monitors). Only starts if
  // HEALTH_PORT is set. In a defensive try/catch: a problem opening the
  // port (e.g. already in use) must NEVER prevent the bot from starting.
  try {
    startHealthServer(config);
  } catch (err) {
    log.error('[index] failed to start the health server (ignored)', err);
  }

  // Vote REWARD (growth loop): each ELIGIBLE upvote gives VOTE_REWARD_HOURS of Plus to
  // the voter (source 'vote' — EXTRA, never the base quality). 30-day COOLDOWN per account
  // (claimVoteReward): voting more times counts for top.gg but does not stack free Plus (does not
  // cannibalize the paid one). No DM (hard rule) — the person sees the status in /vote and /premium. The SAME
  // callback serves both webhook entry points (see below).
  const rewardVote = (userId: string): void => {
    try {
      const res = claimVoteReward(db, userId, Date.now());
      if (res.granted) {
        log.info(
          `[vote] recompensa: +${VOTE_REWARD_HOURS}h de Plus para ${userId} (fim ${new Date(res.expiresAt!).toISOString()}).`,
        );
      } else {
        log.info(
          `[vote] voto de ${userId} contou, mas a recompensa está em cooldown (elegível ${new Date(res.nextEligibleAt!).toISOString()}).`,
        );
      }
    } catch (err) {
      log.error(`[vote] failed to grant a vote reward to ${userId} (ignored)`, err);
    }
  };

  // P11.5 — top.gg webhook on a DEDICATED PORT (optional): only starts with TOPGG_WEBHOOK_PORT.
  // In production we instead use the /webhook/topgg route on the API server (see startKofiWebhook
  // below), which is already public via Caddy — no need for a dedicated port+route. Defensive try/catch.
  try {
    startVoteWebhookServer(config, rewardVote);
  } catch (err) {
    log.error('[index] failed to start the top.gg webhook (ignored)', err);
  }

  // Ko-fi webhook (purchases -> premium). INERT without KOFI_WEBHOOK_TOKEN. Independent of the
  // gateway: starts right away (does not wait for ClientReady) to avoid missing events. try/catch to
  // never take down the startup (e.g. port in use).
  try {
    // Premium Panel (opt-in): read API on the SAME server. resolveGuildName reads the client's
    // guild cache ON DEMAND (already populated when a browser calls), so it can
    // be created here, before ClientReady.
    const statusApi = config.premiumApiEnabled
      ? createStatusApi({
          db,
          now: () => Date.now(),
          // Wrapped (not raw `fetch`) so `this` is correct — avoids "Illegal invocation".
          fetchImpl: (u, i) => fetch(u, i),
          resolveGuildName: (id) => client.guilds.cache.get(id)?.name ?? null,
          logError: (m, err) => log.error(m, err),
        })
      : undefined;
    // Web config dashboard (opt-in, same gate/server as the panel). botHasGuild reads the client's
    // guild cache ON DEMAND — the authz (MANAGE_GUILD + bot present) lives in the module.
    const dashboardApi = config.premiumApiEnabled
      ? createDashboardApi({
          db,
          now: () => Date.now(),
          fetchImpl: (u, i) => fetch(u, i),
          botHasGuild: (id) => client.guilds.cache.has(id),
          logError: (m, err) => log.error(m, err),
        })
      : undefined;
    startKofiWebhook({
      db,
      token: config.kofiWebhookToken,
      port: config.kofiWebhookPort,
      now: () => Date.now(),
      logInfo: (m) => log.info(m),
      logError: (m, err) => log.error(m, err),
      statusApi,
      dashboardApi,
      apiOrigin: config.premiumApiEnabled ? config.premiumApiOrigin : undefined,
      // Vote reward on the SAME public port (POST /webhook/topgg) — no dedicated Caddy
      // needed. Only enabled with TOPGG_WEBHOOK_SECRET (without its own port).
      topggWebhookSecret: config.topggWebhookSecret,
      onUpvote: rewardVote,
    });
  } catch (err) {
    log.error('[index] failed to start the Premium HTTP server (ignored)', err);
  }

  // Wave 3 — auto-post of the server count to top.gg. OPT-IN (TOPGG_TOKEN).
  // Starts on ClientReady so guilds.cache.size is already populated. Defensive try/catch:
  // never prevent/take down the startup. The timer is unref'd (does not hold the process).
  client.once(Events.ClientReady, () => {
    // Startup diagnostic (1x per boot, no spam): confirms the app is well
    // configured — the identity (token == CLIENT_ID) and the "Interactions Endpoint URL"
    // in the Developer Portal, which, if set, STEALS all gateway interactions
    // (the bot is online but receives no commands). Reads the config via the bot's own
    // authenticated REST (does not print the token). Best-effort.
    void (async () => {
      try {
        const app = (await client.rest.get(Routes.currentApplication())) as {
          id?: string;
          interactions_endpoint_url?: string | null;
        };
        const idOk = client.user?.id === config.clientId;
        const endpoint = app.interactions_endpoint_url;
        log.info(
          `[diag] app: identidade ${idOk ? 'OK ✓' : '⚠️ token != CLIENT_ID'} · ` +
            `Interactions Endpoint URL ${endpoint ? '⚠️ SET (' + endpoint + '); remove it in the portal' : 'empty ✓'} · ` +
            `${client.guilds.cache.size} server(s)`,
        );
      } catch (err) {
        log.warn('[diag] failed to read the application configuration (ignored)', err);
      }
    })();
    try {
      startBotListUpdater({
        botId: config.clientId,
        token: config.topggToken,
        serverCount: () => client.guilds.cache.size,
      });
    } catch (err) {
      log.error('[index] failed to start the bot-list updater (ignored)', err);
    }
    // Loads the chess board emojis (fills `boardEmojis` by reference).
    // Best-effort: failure => chess uses ASCII.
    void loadBoardEmojis(client, boardEmojis);
    // Discord Premium Apps: syncs the entitlements (native purchases) with the internal
    // premium. INERT if PREMIUM_*_SKU_ID are not set — in production today it is a
    // no-op (only /redeem), activated when the operator creates the SKUs post-verification.
    try {
      startEntitlementSync({
        client,
        db,
        sku: { guildSkuId: config.premiumGuildSkuId, userSkuId: config.premiumUserSkuId },
        now: () => Date.now(),
        logInfo: (m) => log.info(m),
        logError: (m, err) => log.error(m, err),
      });
    } catch (err) {
      log.error('[index] failed to start entitlement synchronization (ignored)', err);
    }
    // Compliance §5(b): purges the data of servers that removed the bot >30 days ago
    // (marked in guild_departed on the real guildDelete). Runs now and then 1x/day.
    try {
      startDepartedPurgeJob(db, (ids) =>
        log.info(
          `[retencao] purgados os dados de ${ids.length} servidor(es) saído(s): ${ids.join(', ')}`,
        ),
      );
    } catch (err) {
      log.error('[index] failed to start the departed-guild purge job (ignored)', err);
    }
    // Data minimization: purges the PENDING (unclaimed) Ko-fi purchases older than 90 days.
    // Runs now and then 1x/day. The buyer claims much earlier; renewals do not depend
    // on old pendings (they use the email->Discord ID map). Best-effort.
    try {
      startPendingPurgeJob(db, (removed) =>
        log.info(`[retention] purged ${removed} old pending Ko-fi purchase(s).`),
      );
    } catch (err) {
      log.error('[index] failed to start the pending Ko-fi purchase purge job (ignored)', err);
    }
    // DATA-06: reconciliation sweep of ORPHANED .wav in voice-clones/ — the safety
    // net for the best-effort unlinks of eraseUser/`/voice clone delete` (if the process
    // dies between deleting the row and deleting the file, or the unlink blows up, the
    // biometric sample is left with no `user_clone` row referencing it). Runs ONLY ONCE at
    // startup (`once(ClientReady...)`), never on an interval — orphans only accumulate on a
    // crash, not continuously. The match is against the REAL `sample_path` in the DB, never by
    // a name heuristic (see voiceCloneSweep.ts). Best-effort: never prevents startup.
    try {
      const voiceClonesDir = path.join(path.dirname(config.dbPath), 'voice-clones');
      const sweep = sweepOrphanClones(db, voiceClonesDir);
      if (sweep.removed.length > 0 || sweep.failed.length > 0) {
        log.info(
          `[retencao] sweep de clones órfãos: ${sweep.removed.length} apagado(s) de ` +
            `${sweep.scanned} .wav varrido(s)${sweep.failed.length ? `, ${sweep.failed.length} falhou/falharam a apagar` : ''}.`,
        );
      }
    } catch (err) {
      log.error('[index] orphaned clone sweep failed (ignored)', err);
    }
    // Sweep of orphaned STT temporary WAVs in the tmpdir (crash between toWav and the rmSync in
    // finally). Same class as the clone sweep; runs only at startup, before any
    // STT session. Best-effort — never prevents startup.
    try {
      const removed = sweepOrphanSttTemps();
      if (removed > 0)
        log.info(`[retencao] sweep de temporários STT órfãos: ${removed} apagado(s).`);
    } catch (err) {
      log.error('[index] orphaned STT temp sweep failed (ignored)', err);
    }
    // gcloud_usage retention (monthly char counters): deletes months older than ~3
    // months. Runs now and then 1x/day. Avoids unbounded growth; the cost gate only looks
    // at the current month. Timer unref'd (never holds the process). Best-effort.
    try {
      const purgeGcloud = (): void => {
        try {
          const cutoff = monthKeyUTC(Date.now() - 92 * 86_400_000);
          const removed = purgeOldGcloudUsage(db, cutoff);
          if (removed > 0) {
            log.info(`[retention] purged ${removed} old gcloud_usage row(s) (< ${cutoff}).`);
          }
        } catch (err) {
          log.error('[retention] gcloud_usage purge failed (ignored)', err);
        }
      };
      purgeGcloud();
      const gcloudTimer = setInterval(purgeGcloud, 24 * 60 * 60 * 1000);
      gcloudTimer.unref?.();
    } catch (err) {
      log.error('[index] failed to start the gcloud_usage purge job (ignored)', err);
    }
    // 24/7 in-call: restores the Premium servers to the channels they were in before the
    // restart/deploy (the voice connections die on shutdown; the voice_presence rows
    // survive). planRejoin (pure) decides what to restore vs forget;
    // here we only resolve the real channel state and execute. Best-effort per guild.
    try {
      const channelStateOf = (guildId: string, channelId: string): ChannelState => {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return 'gone'; // we are no longer in the guild
        const chan = guild.channels.cache.get(channelId);
        if (!chan || !chan.isVoiceBased()) return 'gone'; // channel deleted / no longer a voice channel
        const me = guild.members.me;
        const perms = me ? chan.permissionsFor(me) : null;
        if (!perms?.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
          return 'no-perms';
        }
        return 'ready';
      };
      const rows = listVoicePresence(db);
      if (rows.length > 0) {
        const plan = planRejoin(rows, {
          stayInCall: (gid) =>
            isGuildPremium(db, gid, Date.now()) && getGuildConfig(db, gid).stayInCall,
          channelState: channelStateOf,
        });
        for (const gid of plan.forget) forgetVoicePresence(db, gid);
        let rejoined = 0;
        for (const row of plan.rejoin) {
          try {
            const guild = client.guilds.cache.get(row.guildId);
            if (!guild) continue;
            createVoiceSession(deps, row.guildId, row.channelId, guild.voiceAdapterCreator);
            const chan = guild.channels.cache.get(row.channelId);
            if (chan?.isVoiceBased()) becomeSpeakerIfStage(chan);
            rejoined++;
          } catch (err) {
            log.warn(`[voice] failed to restore 24/7 mode in guild ${row.guildId} (ignored)`, err);
          }
        }
        log.info(
          `[voice] 24/7: ${rejoined} servidor(es) Premium repostos, ${plan.forget.length} presença(s) limpa(s).`,
        );
      }
    } catch (err) {
      log.error('[index] 24/7 rejoin failed (ignored)', err);
    }
    // OWNER-ONLY commands (/vozengrant): resolves the REAL owner(s) via the application
    // (User or Team members) + OWNER_ID, and registers the command ONLY in the control guild
    // (guild command => invisible to the public). deps.ownerIds is the source of truth for the gate.
    void (async () => {
      try {
        const app = await client.application?.fetch();
        const ids = new Set<string>();
        if (config.ownerId) ids.add(config.ownerId);
        const owner = app?.owner;
        if (owner) {
          if ('members' in owner && owner.members) {
            for (const m of owner.members.values()) if (m.user?.id) ids.add(m.user.id);
          } else if ('id' in owner) {
            ids.add(owner.id);
          }
        }
        deps.ownerIds = ids;
        log.info(`[owner] resolved ${ids.size} owner(s) for /vozengrant.`);
        if (config.ownerGuildId) {
          await registerOwnerCommands(config.token, config.clientId, config.ownerGuildId);
        } else {
          log.info('[owner] OWNER_GUILD_ID is not set; /vozengrant will not be registered.');
        }
      } catch (err) {
        log.error('[owner] failed to resolve owners or register /vozengrant (ignored)', err);
      }
    })();
  });

  // Synchronizing the commands is NOT fatal: it is a heavily rate-limited global PUT
  // (429s) and the commands were already registered from previous startups. If it fails
  // (429/network), we warn and proceed to login — the bot starts with the set of
  // commands already registered. Before, a transient 429 aborted the startup and, under the
  // supervisor, entered a crash-loop re-firing the rate-limited PUT (burning the
  // daily global-command quota and prolonging the failure).
  try {
    // stateFile next to the DB: the global PUT only happens when the commands CHANGE
    // (fingerprint) — less rate-limit and less client cache churn post-restart.
    await registerCommands(config.token, config.clientId, {
      stateFile: path.join(path.dirname(config.dbPath), 'commands-state.json'),
    });
  } catch (err) {
    log.error('[index] failed to synchronize commands; starting with existing commands', err);
  }
  await client.login(config.token);
}

main().catch((err) => {
  log.error('[index] fatal startup failure', err);
  process.exit(1);
});
