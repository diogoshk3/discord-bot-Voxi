import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PermissionFlagsBits, ChannelType } from 'discord.js';

// Mock minimo de @discordjs/voice — o /setup nao liga a voz, mas o modulo de
// comandos importa-o no topo, por isso o import precisa de resolver.
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction, commandDefs } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { getGuildConfig } from '../src/store/guildConfig';
import type Database from 'better-sqlite3';

const GUILD = 'g-setup-test';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeSetupDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    db,
    config: {},
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
    expect(text).toMatch(/auto-?leitura|autoread/i);
    // checklist com marcas de OK (sem "falta" nas tres perms)
    expect(text).toMatch(/ViewChannel/i);
    expect(text).toMatch(/Connect/i);
    expect(text).toMatch(/Speak/i);
    expect(text).not.toMatch(/falta/i);
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
    expect(text).toMatch(/falta/i); // reporta o que falta
    expect(text).toMatch(/Connect/i);
    expect(text).toMatch(/Speak/i);
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
    // ViewChannel presente, SendMessages ausente: a linha "ver/escrever" so e OK
    // com as DUAS (contrato 3a). Mesmo assim grava (politica de friccao minima).
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

    // Checklist reporta a perm de texto como em falta
    const text = i.replies.join('\n');
    expect(text).toMatch(/falta/i);
    expect(text).toMatch(/ViewChannel|escrever/i);
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
    expect(text).toMatch(/\/join/i);
    expect(text).toMatch(/verific/i);
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

    expect(i.replies.some((r) => /texto/i.test(r))).toBe(true);
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
    expect(getGuildConfig(db, GUILD).ttsChannelId).toBeNull();
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
