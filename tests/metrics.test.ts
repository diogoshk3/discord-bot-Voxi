// tests/metrics.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

// Mock de @discordjs/voice necessário para importar player.ts e commands/index.ts
vi.mock('@discordjs/voice', async () => {
  const { EventEmitter: EE } = await import('node:events');
  const IDLE = 'idle';
  class FakeAudioPlayer extends EE {
    play(_resource: { path: string }): void {
      setTimeout(() => this.emit(IDLE), 0);
    }
    stop(): void {
      this.emit(IDLE);
    }
  }
  return {
    AudioPlayerStatus: { Idle: IDLE },
    VoiceConnectionStatus: {
      Disconnected: 'disconnected',
      Signalling: 'signalling',
      Connecting: 'connecting',
      Ready: 'ready',
    },
    StreamType: { Arbitrary: 'arbitrary' },
    createAudioPlayer: () => new FakeAudioPlayer(),
    createAudioResource: (path: string) => ({ path }),
    entersState: () => Promise.resolve(),
    joinVoiceChannel: () => ({}),
    getVoiceConnection: () => undefined,
  };
});

import { metrics } from '../src/metrics';
import { AudioCache } from '../src/tts/cache';
import type { TTSEngine, SynthRequest } from '../src/tts/engine';
import { GuildVoicePlayer } from '../src/voice/player';
import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeConnection() {
  const conn = new EventEmitter() as EventEmitter & {
    subscribe: () => void;
    destroy: () => void;
    rejoin: () => void;
  };
  conn.subscribe = () => {};
  conn.destroy = () => {};
  conn.rejoin = () => {};
  return conn;
}

function makeStatsDeps(overrides: Partial<BotDeps> = {}): BotDeps {
  return {
    client: { user: { id: 'bot-1' }, guilds: { cache: { size: 3 } } },
    players: new Map(),
    db: {} as BotDeps['db'],
    config: {},
    availableModels: [],
    limiters: new Map(),
    engine: { synth: async () => '' },
    ...overrides,
  } as unknown as BotDeps;
}

interface FakeInteraction {
  commandName: string;
  guildId: string;
  replies: string[];
  reply: (opts: {
    content?: string;
    embeds?: { data?: { description?: string } }[];
    flags?: number;
  }) => Promise<void>;
  isRepliable: () => boolean;
  replied: boolean;
  deferred: boolean;
  member: unknown;
  guild: unknown;
  options: unknown;
  user: { id: string };
}

function makeStatsInteraction(isAdmin = true): FakeInteraction {
  const replies: string[] = [];
  return {
    commandName: 'stats',
    guildId: 'g-stats-test',
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content?: string; embeds?: { data?: { description?: string } }[] }) => {
      // /stats passou a embed — regista o texto OU a descrição do embed.
      const fromEmbeds = (o.embeds ?? []).map((e) => e?.data?.description ?? '').join('\n');
      replies.push(o.content ?? fromEmbeds);
    },
    member: {
      permissions: { has: () => isAdmin },
    },
    guild: null,
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => '',
      getString: () => null,
      getBoolean: () => null,
      getInteger: () => null,
      getChannel: () => null,
      getRole: () => null,
    },
    user: { id: 'u1' },
  };
}

// ── 1. Módulo de métricas: API básica ─────────────────────────────────────────

