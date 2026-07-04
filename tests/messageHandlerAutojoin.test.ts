/**
 * Autojoin (Vaga 2): quando o Voxi não está em call e o autor está num canal de voz,
 * entra sozinho (se autojoin ON e tiver Connect/Speak). `createVoiceSession` (que abre
 * a ligação real de voz) é MOCKADA — aqui testamos só a DECISÃO + o encaminhamento.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';

vi.mock('../src/voice/session', () => ({ createVoiceSession: vi.fn() }));

import { handleMessage } from '../src/commands/messageHandler';
import { createVoiceSession } from '../src/voice/session';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';

const GUILD = 'g-aj';
const CHAN = 'chan-autoread';
const BOT_ID = 'bot-1';

function makeDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: BOT_ID }, users: { cache: { get: () => undefined } } },
    db,
    players: new Map(), // SEM player -> força o caminho de autojoin
    limiters: new Map(),
    lastSpeaker: new Map(),
    availableModels: ['en_US-amy-medium'],
    config: { defaultVoice: 'en_US-amy-medium', defaultSpeed: 1.0, messageLeadMs: 0 },
  } as unknown as BotDeps;
}

function makeMessage(opts: { inVoice?: boolean; canJoin?: boolean } = {}): any {
  const inVoice = opts.inVoice ?? true;
  const canJoin = opts.canJoin ?? true;
  const channel = inVoice
    ? { id: 'vc-1', isVoiceBased: () => true, permissionsFor: () => ({ has: () => canJoin }) }
    : null;
  return {
    author: { bot: false, id: 'user-1', username: undefined },
    guild: {
      voiceAdapterCreator: () => ({}),
      members: { cache: { get: () => undefined } },
      channels: { cache: { get: () => undefined } },
    },
    guildId: GUILD,
    channelId: CHAN,
    content: 'olá pessoal',
    member: { displayName: undefined, voice: { channel }, roles: { cache: { has: () => true } } },
    mentions: { has: () => false, repliedUser: null },
    reference: null,
  };
}

describe('handleMessage — autojoin', () => {
  let db: Database.Database;
  let say: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(createVoiceSession).mockReset();
    db = initDb(':memory:');
    say = vi.fn().mockResolvedValue(undefined);
    // createVoiceSession mockada devolve um "player" com say espiado.
    vi.mocked(createVoiceSession).mockReturnValue({ say } as never);
    setGuildConfig(db, GUILD, { autoread: true, ttsChannelId: CHAN, enabled: true });
  });

  afterEach(() => db.close());

  it('autojoin ON + autor em voz + perms → cria sessão e fala', async () => {
    setGuildConfig(db, GUILD, { autojoin: true });
    await handleMessage(makeMessage(), makeDeps(db));
    expect(createVoiceSession).toHaveBeenCalledTimes(1);
    expect(createVoiceSession).toHaveBeenCalledWith(
      expect.anything(),
      GUILD,
      'vc-1',
      expect.any(Function),
    );
    expect(say).toHaveBeenCalledTimes(1);
  });

  it('autojoin OFF → não entra nem fala (sem player)', async () => {
    setGuildConfig(db, GUILD, { autojoin: false });
    await handleMessage(makeMessage(), makeDeps(db));
    expect(createVoiceSession).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  it('autojoin ON mas autor FORA de voz → não entra', async () => {
    setGuildConfig(db, GUILD, { autojoin: true });
    await handleMessage(makeMessage({ inVoice: false }), makeDeps(db));
    expect(createVoiceSession).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  it('autojoin ON mas SEM Connect/Speak → não entra', async () => {
    setGuildConfig(db, GUILD, { autojoin: true });
    await handleMessage(makeMessage({ canJoin: false }), makeDeps(db));
    expect(createVoiceSession).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });
});
