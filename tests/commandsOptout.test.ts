import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock minimo de @discordjs/voice — nao e usado no /voice optout/optin, mas o import resolve-o.
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { isOptedOut, setOptOut } from '../src/store/optout';
import type Database from 'better-sqlite3';

const GUILD = 'g-optout';
const USER = 'u-optout';

function makeDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    db,
    config: { defaultSpeed: 1.0 },
    availableModels: ['en_US-amy-medium'],
  } as unknown as BotDeps;
}

function makeVoiceInteraction(sub: string) {
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
      getSubcommand: () => sub,
      getString: () => '',
      getNumber: () => null,
    },
  };
}

describe('/voice optout / optin — opt-out por utilizador (sem gate de admin)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('optout marca o utilizador como opted-out e responde claramente', async () => {
    const i = makeVoiceInteraction('optout');
    await handleInteraction(i as any, makeDeps(db));
    expect(isOptedOut(db, GUILD, USER)).toBe(true);
    // Migrado PT->EN: "You won't be read automatically anymore. …"
    expect(i.replies.some((r) => /automatically|optin/i.test(r))).toBe(true);
  });

  it('optin limpa o opt-out e responde claramente', async () => {
    setOptOut(db, GUILD, USER);
    const i = makeVoiceInteraction('optin');
    await handleInteraction(i as any, makeDeps(db));
    expect(isOptedOut(db, GUILD, USER)).toBe(false);
    // Migrado PT->EN: "You'll be read automatically again."
    expect(i.replies.some((r) => /automatically|read/i.test(r))).toBe(true);
  });

  it('optout depois optin: o estado persiste corretamente entre comandos', async () => {
    await handleInteraction(makeVoiceInteraction('optout') as any, makeDeps(db));
    expect(isOptedOut(db, GUILD, USER)).toBe(true);
    await handleInteraction(makeVoiceInteraction('optin') as any, makeDeps(db));
    expect(isOptedOut(db, GUILD, USER)).toBe(false);
  });
});
