import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { handleMessage } from '../src/commands/messageHandler';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';
import { bumpTalk, getTopSpeakers } from '../src/store/talkStats';
import { CountGate } from '../src/moderation/countGate';

const GUILD = 'g-lb';
const CHAN = 'chan-tts';
const USER = 'user-1';
const AVAILABLE = ['en_US-amy-medium', 'pt_PT-tugao-medium'];

function makeDeps(
  db: Database.Database,
  say: ReturnType<typeof vi.fn>,
  opts: { record: boolean; lbSend: ReturnType<typeof vi.fn> },
): BotDeps {
  const players = new Map<string, unknown>();
  players.set(GUILD, { say });
  const ttsChannel = { send: opts.lbSend };
  return {
    client: {
      user: { id: 'bot-1' },
      users: { cache: { get: () => undefined } },
      channels: { cache: { get: (id: string) => (id === CHAN ? ttsChannel : undefined) } },
    },
    db,
    players,
    limiters: new Map(),
    availableModels: AVAILABLE,
    config: { defaultVoice: 'de_DE-thorsten-medium', defaultSpeed: 1.0, messageLeadMs: 0 },
    leaderboardPoster: { record: vi.fn().mockReturnValue(opts.record) },
  } as unknown as BotDeps;
}

function makeMsg(): any {
  return {
    author: { bot: false, id: USER, username: 'Ana' },
    guild: {
      members: { cache: { get: () => undefined } },
      channels: { cache: { get: () => undefined } },
    },
    guildId: GUILD,
    channelId: CHAN,
    channel: { send: vi.fn().mockResolvedValue(undefined) }, // msg channel (streak); irrelevant here
    content: 'ola malta tudo bem por aqui hoje neste servidor',
    member: { displayName: 'Ana', roles: { cache: { has: () => false } } },
    mentions: { has: () => false, repliedUser: null },
    reference: null,
  };
}

describe('handleMessage — automatic leaderboard (F2)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
    setGuildConfig(db, GUILD, { autoread: true, ttsChannelId: CHAN, defaultVoice: '' });
    // Seed talkers so getTopSpeakers returns rows.
    bumpTalk(db, GUILD, 'top-user', new Date());
  });
  afterEach(() => {
    db.close();
  });

  it('poster decides to post -> sends the leaderboard in the /setup channel, WITHOUT pinging', async () => {
    const lbSend = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(true);
    await handleMessage(makeMsg(), makeDeps(db, say, { record: true, lbSend }));
    expect(say).toHaveBeenCalledTimes(1);
    expect(lbSend).toHaveBeenCalledTimes(1);
    const payload = lbSend.mock.calls[0][0];
    expect(String(payload.content)).toContain('Top talkers');
    expect(payload.allowedMentions).toEqual({ parse: [] }); // pings no one
  });

  it('poster decides NOT to post -> sends nothing', async () => {
    const lbSend = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(true);
    await handleMessage(makeMsg(), makeDeps(db, say, { record: false, lbSend }));
    expect(say).toHaveBeenCalledTimes(1);
    expect(lbSend).not.toHaveBeenCalled();
  });

  it('queue full (say false) -> does not count or post (record is not even called)', async () => {
    const lbSend = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(false);
    const deps = makeDeps(db, say, { record: true, lbSend });
    await handleMessage(makeMsg(), deps);
    expect(lbSend).not.toHaveBeenCalled();
    expect((deps.leaderboardPoster as any).record).not.toHaveBeenCalled();
  });

  it('count gate: a burst of identical messages is SPOKEN each time but COUNTED once', async () => {
    const lbSend = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(true);
    const deps: BotDeps = {
      ...makeDeps(db, say, { record: false, lbSend }),
      countGate: new CountGate(),
    };
    await handleMessage(makeMsg(), deps); // 1st: counts
    await handleMessage(makeMsg(), deps); // same content, <5s later: spoken, NOT counted
    await handleMessage(makeMsg(), deps); // idem
    expect(say).toHaveBeenCalledTimes(3); // every message is still read aloud
    const me = getTopSpeakers(db, GUILD, new Date()).find((r) => r.userId === USER);
    expect(me?.count).toBe(1); // only the first message inflated the leaderboard
  });
});
