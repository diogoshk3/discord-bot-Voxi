import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock minimo de @discordjs/voice — o /game play nao liga a voz aqui (tictactoe é
// needsVoice:false), mas o modulo de comandos importa-o no topo.
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { grantGuildPremium } from '../src/store/premium';
import type Database from 'better-sqlite3';

const GUILD = 'g-gameplay-test';

function makeDeps(db: Database.Database, games: unknown): BotDeps {
  return {
    client: { user: { id: 'bot-1' }, channels: { cache: new Map(), fetch: async () => null } },
    players: new Map(),
    db,
    config: {},
    availableModels: ['en_US-amy-medium'],
    games,
  } as unknown as BotDeps;
}

/** Interação falsa do /game play com deferReply/editReply e um log de ordem. */
function makePlayInteraction(opts: { gameId?: string; channel?: unknown; calls?: string[] }) {
  const calls = opts.calls ?? [];
  const edits: string[] = [];
  const self = {
    commandName: 'game',
    guildId: GUILD,
    channelId: 'chan-1',
    channel: opts.channel ?? null,
    user: { id: 'u-1' },
    client: { channels: { cache: new Map(), fetch: async () => null } },
    calls,
    edits,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    deferReply: async () => {
      calls.push('defer');
      self.deferred = true;
    },
    editReply: async (content: string | { content: string }) => {
      calls.push('edit');
      edits.push(typeof content === 'string' ? content : content.content);
    },
    reply: async () => {
      calls.push('reply'); // o ramo play NÃO pode usar isto depois do fix
    },
    options: {
      getSubcommand: () => 'play',
      getSubcommandGroup: () => null,
      getString: (name: string) => (name === 'game' ? (opts.gameId ?? 'tictactoe') : null),
    },
  };
  return self;
}

describe('/game play — deferReply antes do REST + respostas via editReply', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('happy path com thread: defer ANTES do createThread, sucesso via editReply', async () => {
    const calls: string[] = [];
    const channel = {
      type: 0, // GuildText
      threads: {
        create: async () => {
          calls.push('createThread');
          return { id: 'thread-1' };
        },
      },
    };
    const games = { active: () => false, channelOf: () => null, start: () => 'started' };
    const i = makePlayInteraction({ channel, calls });
    await handleInteraction(i as any, makeDeps(db, games));

    // O ack (defer) tem de vir ANTES da chamada REST de criar a thread — era o bug.
    expect(calls[0]).toBe('defer');
    expect(calls.indexOf('defer')).toBeLessThan(calls.indexOf('createThread'));
    expect(i.deferred).toBe(true);
    expect(i.edits.length).toBe(1);
    expect(calls).not.toContain('reply'); // nunca usa i.reply depois do defer
  });

  it('já-ativo responde via editReply (sem i.reply)', async () => {
    const games = { active: () => true, channelOf: () => 'chan-9', start: () => 'started' };
    const i = makePlayInteraction({
      channel: { type: 0, threads: { create: async () => ({ id: 't' }) } },
    });
    await handleInteraction(i as any, makeDeps(db, games));
    expect(i.edits.length).toBe(1);
    expect(i.edits[0].length).toBeGreaterThan(0);
    expect(i.calls).not.toContain('reply');
  });

  it('sem thread (canal de voz) joga no próprio canal e responde via editReply', async () => {
    // Params tipados (guildId, channelId, ...) p/ o typecheck ler calls[0][1].
    const start = vi.fn(
      (_guildId: string, _channelId: string, ..._rest: unknown[]) => 'started' as const,
    );
    const games = { active: () => false, channelOf: () => null, start };
    // type:2 = GuildVoice -> createGameThread devolve null -> joga em chan-1
    const i = makePlayInteraction({ channel: { type: 2 } });
    await handleInteraction(i as any, makeDeps(db, games));
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][1]).toBe('chan-1'); // gameChannelId = canal invocador
    expect(i.edits.length).toBe(1);
    expect(i.calls).not.toContain('reply');
  });

  it('jogo desconhecido responde via editReply (early-return convertido)', async () => {
    const games = { active: () => false, channelOf: () => null, start: () => 'started' };
    const i = makePlayInteraction({ gameId: 'nope', channel: { type: 0 } });
    await handleInteraction(i as any, makeDeps(db, games));
    expect(i.edits.length).toBe(1);
    expect(i.calls).not.toContain('reply');
  });
});

describe('/game play — gate Premium (wordle, word-chain, chess)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  const freeGames = () => {
    const start = vi.fn((_g: string, _c: string, ..._r: unknown[]) => 'started' as const);
    return { games: { active: () => false, channelOf: () => null, start }, start };
  };

  for (const gameId of ['wordle', 'word-chain']) {
    it(`jogo Premium (${gameId}) SEM Premium -> responde locked e NÃO inicia`, async () => {
      const { games, start } = freeGames();
      const i = makePlayInteraction({ gameId, channel: { type: 0 } });
      await handleInteraction(i as any, makeDeps(db, games));
      expect(start).not.toHaveBeenCalled();
      expect(i.edits.length).toBe(1);
      expect(/Premium/i.test(i.edits[0])).toBe(true);
    });
  }

  it('jogo Premium (wordle) COM Premium do servidor -> inicia', async () => {
    grantGuildPremium(db, GUILD, 30, 'test', Date.now());
    const { games, start } = freeGames();
    const i = makePlayInteraction({ gameId: 'wordle', channel: { type: 2 } });
    await handleInteraction(i as any, makeDeps(db, games));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('jogo GRÁTIS (tictactoe) SEM Premium -> inicia normalmente (não afetado)', async () => {
    const { games, start } = freeGames();
    const i = makePlayInteraction({ gameId: 'tictactoe', channel: { type: 2 } });
    await handleInteraction(i as any, makeDeps(db, games));
    expect(start).toHaveBeenCalledTimes(1);
  });
});
