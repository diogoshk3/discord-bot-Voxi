import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { handleMessage } from '../src/commands/messageHandler';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';
import { DuplicateTracker } from '../src/moderation/antispam';

const GUILD = 'g-antispam';
const CHAN = 'chan-1';
const USER = 'user-1';

const AVAILABLE = ['en_US-amy-medium', 'pt_PT-tugao-medium'];

function makeDeps(db: Database.Database, say: ReturnType<typeof vi.fn>): BotDeps {
  const players = new Map<string, unknown>();
  players.set(GUILD, { say });
  return {
    client: { user: { id: 'bot-1' }, users: { cache: { get: () => undefined } } },
    db,
    players,
    limiters: new Map(),
    availableModels: AVAILABLE,
    config: { defaultVoice: 'de_DE-thorsten-medium', defaultSpeed: 1.0, messageLeadMs: 0 },
    dupTracker: new DuplicateTracker(),
  } as unknown as BotDeps;
}

function makeMsg(content: string): any {
  return {
    author: { bot: false, id: USER },
    guild: {
      members: { cache: { get: () => undefined } },
      channels: { cache: { get: () => undefined } },
    },
    guildId: GUILD,
    channelId: CHAN,
    content,
    member: { roles: { cache: { has: () => false } } },
    mentions: { has: () => false, repliedUser: null },
    reference: null,
  };
}

const SPAM = Array(39).fill('POKEBOLAS').join(' ');
const NORMAL = 'bom dia a todos espero que tenham um excelente fim de semana com muita saude';
// Mensagem grande (≥40 chars) e DIVERSA (não é repetição-spam), para exercitar o dup tracker.
const BIG = 'malta vamos jogar valorant hoje à noite por volta das nove horas quem alinha comigo';

describe('handleMessage — anti-spam (opt-in por guild)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
    setGuildConfig(db, GUILD, { autoread: true, ttsChannelId: CHAN, defaultVoice: '' });
  });
  afterEach(() => {
    db.close();
  });

  it('antispam ON: repetição massiva ("POKEBOLAS" ×39) NÃO é lida', async () => {
    setGuildConfig(db, GUILD, { antispam: true });
    const say = vi.fn().mockResolvedValue(undefined);
    await handleMessage(makeMsg(SPAM), makeDeps(db, say));
    expect(say).not.toHaveBeenCalled();
  });

  it('antispam OFF (default): a mesma repetição É lida', async () => {
    const say = vi.fn().mockResolvedValue(undefined);
    await handleMessage(makeMsg(SPAM), makeDeps(db, say));
    expect(say).toHaveBeenCalledTimes(1);
  });

  it('antispam ON: mensagem normal É lida (sem falso positivo)', async () => {
    setGuildConfig(db, GUILD, { antispam: true });
    const say = vi.fn().mockResolvedValue(undefined);
    await handleMessage(makeMsg(NORMAL), makeDeps(db, say));
    expect(say).toHaveBeenCalledTimes(1);
  });

  it('antispam ON: a 2.ª mensagem grande IDÊNTICA seguida é suprimida (a 1.ª lê-se)', async () => {
    setGuildConfig(db, GUILD, { antispam: true });
    const say = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, say); // MESMO dupTracker nas duas chamadas
    await handleMessage(makeMsg(BIG), deps);
    await handleMessage(makeMsg(BIG), deps);
    expect(say).toHaveBeenCalledTimes(1);
  });

  it('antispam OFF: duas mensagens grandes idênticas são ambas lidas', async () => {
    const say = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, say);
    await handleMessage(makeMsg(BIG), deps);
    await handleMessage(makeMsg(BIG), deps);
    expect(say).toHaveBeenCalledTimes(2);
  });
});
