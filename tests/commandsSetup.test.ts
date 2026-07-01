import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PermissionFlagsBits, ChannelType } from 'discord.js';

// Mock de @discordjs/voice — o /setup passou a JUNTAR-SE a voz (reutiliza a
// logica de /join) quando o invocador esta num canal de voz com Connect+Speak,
// por isso os testes de caminho feliz constroem um GuildVoicePlayer REAL. Este
// mock (copiado do commandsJoin.test.ts) fornece o suficiente para o construtor
// do player: um AudioPlayer falso, entersState resolvido e uma conexao com
// subscribe/on/destroy.
const joinVoiceChannel = vi.fn();
const getVoiceConnection = vi.fn();
vi.mock('@discordjs/voice', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeAudioPlayer extends EventEmitter {
    play(): void {}
    stop(): void {}
  }
  return {
    joinVoiceChannel: (...args: unknown[]) => joinVoiceChannel(...args),
    getVoiceConnection: (...args: unknown[]) => getVoiceConnection(...args),
    createAudioPlayer: () => new FakeAudioPlayer(),
    createAudioResource: (path: string) => ({ path }),
    entersState: () => Promise.resolve(),
    AudioPlayerStatus: { Idle: 'idle' },
    VoiceConnectionStatus: {
      Disconnected: 'disconnected',
      Signalling: 'signalling',
      Connecting: 'connecting',
      Ready: 'ready',
    },
    StreamType: { Arbitrary: 'arbitrary' },
  };
});

import { handleInteraction, commandDefs } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { getGuildConfig } from '../src/store/guildConfig';
import type Database from 'better-sqlite3';

const GUILD = 'g-setup-test';

// Conexao falsa devolvida por joinVoiceChannel — so precisa de subscribe/on/destroy
// porque o GuildVoicePlayer real e construido no handler quando o /setup se junta
// a voz. Reposta antes de CADA teste (o /setup so se junta no caminho feliz).
beforeEach(() => {
  joinVoiceChannel.mockReset();
  getVoiceConnection.mockReset();
  joinVoiceChannel.mockReturnValue({
    subscribe: () => {},
    on: () => {},
    destroy: () => {},
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

function makeSetupDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    db,
    // queueCap/inactivityMs sao lidos pelo construtor do GuildVoicePlayer quando o
    // /setup se junta a voz no caminho feliz.
    config: { queueCap: 10, inactivityMs: 1000 },
    availableModels: ['en_US-amy-medium'],
  } as unknown as BotDeps;
}

// Constroi um canal de texto "completo" como o que vive em guild.channels.cache:
// tem .permissionsFor(me) que devolve { has(flag) }. `granted` e o conjunto de
// flags que o bot tem nesse canal.
function makeTextChannel(id: string, granted: bigint[]): unknown {
  return {
    id,
    type: ChannelType.GuildText,
    permissionsFor: () => ({ has: (flag: bigint) => granted.includes(flag) }),
  };
}

// Canal de voz onde o invocador esta (member.voice.channel). `granted` sao as
// flags do bot nesse canal de voz.
function makeVoiceChannel(id: string, name: string, granted: bigint[]): unknown {
  return {
    id,
    name,
    type: ChannelType.GuildVoice,
    permissionsFor: () => ({ has: (flag: bigint) => granted.includes(flag) }),
  };
}

interface FakeInteraction {
  commandName: string;
  guildId: string;
  replies: string[];
  reply: (opts: { content: string }) => Promise<void>;
  isRepliable: () => boolean;
  replied: boolean;
  deferred: boolean;
  member: unknown;
  guild: unknown;
  channel: unknown;
  options: unknown;
}

function makeSetupInteraction(opts: {
  admin?: boolean;
  // canal passado na opcao "canal" (partial APIChannel) ou null/omitido
  optionChannel?: { id: string } | null;
  // canal da interacao (fallback quando a opcao e omitida)
  interactionChannel?: unknown;
  // canal de voz onde o invocador esta (ou null se nao esta em voz)
  voiceChannel?: unknown;
  // canais "completos" indexados por id (simula guild.channels.cache)
  guildChannels?: Record<string, unknown>;
}): FakeInteraction {
  const replies: string[] = [];
  const admin = opts.admin ?? true;
  const cache = opts.guildChannels ?? {};
  return {
    commandName: 'setup',
    guildId: GUILD,
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content: string }) => {
      replies.push(o.content);
    },
    member: {
      permissions: { has: () => admin },
      voice: { channel: opts.voiceChannel ?? null },
    },
    guild: {
      // voiceAdapterCreator e usado por joinVoiceChannel quando o /setup se junta
      // a voz no caminho feliz.
      voiceAdapterCreator: {},
      channels: {
        cache: { get: (id: string) => cache[id] },
      },
    },
    channel: opts.interactionChannel ?? null,
    options: {
      getChannel: (_name: string) => opts.optionChannel ?? null,
    },
  };
}

