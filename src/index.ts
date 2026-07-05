import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getVoiceConnection } from '@discordjs/voice';
import { Events } from 'discord.js';
import { loadConfig } from './config/index';
import { startBotListUpdater } from './botLists';
import { log } from './logging/logger';
import { initDb } from './store/db';
import { AudioCache } from './tts/cache';
import { createEngine, createPerUserEngine, selectEngine } from './tts/factory';
import { EffectEngine } from './tts/effects';
import { CloneEngine, resolveCloneCmd } from './tts/cloneEngine';
import { GuildVoicePlayer } from './voice/player';
import { AloneWatcher } from './voice/aloneWatcher';
import type { BotDeps } from './bot/deps';
import { removePlayer } from './bot/deps';
import { GameManager } from './games/manager';
import { systemClock } from './games/types';
import { getGuildConfig } from './store/guildConfig';
import { persistGameScores } from './store/gameScore';
import { t, DEFAULT_LOCALE } from './i18n/index';
import { createClient, bindEvents } from './bot/client';
import { registerCommands } from './bot/registerCommands';
import { installSignalHandlers } from './bot/shutdown';
import { startHealthServer } from './health';
import { checkFfmpeg } from './health/ffmpeg';
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
  const db = initDb(config.dbPath);
  const cache = new AudioCache(path.join(path.dirname(config.dbPath), 'audio-cache'));

  // Modelos DELIBERADAMENTE excluidos das opcoes/deteccao. Pedido do Diogo: uma so
  // voz portuguesa — a do Brasil (rotulada "Português"). O .onnx fica no disco, por
  // isso e REVERSIVEL: basta remover a entrada daqui para o europeu (tugao) voltar.
  const EXCLUDED_MODELS = new Set(['pt_PT-tugao-medium']);
  const availableModels = discoverModels(config.modelsDir).filter((m) => !EXCLUDED_MODELS.has(m));
  if (availableModels.length === 0) {
    log.warn(`[index] nenhum modelo .onnx em ${config.modelsDir} — /voice list ficara vazio.`);
  }

  // P13.2 — health-check do ffmpeg no ARRANQUE. O @discordjs/voice transcodifica
  // o audio via prism-media -> ffmpeg; se o binario faltar/for da plataforma
  // errada, a 1a reproducao rebentava tarde com um unhandledRejection cru. Aqui
  // verificamos cedo e, se falhar, logamos um ERRO CLARO e acionavel (loud &
  // early — foi exatamente este o modo de falha silencioso do 1o teste ao vivo).
  // NAO fazemos process.exit/throw: o bot arranca na mesma (so a reproducao e que
  // falharia), o objetivo e trocar o erro tardio por um aviso antecipado. O check
  // vai em try/catch para nunca poder impedir o boot.
  try {
    const ff = checkFfmpeg();
    if (ff.ok) {
      log.info(`[health] ffmpeg OK (${ff.version})`);
    } else {
      log.error(`[health] ${ff.error}`);
    }
  } catch (err) {
    log.error('[health] falha inesperada no health-check do ffmpeg (ignorado)', err);
  }

  // Motor base. Por defeito (free), é o motor POR-UTILIZADOR: gTTS (Google, default) +
  // Piper, escolhido em /voice set por cada pessoa (PerUserEngineRouter via req.engine).
  // Só com TTS_ENGINE=neural (operador) é que se usa o motor único (OpenAI). P14.4:
  // selectEngine embrulha-o num MultiSegmentEngine se a flag multilingualSegments estiver ON.
  const baseEngine =
    config.ttsEngine === 'neural' ? createEngine(config, cache) : createPerUserEngine(config, cache);
  // Decoradores externos, de dentro para fora:
  //   selectEngine (multi-segmento) -> CloneEngine (voz clonada, premium) -> EffectEngine
  // O CloneEngine substitui a SÍNTESE quando req.cloneRef está presente (voz da pessoa);
  // o EffectEngine aplica o efeito por CIMA do resultado. Ambos caem na voz normal/limpa
  // em falha e têm cache própria. O sidecar de clone é auto-detetado (tools/clone-venv)
  // ou vem de CLONE_CMD; ausente => clone inerte (serve sempre a voz normal).
  const cloneCmd = resolveCloneCmd(config.cloneCmd);
  const cloneEngine = new CloneEngine(
    selectEngine(baseEngine, config, availableModels, cache),
    cache.withNamespace('clone'),
    cloneCmd,
  );
  log.info(`[index] clone de voz: ${cloneEngine.available ? 'motor detetado' : 'sem motor (voz normal)'}`);
  const engine = new EffectEngine(cloneEngine, cache.withNamespace('fx'));
  log.info(`[index] motor TTS ativo: ${config.ttsEngine === 'neural' ? 'neural' : 'per-user (google+piper)'}`);
  if (config.multilingualSegments) {
    log.warn(
      '[index] MULTILINGUAL_SEGMENTS ON — sintese multi-lingua por-segmento EXPERIMENTAL ativa.',
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
    // xsaid: último autor lido por guild, para não repetir "{nome} disse" em seguidas.
    lastSpeaker: new Map<string, string>(),
  };

  // Regra de saída: o Voxi só sai da call quando fica SOZINHO (zero humanos no seu
  // canal) — e por defeito sai IMEDIATAMENTE (ALONE_LEAVE_MS=0). NUNCA sai por
  // inatividade de TTS: com pelo menos 1 humano, fica na call para sempre. O
  // AloneWatcher é reavaliado no
  // handler de VoiceStateUpdate (client.ts). `humansInBotChannel` conta os não-bots
  // do canal atual do bot (null = o bot não está em voz); `leave` é o mesmo caminho
  // do onIdle (removePlayer -> destroy da ligação).
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
  });

  // Minijogos (/game). O GameManager e desacoplado de discord.js/SQLite: recebe um
  // GameEnv com as capacidades de que precisa (falar, enviar ao canal, locale,
  // traduzir, persistir pontos), todas backed por `deps`/`db`/`client`. `singleVoice`
  // e o relogio de sistema vivem no manager. Fica em `deps.games`, lido pelo
  // handleMessage (palpites) e pelo funil de saida (removePlayer -> endGuild).
  const defaultVoiceOf = (guildId: string): string => {
    try {
      return getGuildConfig(db, guildId).defaultVoice || config.defaultVoice || 'en_US-amy-medium';
    } catch {
      return config.defaultVoice || 'en_US-amy-medium';
    }
  };
  deps.games = new GameManager({
    clock: systemClock,
    availableModels,
    defaultSpeed: config.defaultSpeed,
    defaultVoiceOf,
    getPlayer: (guildId) => deps.players.get(guildId),
    sendToChannel: async (channelId, content) => {
      const ch = client.channels.cache.get(channelId);
      if (ch && 'send' in ch && typeof (ch as { send?: unknown }).send === 'function') {
        await (ch as { send: (c: unknown) => Promise<unknown> }).send(content);
      }
    },
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

  // P9.7 — health endpoint HTTP OPCIONAL (uptime monitors). So arranca se
  // HEALTH_PORT estiver definida. Em try/catch defensivo: um problema a abrir a
  // porta (ex.: ja em uso) NUNCA deve impedir o bot de arrancar.
  try {
    startHealthServer(config);
  } catch (err) {
    log.error('[index] falha ao arrancar o servidor de health (ignorado)', err);
  }

  // P11.5 — webhook top.gg OPCIONAL para registar votos. So arranca se
  // TOPGG_WEBHOOK_PORT estiver definida (porta dedicada, separada do health). Em
  // try/catch defensivo: um problema a abrir a porta NUNCA deve impedir o bot de
  // arrancar.
  try {
    startVoteWebhookServer(config);
  } catch (err) {
    log.error('[index] falha ao arrancar o webhook top.gg (ignorado)', err);
  }

  // Vaga 3 — auto-post da contagem de servidores para o top.gg. OPT-IN (TOPGG_TOKEN).
  // Arranca no ClientReady para que guilds.cache.size já esteja preenchido. try/catch
  // defensivo: nunca impedir/derrubar o arranque. O timer é unref'd (não segura o processo).
  client.once(Events.ClientReady, () => {
    try {
      startBotListUpdater({
        botId: config.clientId,
        token: config.topggToken,
        serverCount: () => client.guilds.cache.size,
      });
    } catch (err) {
      log.error('[index] falha ao arrancar o bot-list updater (ignorado)', err);
    }
  });

  // Sincronizar os comandos NÃO é fatal: é um PUT global fortemente rate-limited
  // (429s) e os comandos já ficaram registados de arranques anteriores. Se falhar
  // (429/rede), avisamos e seguimos para o login — o bot arranca com o conjunto de
  // comandos já registado. Antes, um 429 transitório abortava o arranque e, sob o
  // supervisor, entrava em crash-loop a re-disparar o PUT rate-limited (queimando a
  // quota diária de comandos globais e prolongando a falha).
  try {
    await registerCommands(config.token, config.clientId);
  } catch (err) {
    log.error('[index] falha ao sincronizar comandos (ignorado, arranco com os já registados)', err);
  }
  await client.login(config.token);
}

main().catch((err) => {
  log.error('[index] falha fatal no arranque', err);
  process.exit(1);
});
