// tests/smoke.test.ts
//
// P10.4 — SMOKE / BOOT TEST SEM TOKEN.
//
// Replica a sequencia de arranque de src/index.ts (main()) ATE imediatamente
// ANTES do `client.login` — sem NUNCA ligar ao Discord nem fazer rede. O objetivo
// e apanhar cedo um problema de montagem das deps reais (config -> db -> engine ->
// presenca -> command builders) que hoje so se veria numa verificacao ao vivo (com
// token/Piper/rede reais). O teste É o entregavel: se a montagem rebentar, e
// exatamente isto que ele serve para apanhar.
//
// O que NAO fazemos de proposito (tocaria em sockets/token):
//   - NAO importamos ../src/index (o fundo do modulo corre main() -> client.login
//     -> rede, e process.exit(1) em falha mataria o vitest). Montamos a partir dos
//     modulos individuais.
//   - NAO chamamos createClient/bindEvents/installSignalHandlers/startHealthServer/
//     startVoteWebhookServer nem registerCommands (rest.put = rede).
//   - NAO chamamos engine.synth (spawn do Piper) — so afirmamos que o contrato existe.
//
// Hermetico: env minimo definido aqui (repoe process.env no fim, como config.test.ts).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadConfig } from '../src/config/index';
import { initDb } from '../src/store/db';
import { AudioCache } from '../src/tts/cache';
import { createEngine, selectEngine } from '../src/tts/factory';
import { buildPresence } from '../src/bot/presence';
import { commandDefs } from '../src/commands/index';
import { MultiSegmentEngine } from '../src/tts/multiSegment';
import type Database from 'better-sqlite3';

// Replica local dos 3 lines de discoverModels (privado em index.ts, nao exportado —
// nao refatoramos index.ts so para o expor, seria scope creep). Dir vazio => [].
function discoverModels(modelsDir: string): string[] {
  if (!existsSync(modelsDir)) return [];
  return readdirSync(modelsDir)
    .filter((f) => f.endsWith('.onnx'))
    .map((f) => path.basename(f, '.onnx'))
    .sort();
}