// ── (a) tudo presente + invocador em VC → sucesso ─────────────────────────────

describe('/setup — caminho feliz (todas as perms + em VC)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('grava ttsChannelId + autoread e responde sucesso', async () => {
    const textCh = makeTextChannel('ch-text', [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ]);
    const i = makeSetupInteraction({
      interactionChannel: textCh,
      guildChannels: { 'ch-text': textCh },
      voiceChannel: makeVoiceChannel('vc-1', 'Sala', [
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ]),
    });
    const deps = makeSetupDeps(db);
    await handleInteraction(i as any, deps);

    const cfg = getGuildConfig(db, GUILD);
    expect(cfg.ttsChannelId).toBe('ch-text');
    expect(cfg.autoread).toBe(true);

    const text = i.replies.join('\n');
    expect(text).toMatch(/ch-text/); // menciona o canal alvo
    // Migrado PT->EN (P16.2): "Auto-read: on"
    expect(text).toMatch(/auto-?read|auto-?leitura/i);
    // checklist com marcas de OK (sem "missing"/"falta" nas tres perms)
    expect(text).toMatch(/ViewChannel/i);
    expect(text).toMatch(/Connect/i);
    expect(text).toMatch(/Speak/i);
    expect(text).not.toMatch(/missing|falta/i);

    // /setup passou a juntar-se JA a voz no caminho feliz (reutiliza a logica de
    // /join): confirma que se juntou e limpa o player para nao deixar timers.
    expect(joinVoiceChannel).toHaveBeenCalledTimes(1);
    expect(text).toMatch(/Sala/); // menciona o canal de voz onde entrou
    deps.players.get(GUILD)?.destroy();
  });
});

// ── (b) faltam Connect/Speak → avisa MAS grava canal+autoread ────────────────

describe('/setup — faltam perms de voz', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('lista o que falta mas grava canal+autoread na mesma', async () => {
    const textCh = makeTextChannel('ch-text', [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ]);
    const i = makeSetupInteraction({
      interactionChannel: textCh,
      guildChannels: { 'ch-text': textCh },
      // bot nao tem Connect nem Speak no canal de voz do invocador
      voiceChannel: makeVoiceChannel('vc-1', 'Sala', []),
    });
    const deps = makeSetupDeps(db);
    await handleInteraction(i as any, deps);

    // Config gravada apesar das perms de voz em falta
    const cfg = getGuildConfig(db, GUILD);
    expect(cfg.ttsChannelId).toBe('ch-text');
    expect(cfg.autoread).toBe(true);

    const text = i.replies.join('\n');
    // Migrado PT->EN (P16.2): "❌ {label} — missing"
    expect(text).toMatch(/missing/i); // reporta o que falta
    // Afirma o MARCADOR DE FALTA junto de cada rotulo (nao basta o rotulo aparecer:
    // ele e impresso em qualquer estado). `[^\n]*` confina a uma linha.
    expect(text).toMatch(/❌[^\n]*Connect|Connect[^\n]*missing/i);
    expect(text).toMatch(/❌[^\n]*Speak|Speak[^\n]*missing/i);

    // RECONCILIACAO /setup vs /join: sem Connect/Speak, o /setup NAO deve juntar-se
    // a voz (so avisa no checklist). Se o guard 'ok && ok' regredisse e o setup se
    // juntasse sempre, isto apanhava.
    expect(joinVoiceChannel).not.toHaveBeenCalled();
    expect(deps.players.get(GUILD)).toBeUndefined();
  });
});

