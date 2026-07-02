import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock minimo de @discordjs/voice — nao usado no /voice detection, mas o import resolve-o.
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction, commandDefs } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { isDetectionOn, setDetection } from '../src/store/langDetect';
import type Database from 'better-sqlite3';

const GUILD = 'g-detection';
const USER = 'u-detection';

function makeDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    db,
    config: { defaultSpeed: 1.0 },
    availableModels: ['en_US-amy-medium'],
  } as unknown as BotDeps;
}

function makeDetectionInteraction(active: boolean) {
  const replies: string[] = [];
  return {
    commandName: 'voice',
    guildId: GUILD,
    user: { id: USER },
    locale: 'en-US',
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content: string }) => {
      replies.push(o.content);
    },
    options: {
      getSubcommandGroup: (_required = false) => null,
      getSubcommand: () => 'detection',
      getString: () => '',
      getNumber: () => null,
      getBoolean: (_name: string, _required = false) => active,
    },
  };
}

describe('/voice detection — toggle de deteccao automatica por-utilizador', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('detection active:false desliga a deteccao e responde a mencionar a voz fixa', async () => {
    const i = makeDetectionInteraction(false);
    await handleInteraction(i as any, makeDeps(db));
    expect(isDetectionOn(db, GUILD, USER)).toBe(false);
    // Mensagem OFF deve mencionar /voice set (a voz fixa passa a mandar).
    expect(i.replies.some((r) => /voice set|fixed|chosen/i.test(r))).toBe(true);
  });

  it('detection active:true volta a ligar a deteccao e confirma', async () => {
    setDetection(db, GUILD, USER, false);
    const i = makeDetectionInteraction(true);
    await handleInteraction(i as any, makeDeps(db));
    expect(isDetectionOn(db, GUILD, USER)).toBe(true);
    expect(i.replies.length).toBeGreaterThan(0);
    // Mensagem ON deve mencionar deteccao/mistura automatica.
    expect(i.replies.some((r) => /detect|automatic|mix/i.test(r))).toBe(true);
  });

  it('o comando /voice tem o subcomando detection registado com opcao boolean obrigatoria', () => {
    const voice = commandDefs.find((c) => c.name === 'voice');
    expect(voice).toBeDefined();
    const options = (voice as any).options as any[];
    const detection = options.find((o) => o.name === 'detection');
    expect(detection).toBeDefined();
    // subcomando (type 1) com uma opcao boolean (type 5) obrigatoria chamada 'active'
    expect(detection.type).toBe(1);
    const active = detection.options?.find((o: any) => o.name === 'active');
    expect(active).toBeDefined();
    expect(active.required).toBe(true);
    expect(active.type).toBe(5); // BOOLEAN
  });
});