// Env minimo para um boot 'piper' (default) valido e hermetico. Limpamos os
// opcionais para nao herdar um .env/env ambiente (ex.: TTS_ENGINE=neural sem key
// faria createEngine lancar) — mesmo racional do config.test.ts.
function setSmokeEnv(modelsDir: string): void {
  const env: Record<string, string | undefined> = {
    DISCORD_TOKEN: 'x',
    CLIENT_ID: '123',
    PIPER_PATH: 'piper-dummy',
    MODELS_DIR: modelsDir,
    DB_PATH: ':memory:',
    // opcionais limpos -> boot no caminho default (piper, sem servidores extra)
    TTS_ENGINE: undefined,
    OPENAI_API_KEY: undefined,
    MULTILINGUAL_SEGMENTS: undefined,
    PRESENCE_TEXT: undefined,
    HEALTH_PORT: undefined,
    TOPGG_WEBHOOK_PORT: undefined,
    TOPGG_WEBHOOK_SECRET: undefined,
    BOT_SHARDS: undefined,
    SHARDS: undefined,
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('smoke: boot sem token (monta deps reais sem ligar ao Discord)', () => {
  const saved = { ...process.env };
  let cacheDir: string;
  let modelsDir: string;
  let db: Database.Database | undefined;

  beforeEach(() => {
    // Cache dir hermetico via mkdtemp: NAO replicamos o join(dirname(dbPath),
    // 'audio-cache') do main() porque com DB_PATH=':memory:' dava './audio-cache'
    // na raiz do repo. modelsDir e um temp VAZIO -> discoverModels devolve [].
    cacheDir = mkdtempSync(path.join(tmpdir(), 'smoke-cache-'));
    modelsDir = mkdtempSync(path.join(tmpdir(), 'smoke-models-'));
    setSmokeEnv(modelsDir);
  });

  afterEach(() => {
    try {
      db?.close();
    } catch {
      // ignorar
    }
    db = undefined;
    rmSync(cacheDir, { recursive: true, force: true });
    rmSync(modelsDir, { recursive: true, force: true });
    process.env = { ...saved };
  });

  it('monta config -> db -> engine -> presenca -> command builders sem lancar', () => {
    // Toda a montagem corre dentro do expect(...).not.toThrow para que QUALQUER
    // rebentar de arranque seja o modo de falha do teste (o que ele serve para apanhar).
    expect(() => {
      // 1) config (loadConfig exige DISCORD_TOKEN + CLIENT_ID reais no env)
      const config = loadConfig();
      expect(config.token).toBe('x');
      expect(config.clientId).toBe('123');
      expect(config.ttsEngine).toBe('piper');

      // 2) db em memoria (mesma chamada do main(), sem tocar no disco)
      db = initDb(':memory:');
      expect(db.open).toBe(true);
      // query trivial: o schema inicial aplicou-se (tabela existe)
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'")
        .get() as { name?: string } | undefined;
      expect(row?.name).toBe('guild_config');

      // 3) cache + descoberta de modelos (dir temp vazio -> [])
      const cache = new AudioCache(cacheDir);
      const availableModels = discoverModels(config.modelsDir);
      expect(Array.isArray(availableModels)).toBe(true);
      expect(availableModels).toEqual([]);

      // 4) motor TTS real (piper) + selectEngine (flag ON por defeito -> embrulha
      // o base num MultiSegmentEngine, que mistura vozes por lingua)
      const baseEngine = createEngine(config, cache);
      const engine = selectEngine(baseEngine, config, availableModels, cache);
      expect(typeof engine.synth).toBe('function');
      // multilingualSegments ON por defeito -> selectEngine embrulha o base
      expect(config.multilingualSegments).toBe(true);
      expect(engine).toBeInstanceOf(MultiSegmentEngine);

      // 5) presenca (funcao pura) -> tem atividades
      const presence = buildPresence(config);
      expect(presence.activities?.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('os command builders constroem (commandDefs nao-vazio, .toJSON valido)', () => {
    // A importacao de commandDefs ja corre os SlashCommandBuilder + .toJSON() no
    // load do modulo; se algum builder fosse invalido, esse import teria lancado.
    // Aqui confirmamos que o artefacto basico existe e tem a forma esperada, sem
    // registar nada na API do Discord (registerCommands faz rest.put = rede).
    expect(commandDefs.length).toBeGreaterThan(0);
    for (const def of commandDefs) {
      expect(typeof def.name).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);
      // Comandos slash (type ausente/1) têm description; os context-menu (USER=2,
      // MESSAGE=3) NÃO têm — a description é proibida nesses. Aceitamos ambos.
      const isContextMenu = def.type === 2 || def.type === 3;
      // `description` só existe no ramo slash da união; o TS não estreita por def.type,
      // por isso acedemos via forma estrutural (o context-menu não a tem).
      const description = (def as { description?: string }).description;
      if (isContextMenu) {
        expect(description ?? '').toBe('');
      } else {
        expect(typeof description).toBe('string');
      }
    }
  });

  // Bug-hunt 2026-07: comandos que dependem de guild (voz/config/store) NÃO devem ser
  // invocáveis em DM (lá guildId é null -> SqliteError guild_id NOT NULL / respostas
  // enganadoras). Os comandos só-de-texto (invite/vote/help/uptime/botstats) FICAM
  // disponíveis em DM. InteractionContextType.Guild === 0.
  // Regressão (duplicados vistos no Discord): nomes de comandos ÚNICOS no conjunto.
  // NB: o duplicado real era global+por-guild (registo duplo), mas este teste garante
  // que nunca é o próprio commandDefs a introduzir dois comandos com o mesmo nome.
  it('não há comandos com nomes repetidos', () => {
    const names = commandDefs.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('comandos de guild estão restritos ao contexto Guild; os públicos não', () => {
    const DM_CAPABLE = new Set(['invite', 'vote', 'help', 'uptime', 'botstats']);
    for (const def of commandDefs) {
      const contexts = (def as { contexts?: number[] }).contexts;
      if (DM_CAPABLE.has(def.name)) {
        // Público: sem restrição de contexto (usável em DM e em guild).
        expect(contexts ?? null).toBeNull();
      } else {
        // Guild-only: exatamente [Guild] (0).
        expect(contexts).toEqual([0]);
      }
    }
  });
});
