import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getVoiceConnection } from '@discordjs/voice';
import { Events, Routes } from 'discord.js';
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
import { GreetCooldown } from './voice/greetCooldown';
import { DuplicateTracker } from './moderation/antispam';
import type { BotDeps } from './bot/deps';
import { removePlayer } from './bot/deps';
import { GameManager } from './games/manager';
import { systemClock } from './games/types';
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
  // Vigia de bloqueios do event-loop (diagnóstico do "Falha ao carregar opções"):
  // stalls ficam no log + metrics.loopStalls. Timer unref'd — nunca segura o processo.
  startLoopLagMonitor();
  const db = initDb(config.dbPath);
  const cache = new AudioCache(path.join(path.dirname(config.dbPath), 'audio-cache'));

  // Modelos DELIBERADAMENTE excluidos das opcoes/deteccao. VAZIO desde 2026-07-08:
  // o Diogo pediu para REPOR o Português europeu (pt_PT-tugao-medium), por isso deixa
  // de estar escondido — passa a aparecer como "Português (Portugal)" a par do
  // "Português" (Brasil). O mecanismo fica de pe: basta juntar um id a este Set para
  // voltar a esconder um modelo das opcoes (o .onnx continua sempre no disco).
  const EXCLUDED_MODELS = new Set<string>();
  const piperModels = discoverModels(config.modelsDir).filter((m) => !EXCLUDED_MODELS.has(m));
  if (piperModels.length === 0) {
    log.warn(
      `[index] nenhum modelo .onnx em ${config.modelsDir} — so vozes gTTS ficarao disponiveis.`,
    );
  }
  // Vozes SO-Google: linguas que o gTTS fala mas SEM modelo Piper standard (ex.: japones
  // — o rhasspy/piper-voices nao tem ja_JP). O motor-base publico e o per-user com o
  // Google por defeito, por isso injetamos uma voz sintetica por cada, para o /voice set e
  // a detecao automatica as oferecerem. O nome segue a convencao Piper (locale-voz-qualidade)
  // para o gttsLangOfModel derivar o tl (ja_JP-... -> 'ja') e o LOCALE_NAMES dar o autonimo
  // (日本語). Sem .onnx no disco: se o Google cair, o Piper nao tem fallback e a mensagem e
  // SALTADA (nunca trava o worker) — routing dormente em voiceMap.ts (jpn->ja_, como cym/nob).
  // Excluidas em TTS_ENGINE=neural (operador, sem gTTS).
  const GTTS_ONLY_MODELS = config.ttsEngine === 'neural' ? [] : ['ja_JP-google-medium'];
  const availableModels = [
    ...piperModels,
    ...GTTS_ONLY_MODELS.filter((m) => !piperModels.includes(m)),
  ].sort();

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
    config.ttsEngine === 'neural'
      ? createEngine(config, cache)
      : createPerUserEngine(config, cache);
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
  log.info(
    `[index] clone de voz: ${cloneEngine.available ? 'motor detetado' : 'sem motor (voz normal)'}`,
  );
  // Pré-aquece o modelo de clone no arranque (~35s de GPU), para a 1.ª mensagem clonada
  // não pagar o cold-load. No-op sem motor; falha cai na voz normal.
  cloneEngine.prewarm();
  const engine = new EffectEngine(cloneEngine, cache.withNamespace('fx'));
  log.info(
    `[index] motor TTS ativo: ${config.ttsEngine === 'neural' ? 'neural' : 'per-user (google+piper)'}`,
  );
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
    // Cooldown de 5 min da saudação de entrada (anti-spam de entrar/sair da call).
    greetCooldown: new GreetCooldown(),
    // Tracker de duplicados para o anti-spam de leitura (opt-in por guild).
    dupTracker: new DuplicateTracker(),
    // Disponibilidade REAL do clone (inclui auto-deteção do venv), para a UI não dizer
    // "motor não instalado" quando o sidecar foi detetado sem CLONE_CMD no env.
    cloneAvailable: cloneEngine.available,
  };

  // Regra de saída: o Vozen só sai da call quando fica SOZINHO (zero humanos no seu
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
  // Emojis do tabuleiro de xadrez: mapa nome->markup preenchido POR REFERÊNCIA no
  // ClientReady (ver abaixo). Começa vazio -> o xadrez usa ASCII até carregar.
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
    // Apaga a thread descartável de um jogo no fim (via games/thread — best-effort).
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

  // Webhook do Ko-fi (compras -> premium). INERTE sem KOFI_WEBHOOK_TOKEN. Independente do
  // gateway: arranca já (não espera o ClientReady) para não perder eventos. try/catch para
  // nunca derrubar o arranque (ex.: porta ocupada).
  try {
    // Painel Premium (opt-in): API de leitura no MESMO servidor. resolveGuildName lê o cache
    // de guilds do cliente AO PEDIDO (já preenchido quando um browser chama), por isso pode
    // ser criada aqui, antes do ClientReady.
    const statusApi = config.premiumApiEnabled
      ? createStatusApi({
          db,
          now: () => Date.now(),
          // Encapsulado (não `fetch` cru) para o `this` ficar certo — evita "Illegal invocation".
          fetchImpl: (u, i) => fetch(u, i),
          resolveGuildName: (id) => client.guilds.cache.get(id)?.name ?? null,
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
      apiOrigin: config.premiumApiEnabled ? config.premiumApiOrigin : undefined,
    });
  } catch (err) {
    log.error('[index] falha ao arrancar o servidor HTTP do Premium (ignorado)', err);
  }

  // Vaga 3 — auto-post da contagem de servidores para o top.gg. OPT-IN (TOPGG_TOKEN).
  // Arranca no ClientReady para que guilds.cache.size já esteja preenchido. try/catch
  // defensivo: nunca impedir/derrubar o arranque. O timer é unref'd (não segura o processo).
  client.once(Events.ClientReady, () => {
    // Diagnóstico de arranque (1x por boot, sem spam): confirma que a app está bem
    // configurada — a identidade (token == CLIENT_ID) e o "Interactions Endpoint URL"
    // do Developer Portal, que, se estiver preenchido, ROUBA todas as interações do
    // gateway (o bot fica online mas não recebe comandos). Lê a config via REST
    // autenticado do próprio bot (não imprime o token). Best-effort.
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
            `Interactions Endpoint URL ${endpoint ? '⚠️ DEFINIDO (' + endpoint + ') — apaga-o no portal' : 'vazio ✓'} · ` +
            `${client.guilds.cache.size} servidor(es)`,
        );
      } catch (err) {
        log.warn('[diag] não consegui ler a config da app (ignorado)', err);
      }
    })();
    try {
      startBotListUpdater({
        botId: config.clientId,
        token: config.topggToken,
        serverCount: () => client.guilds.cache.size,
      });
    } catch (err) {
      log.error('[index] falha ao arrancar o bot-list updater (ignorado)', err);
    }
    // Carrega os emojis do tabuleiro de xadrez (preenche `boardEmojis` por referência).
    // Best-effort: falha => o xadrez usa ASCII.
    void loadBoardEmojis(client, boardEmojis);
    // Premium Apps do Discord: sincroniza os entitlements (compras nativas) com o premium
    // interno. INERTE se PREMIUM_*_SKU_ID não estiverem definidos — em produção hoje é
    // no-op (só /redeem), ativa-se quando o operador criar os SKUs pós-verificação.
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
      log.error('[index] falha ao arrancar a sync de entitlements (ignorado)', err);
    }
    // Comandos OWNER-ONLY (/vozengrant): resolve o(s) dono(s) REAL(is) via a application
    // (User ou membros da Team) + OWNER_ID, e regista o comando SÓ na guild de controlo
    // (guild command => invisível ao público). deps.ownerIds é a fonte da verdade do gate.
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
        log.info(`[owner] ${ids.size} dono(s) resolvido(s) para o /vozengrant.`);
        if (config.ownerGuildId) {
          await registerOwnerCommands(config.token, config.clientId, config.ownerGuildId);
        } else {
          log.info('[owner] OWNER_GUILD_ID não definido — /vozengrant não é registado.');
        }
      } catch (err) {
        log.error('[owner] falha a resolver dono(s)/registar /vozengrant (ignorado)', err);
      }
    })();
  });

  // Sincronizar os comandos NÃO é fatal: é um PUT global fortemente rate-limited
  // (429s) e os comandos já ficaram registados de arranques anteriores. Se falhar
  // (429/rede), avisamos e seguimos para o login — o bot arranca com o conjunto de
  // comandos já registado. Antes, um 429 transitório abortava o arranque e, sob o
  // supervisor, entrava em crash-loop a re-disparar o PUT rate-limited (queimando a
  // quota diária de comandos globais e prolongando a falha).
  try {
    // stateFile ao lado da DB: o PUT global só acontece quando os comandos MUDAM
    // (fingerprint) — menos rate-limit e menos churn de cache do cliente pós-restart.
    await registerCommands(config.token, config.clientId, {
      stateFile: path.join(path.dirname(config.dbPath), 'commands-state.json'),
    });
  } catch (err) {
    log.error(
      '[index] falha ao sincronizar comandos (ignorado, arranco com os já registados)',
      err,
    );
  }
  await client.login(config.token);
}

main().catch((err) => {
  log.error('[index] falha fatal no arranque', err);
  process.exit(1);
});