describe('metrics — API básica', () => {
  beforeEach(() => metrics.reset());

  it('começa a zero após reset()', () => {
    const snap = metrics.snapshot();
    expect(snap).toEqual({
      messagesSpoken: 0,
      cacheHits: 0,
      cacheMisses: 0,
      synthErrors: 0,
      messagesRateLimited: 0,
      voiceDrops: 0,
      voiceReconnects: 0,
      votes: 0,
      loopStalls: 0,
      synthCount: 0,
      synthP50Ms: 0,
      synthP95Ms: 0,
      gcloudSynths: 0,
      gcloudChars: 0,
      gcloudFallbacks: 0,
    });
  });

  it('recordSynthMs alimenta synthCount + p50/p95; reset limpa', () => {
    // Amostras 10..100 (10 valores). p50 -> idx floor(0.5*10)=5 -> 60; p95 -> idx 9 -> 100.
    for (let v = 10; v <= 100; v += 10) metrics.recordSynthMs(v);
    const snap = metrics.snapshot();
    expect(snap.synthCount).toBe(10);
    expect(snap.synthP50Ms).toBe(60);
    expect(snap.synthP95Ms).toBe(100);
    // Valores invalidos sao ignorados (nao contam).
    metrics.recordSynthMs(-5);
    metrics.recordSynthMs(NaN);
    expect(metrics.snapshot().synthCount).toBe(10);
    metrics.reset();
    const z = metrics.snapshot();
    expect(z.synthCount).toBe(0);
    expect(z.synthP50Ms).toBe(0);
    expect(z.synthP95Ms).toBe(0);
  });

  it('inc("cacheHits") incrementa só cacheHits', () => {
    metrics.inc('cacheHits');
    metrics.inc('cacheHits');
    const snap = metrics.snapshot();
    expect(snap.cacheHits).toBe(2);
    expect(snap.cacheMisses).toBe(0);
    expect(snap.messagesSpoken).toBe(0);
    expect(snap.synthErrors).toBe(0);
  });

  it('inc("cacheMisses") incrementa só cacheMisses', () => {
    metrics.inc('cacheMisses');
    expect(metrics.snapshot().cacheMisses).toBe(1);
    expect(metrics.snapshot().cacheHits).toBe(0);
  });

  it('inc("messagesSpoken") incrementa só messagesSpoken', () => {
    metrics.inc('messagesSpoken');
    metrics.inc('messagesSpoken');
    metrics.inc('messagesSpoken');
    expect(metrics.snapshot().messagesSpoken).toBe(3);
  });

  it('inc("synthErrors") incrementa só synthErrors', () => {
    metrics.inc('synthErrors');
    expect(metrics.snapshot().synthErrors).toBe(1);
  });

  it('snapshot() devolve uma cópia (não a referência interna)', () => {
    metrics.inc('cacheHits');
    const s1 = metrics.snapshot();
    metrics.inc('cacheHits');
    const s2 = metrics.snapshot();
    // s1 não deve ter sido afetado pela segunda inc
    expect(s1.cacheHits).toBe(1);
    expect(s2.cacheHits).toBe(2);
  });

  it('reset() repõe todos os contadores a zero', () => {
    metrics.inc('cacheHits');
    metrics.inc('cacheMisses');
    metrics.inc('messagesSpoken');
    metrics.inc('synthErrors');
    metrics.inc('voiceDrops');
    metrics.inc('voiceReconnects');
    metrics.recordSynthMs(42);
    metrics.reset();
    expect(metrics.snapshot()).toEqual({
      messagesSpoken: 0,
      cacheHits: 0,
      cacheMisses: 0,
      synthErrors: 0,
      messagesRateLimited: 0,
      voiceDrops: 0,
      voiceReconnects: 0,
      votes: 0,
      loopStalls: 0,
      synthCount: 0,
      synthP50Ms: 0,
      synthP95Ms: 0,
      gcloudSynths: 0,
      gcloudChars: 0,
      gcloudFallbacks: 0,
    });
  });

  it('inc("voiceDrops") incrementa só voiceDrops', () => {
    metrics.inc('voiceDrops');
    metrics.inc('voiceDrops');
    const snap = metrics.snapshot();
    expect(snap.voiceDrops).toBe(2);
    expect(snap.voiceReconnects).toBe(0);
    expect(snap.messagesSpoken).toBe(0);
    expect(snap.synthErrors).toBe(0);
  });

  it('inc("voiceReconnects") incrementa só voiceReconnects', () => {
    metrics.inc('voiceReconnects');
    const snap = metrics.snapshot();
    expect(snap.voiceReconnects).toBe(1);
    expect(snap.voiceDrops).toBe(0);
  });
});

// ── 2. Wiring: AudioCache.get → cacheHits / cacheMisses ─────────────────────