// ── (b2) falta SendMessages no canal de texto → avisa MAS grava ──────────────

describe('/setup — falta SendMessages no canal de texto', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('marca a perm de texto como em falta mas grava canal+autoread', async () => {
    // ViewChannel presente, SendMessages ausente: cada perm de texto tem a sua
    // propria linha de checklist (contrato 3a). Mesmo assim grava (politica de
    // friccao minima). Este e o caso que prova a precisao do P8.1: so SendMessages
    // pode aparecer em falta — ViewChannel NAO pode ser marcada erradamente.
    const textCh = makeTextChannel('ch-text', [PermissionFlagsBits.ViewChannel]);
    const i = makeSetupInteraction({
      interactionChannel: textCh,
      guildChannels: { 'ch-text': textCh },
      voiceChannel: makeVoiceChannel('vc-1', 'Sala', [
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ]),
    });
    const deps = makeSetupDeps(db);
    await handleInteraction(i as any, deps);

    // Gravado apesar da perm de texto em falta
    const cfg = getGuildConfig(db, GUILD);
    expect(cfg.ttsChannelId).toBe('ch-text');
    expect(cfg.autoread).toBe(true);

    // Checklist reporta SendMessages como em falta — e ViewChannel NAO em falta.
    // `[^\n]*` confina o match a uma linha: se ViewChannel regredisse para
    // "❌ ViewChannel — falta", nao haveria ✅ antes de ViewChannel nessa linha e
    // o assert falharia (e o regression guard real do P8.1).
    const text = i.replies.join('\n');
    // Migrado PT->EN (P16.2): "❌ {label} — missing"
    expect(text).toMatch(/missing/i);
    expect(text).toMatch(/❌[^\n]*SendMessages|SendMessages[^\n]*missing/i);
    expect(text).toMatch(/✅[^\n]*ViewChannel/i);

    // Connect+Speak presentes na voz -> /setup juntou-se; limpar o player.
    deps.players.get(GUILD)?.destroy();
  });
});

// ── (c) invocador NAO em VC → grava + nota que voz nao foi verificada ─────────

describe('/setup — invocador fora de um canal de voz', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('grava canal+autoread e nota que a voz sera verificada no /join', async () => {
    const textCh = makeTextChannel('ch-text', [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ]);
    const i = makeSetupInteraction({
      interactionChannel: textCh,
      guildChannels: { 'ch-text': textCh },
      voiceChannel: null, // nao esta em voz
    });
    const deps = makeSetupDeps(db);
    await handleInteraction(i as any, deps);

    const cfg = getGuildConfig(db, GUILD);
    expect(cfg.ttsChannelId).toBe('ch-text');
    expect(cfg.autoread).toBe(true);

    const text = i.replies.join('\n');
    // estado "nao verificado" (nao "falta"): menciona o /join
    // Migrado PT->EN (P16.2): "… not checked yet (I'll verify it on /join)"
    expect(text).toMatch(/\/join/i);
    expect(text).toMatch(/verify|checked/i);

    // RECONCILIACAO /setup vs /join: fora de um canal de voz nao ha como verificar
    // Connect/Speak, por isso o /setup NAO se junta (deixa isso para o /join).
    expect(joinVoiceChannel).not.toHaveBeenCalled();
    expect(deps.players.get(GUILD)).toBeUndefined();
  });
});

// ── (d) opcao "canal" usada → usa esse canal, nao o da interacao ─────────────

