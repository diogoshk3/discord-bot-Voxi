import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config/index';
import { log } from './logging/logger';
import { initDb } from './store/db';
import { AudioCache } from './tts/cache';
import { createEngine, selectEngine } from './tts/factory';
import { GuildVoicePlayer } from './voice/player';
import type { BotDeps } from './bot/deps';
import { createClient, bindEvents } from './bot/client';
import { registerCommands } from './bot/registerCommands';
import { installSignalHandlers } from './bot/shutdown';
import { startHealthServer } from './health';
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

  const availableModels = discoverModels(config.modelsDir);
  if (availableModels.length === 0) {
    log.warn(`[index] nenhum modelo .onnx em ${config.modelsDir} — /voice list ficara vazio.`);
  }

  // Motor base (Piper/Neural). P14.4: selectEngine embrulha-o num
  // MultiSegmentEngine SO se a flag EXPERIMENTAL multilingualSegments estiver ON.
  // Com a flag OFF (default), devolve o motor base tal e qual — caminho
  // byte-a-byte o de hoje.
  const baseEngine = createEngine(config, cache);
  const engine = selectEngine(baseEngine, config, availableModels, cache);
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
  };

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

  await registerCommands(config.token, config.clientId);
  await client.login(config.token);
}

main().catch((err) => {
  log.error('[index] falha fatal no arranque', err);
  process.exit(1);
});
