import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { handleMessage } from '../src/commands/messageHandler';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';
import { setUserVoice } from '../src/store/userVoice';
import { setDetection } from '../src/store/langDetect';

const GUILD = 'g-langdetect';
const CHAN = 'chan-1';
const USER = 'user-1';

// Modelos: EN + PT (para a deteccao poder trocar por prefixo). Fallback global de_.
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
    config: { defaultVoice: 'de_DE-thorsten-medium', defaultSpeed: 1.0 },
  } as unknown as BotDeps;
}

// Mensagem de auto-leitura no canal CHAN, texto PORTUGUES longo (franc deteta PT).
function makePtMessage(): any {
  return {
    author: { bot: false, id: USER },
    guild: {
      members: { cache: { get: () => undefined } },
      channels: { cache: { get: () => undefined } },
    },
    guildId: GUILD,
    channelId: CHAN,
    content:
      'bom dia a todos os membros deste servidor espero que estejam todos bem e com muita saude hoje',
    member: { roles: { cache: { has: () => false } } },
    mentions: { has: () => false, repliedUser: null },
    reference: null,
  };
}

describe('handleMessage — toggle de deteccao de lingua por-utilizador', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
    setGuildConfig(db, GUILD, { autoread: true, ttsChannelId: CHAN, defaultVoice: '' });
  });
  afterEach(() => {
    db.close();
  });

  it('deteccao ON (default): texto PT com voz fixa inglesa => troca para voz pt_', async () => {
    setUserVoice(db, GUILD, USER, 'en_US-amy-medium', 1.0);
    const say = vi.fn().mockResolvedValue(undefined);
    await handleMessage(makePtMessage(), makeDeps(db, say));
    expect(say).toHaveBeenCalledTimes(1);
    const req = say.mock.calls[0][0];
    // Deteccao ligada: a lingua da mensagem manda => troca para pt_.
    expect(req.model.startsWith('pt_')).toBe(true);
  });

  it('deteccao OFF: texto PT com voz fixa inglesa => mantem a voz inglesa (singleVoice)', async () => {
    setUserVoice(db, GUILD, USER, 'en_US-amy-medium', 1.0);
    setDetection(db, GUILD, USER, false);
    const say = vi.fn().mockResolvedValue(undefined);
    await handleMessage(makePtMessage(), makeDeps(db, say));
    expect(say).toHaveBeenCalledTimes(1);
    const req = say.mock.calls[0][0];
    // Deteccao desligada: usa a voz FIXA do user, mesmo com texto de outra lingua.
    expect(req.model).toBe('en_US-amy-medium');
    expect(req.singleVoice).toBe(true);
  });
});