describe('/setup — opcao canal explicita', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('usa o canal da opcao (resolvido via cache) e ignora o da interacao', async () => {
    // canal da opcao chega como partial (so id); o canal completo vem da cache
    const fullOptCh = makeTextChannel('ch-option', [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ]);
    const interactionCh = makeTextChannel('ch-interaction', [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ]);
    const i = makeSetupInteraction({
      optionChannel: { id: 'ch-option' },
      interactionChannel: interactionCh,
      guildChannels: { 'ch-option': fullOptCh, 'ch-interaction': interactionCh },
      voiceChannel: makeVoiceChannel('vc-1', 'Sala', [
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ]),
    });
    const deps = makeSetupDeps(db);
    await handleInteraction(i as any, deps);

    expect(getGuildConfig(db, GUILD).ttsChannelId).toBe('ch-option');
    expect(i.replies.join('\n')).toMatch(/ch-option/);
    expect(i.replies.join('\n')).not.toMatch(/ch-interaction/);

    // Invocador em voz com Connect+Speak -> /setup tambem se juntou; limpar player.
    deps.players.get(GUILD)?.destroy();
  });
});

// ── (e) canal alvo nao e de texto → erro claro, sem crash, sem gravar ────────

describe('/setup — canal alvo nao e de texto', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('rejeita com mensagem clara e nao grava nada', async () => {
    const voiceAsTarget = {
      id: 'ch-voice',
      type: ChannelType.GuildVoice,
      permissionsFor: () => ({ has: () => true }),
    };
    const i = makeSetupInteraction({
      interactionChannel: voiceAsTarget,
      guildChannels: { 'ch-voice': voiceAsTarget },
      voiceChannel: null,
    });
    const deps = makeSetupDeps(db);
    await handleInteraction(i as any, deps);

    // Migrado PT->EN (P16.2): "… has to be a text channel …"
    expect(i.replies.some((r) => /text channel|texto/i.test(r))).toBe(true);
    // nada gravado
    expect(getGuildConfig(db, GUILD).ttsChannelId).toBeNull();
    expect(getGuildConfig(db, GUILD).autoread).toBe(false);
  });

  it('nao rebenta quando nao ha canal algum (opcao omitida e sem canal de interacao)', async () => {
    const i = makeSetupInteraction({
      interactionChannel: null,
      voiceChannel: null,
    });
    const deps = makeSetupDeps(db);
    await handleInteraction(i as any, deps);

    expect(i.replies.length).toBeGreaterThan(0);
    // mensagem real do handler: pede para indicar um canal de texto
    // Migrado PT->EN (P16.2): "I couldn't tell which channel to use. …"
    expect(i.replies.join('\n')).toMatch(/which channel|text channel|canal de texto/i);
    // nada gravado: nem canal nem autoread
    expect(getGuildConfig(db, GUILD).ttsChannelId).toBeNull();
    expect(getGuildConfig(db, GUILD).autoread).toBe(false);
  });
});

// ── (f) nao-admin → rejeitado pelo guard in-handler, sem gravar ──────────────

describe('/setup — gating de admin', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('rejeita nao-admin e nao grava config', async () => {
    const textCh = makeTextChannel('ch-text', [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ]);
    const i = makeSetupInteraction({
      admin: false,
      interactionChannel: textCh,
      guildChannels: { 'ch-text': textCh },
      voiceChannel: makeVoiceChannel('vc-1', 'Sala', [
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ]),
    });
    const deps = makeSetupDeps(db);
    await handleInteraction(i as any, deps);

    expect(i.replies.some((r) => /Gerir Servidor|permiss/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).ttsChannelId).toBeNull();
    expect(getGuildConfig(db, GUILD).autoread).toBe(false);
  });
});

// ── registo do comando ────────────────────────────────────────────────────────

describe('/setup — definicao do comando', () => {
  it('esta registado em commandDefs como comando top-level admin-only', () => {
    const def = commandDefs.find((c) => c.name === 'setup');
    expect(def).toBeDefined();
    // ManageGuild = bit 0x20 = "32" (string) no campo default_member_permissions
    expect(def?.default_member_permissions).toBe(
      PermissionFlagsBits.ManageGuild.toString(),
    );
  });

  it('tem uma opcao "canal" opcional do tipo text channel', () => {
    const def = commandDefs.find((c) => c.name === 'setup');
    const opt = def?.options?.find((o) => o.name === 'canal');
    expect(opt).toBeDefined();
    expect(opt?.required ?? false).toBe(false);
  });
});
