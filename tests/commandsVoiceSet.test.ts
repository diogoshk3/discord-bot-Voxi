import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock minimo de @discordjs/voice — nao e usado no /voice set|reset, mas o import
// de index.ts resolve-o (mesmo padrao do commandsVoiceList.test.ts).
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { getUserVoice } from '../src/store/userVoice';
import type Database from 'better-sqlite3';

const GUILD = 'g-vset';
const USER = 'u-vset';

function makeDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map<string, unknown>(),
    db,
    config: { defaultSpeed: 1.0, defaultVoice: '' },
    availableModels: ['en_US-amy-medium', 'pt_PT-tugao-medium'],
    limiters: new Map(),
  } as unknown as BotDeps;
}

function makeVoiceInteraction(opts: {
  sub: string;
  model?: string;
  speed?: number | null;
}) {
  const replies: string[] = [];
  return {
    commandName: 'voice',
    guildId: GUILD,
    user: { id: USER },
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content: string }) => {
      replies.push(o.content);
    },
    options: {
      getSubcommandGroup: (_required = false) => null,
      getSubcommand: () => opts.sub,
      getString: (_name: string, _required = false) => opts.model ?? null,
      getNumber: (_name: string) => (opts.speed === undefined ? null : opts.speed),
    },
  };
}

describe('/voice set — copy beginner-friendly', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('confirma com o NOME AMIGAVEL da voz e mantem o id cru copy-pasteavel', async () => {
    const i = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium' });
    await handleInteraction(i as any, makeDeps(db));

    expect(i.replies).toHaveLength(1);
    const out = i.replies[0];
    // Nome amigavel (lingua + voz) em vez do id cru como titulo.
    expect(out).toContain('English (US) — Amy');
    // O id cru continua presente (copy-pasteavel para reusar / partilhar).
    expect(out).toContain('en_US-amy-medium');
    // Comportamento inalterado: a voz foi mesmo gravada.
    expect(getUserVoice(db, GUILD, USER)?.model).toBe('en_US-amy-medium');
  });

  it('inclui o PROXIMO PASSO para o iniciante ouvir a voz (via /tts)', async () => {
    const i = makeVoiceInteraction({ sub: 'set', model: 'pt_PT-tugao-medium' });
    await handleInteraction(i as any, makeDeps(db));

    const out = i.replies[0];
    // Aponta para /tts (sempre funciona, sem depender de auto-read configurado).
    expect(out).toContain('/tts');
  });
});

describe('/voice reset — copy beginner-friendly', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('confirma o reset e aponta para /voice set / /voice list para escolher outra', async () => {
    const i = makeVoiceInteraction({ sub: 'reset' });
    await handleInteraction(i as any, makeDeps(db));

    expect(i.replies).toHaveLength(1);
    const out = i.replies[0];
    expect(out).toContain('/voice set');
    expect(out).toContain('/voice list');
  });
});