describe('AudioCache.get — wiring de métricas', () => {
  let dir: string;
  let srcDir: string;
  let cache: AudioCache;

  beforeEach(() => {
    metrics.reset();
    dir = mkdtempSync(join(tmpdir(), 'metrics-cache-'));
    srcDir = mkdtempSync(join(tmpdir(), 'metrics-src-'));
    cache = new AudioCache(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  it('get em chave inexistente incrementa cacheMisses', () => {
    cache.get('nao-existe');
    expect(metrics.snapshot().cacheMisses).toBe(1);
    expect(metrics.snapshot().cacheHits).toBe(0);
  });

  it('get em chave existente incrementa cacheHits', () => {
    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('wav'));
    cache.put('chave', src);

    cache.get('chave');
    expect(metrics.snapshot().cacheHits).toBe(1);
    expect(metrics.snapshot().cacheMisses).toBe(0);
  });

  it('múltiplos gets acumulam corretamente (mix hit+miss)', () => {
    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('wav'));
    cache.put('k', src);

    cache.get('k'); // hit
    cache.get('k'); // hit
    cache.get('miss1'); // miss
    cache.get('miss2'); // miss
    cache.get('miss3'); // miss

    const snap = metrics.snapshot();
    expect(snap.cacheHits).toBe(2);
    expect(snap.cacheMisses).toBe(3);
  });
});

// ── 3. Wiring: GuildVoicePlayer → messagesSpoken + synthErrors ───────────────

describe('GuildVoicePlayer — wiring de métricas', () => {
  beforeEach(() => metrics.reset());

  it('messagesSpoken incrementa quando áudio começa a tocar', async () => {
    const engine: TTSEngine = {
      synth: async (req: SynthRequest) => req.text,
    };

    const conn = makeConnection() as any;
    const player = new GuildVoicePlayer(conn, engine, 20, 60_000, () => {});

    await player.say({ text: 'ola', model: 'm', speed: 1 });

    await vi.waitFor(() => expect(metrics.snapshot().messagesSpoken).toBe(1), { timeout: 1000 });

    player.destroy();
    expect(metrics.snapshot().synthErrors).toBe(0);
  });

  it('synthErrors incrementa quando a síntese falha', async () => {
    const engine: TTSEngine = {
      synth: async () => {
        throw new Error('piper boom');
      },
    };

    const conn = makeConnection() as any;
    const player = new GuildVoicePlayer(conn, engine, 20, 60_000, () => {});

    await player.say({ text: 'texto', model: 'm', speed: 1 });

    await vi.waitFor(() => expect(metrics.snapshot().synthErrors).toBe(1), { timeout: 1000 });

    player.destroy();
    expect(metrics.snapshot().messagesSpoken).toBe(0);
  });

  it('synthErrors não incrementa quando síntese tem sucesso', async () => {
    const engine: TTSEngine = {
      synth: async (req: SynthRequest) => req.text,
    };

    const conn = makeConnection() as any;
    const player = new GuildVoicePlayer(conn, engine, 20, 60_000, () => {});

    await player.say({ text: 'teste', model: 'm', speed: 1 });

    await vi.waitFor(() => expect(metrics.snapshot().messagesSpoken).toBeGreaterThanOrEqual(1), {
      timeout: 1000,
    });

    player.destroy();
    expect(metrics.snapshot().synthErrors).toBe(0);
  });
});

// ── 3b. Wiring: GuildVoicePlayer → voiceDrops + voiceReconnects ───────────────
// O mock partilhado de @discordjs/voice (topo do ficheiro) tem
// entersState: () => Promise.resolve(), por isso a recuperacao "soft" no
// handleDisconnect resolve sempre: um episodio de queda = 1 drop + 1 reconnect.

describe('GuildVoicePlayer — wiring de reconexao (voiceDrops/voiceReconnects)', () => {
  beforeEach(() => metrics.reset());

  it('uma queda (Disconnected) -> voiceDrops sobe 1 e a recuperacao -> voiceReconnects sobe 1', async () => {
    const engine: TTSEngine = { synth: async (req: SynthRequest) => req.text };

    const conn = makeConnection() as any;
    const player = new GuildVoicePlayer(conn, engine, 20, 60_000, () => {});

    // Emite a queda: handleDisconnect conta o drop e, como entersState resolve
    // sempre (mock), a recuperacao "soft" volta a Ready -> conta o reconnect.
    conn.emit('disconnected');

    await vi.waitFor(() => expect(metrics.snapshot().voiceReconnects).toBe(1), { timeout: 1000 });
    expect(metrics.snapshot().voiceDrops).toBe(1);

    player.destroy();
  });

  it('Disconnected repetido no mesmo episodio nao conta a dobrar (dedup por episodio)', async () => {
    const engine: TTSEngine = { synth: async (req: SynthRequest) => req.text };

    const conn = makeConnection() as any;
    const player = new GuildVoicePlayer(conn, engine, 20, 60_000, () => {});

    // Dois eventos Disconnected SINCRONOS no mesmo episodio: o primeiro entra em
    // handleDisconnect, poe reconnecting=true e conta o drop antes do 1o await;
    // o segundo bate no guard (reconnecting) e retorna logo, sem contar.
    conn.emit('disconnected');
    conn.emit('disconnected');

    await vi.waitFor(() => expect(metrics.snapshot().voiceReconnects).toBe(1), { timeout: 1000 });
    // Episodio unico: exatamente 1 drop e 1 reconnect, apesar dos 2 eventos.
    expect(metrics.snapshot().voiceDrops).toBe(1);
    expect(metrics.snapshot().voiceReconnects).toBe(1);

    player.destroy();
  });
});

// ── 4. /stats via handleInteraction ──────────────────────────────────────────

describe('/stats — handleInteraction', () => {
  beforeEach(() => metrics.reset());

  it('responde com os contadores e info do bot', async () => {
    metrics.inc('messagesSpoken');
    metrics.inc('messagesSpoken');
    metrics.inc('cacheHits');
    metrics.inc('cacheMisses');
    metrics.inc('synthErrors');
    metrics.inc('voiceDrops');
    metrics.inc('voiceDrops');
    metrics.inc('voiceReconnects');
    metrics.inc('votes');
    metrics.inc('votes');
    metrics.inc('votes');

    const deps = makeStatsDeps({
      players: new Map([['g1', {} as BotDeps['players'] extends Map<string, infer V> ? V : never]]),
    });

    const i = makeStatsInteraction(true);
    await handleInteraction(i as unknown as import('discord.js').ChatInputCommandInteraction, deps);

    expect(i.replies).toHaveLength(1);
    const reply = i.replies[0];
    // Migrado PT->EN (P16.2): /stats renderiza via t() em ingles por defeito.
    expect(reply).toContain('Messages spoken: 2');
    expect(reply).toContain('Cache hits: 1');
    expect(reply).toContain('Cache misses: 1');
    expect(reply).toContain('Synthesis errors: 1');
    expect(reply).toContain('Voice drops: 2');
    expect(reply).toContain('Reconnects: 1');
    expect(reply).toContain('top.gg votes: 3');
    expect(reply).toContain('Active players: 1');
    expect(reply).toContain('Servers: 3');
    expect(reply).toContain('Uptime:');
  });

  it('mostra zeros quando nenhum evento ocorreu ainda', async () => {
    const deps = makeStatsDeps();
    const i = makeStatsInteraction(true);
    await handleInteraction(i as unknown as import('discord.js').ChatInputCommandInteraction, deps);

    const reply = i.replies[0];
    // Migrado PT->EN (P16.2): /stats renderiza via t() em ingles por defeito.
    expect(reply).toContain('Messages spoken: 0');
    expect(reply).toContain('Cache hits: 0');
    expect(reply).toContain('Cache misses: 0');
    expect(reply).toContain('Synthesis errors: 0');
    expect(reply).toContain('Voice drops: 0');
    expect(reply).toContain('Reconnects: 0');
    expect(reply).toContain('top.gg votes: 0');
    expect(reply).toContain('Active players: 0');
  });

  it('bloqueia utilizadores sem ManageGuild', async () => {
    const deps = makeStatsDeps();
    const i = makeStatsInteraction(false); // não é admin
    await handleInteraction(i as unknown as import('discord.js').ChatInputCommandInteraction, deps);

    expect(i.replies).toHaveLength(1);
    // Migrado PT->EN: "You need the **Manage Server** permission to do that."
    expect(i.replies[0]).toMatch(/permission|Manage Server/i);
  });
});
