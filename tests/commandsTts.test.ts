import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock minimo de @discordjs/voice — nao e usado no caminho do /tts (o player e
// injectado nas deps), mas o import de index.ts precisa de resolver.
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import type Database from 'better-sqlite3';

const GUILD = 'g-tts';
const USER = 'u-tts';

function makeDeps(db: Database.Database, player?: { say: ReturnType<typeof vi.fn> }): BotDeps {
  const deps = {
    client: { user: { id: 'bot-1' }, users: { cache: new Map() } },
    players: new Map<string, unknown>(),
    db,
    config: { defaultSpeed: 1.0, defaultVoice: '' },
    availableModels: ['en_US-amy-medium'],
    limiters: new Map(),
  } as unknown as BotDeps;
  if (player) {
    (deps.players as Map<string, unknown>).set(GUILD, player);
  }
  return deps;
}

function makeTtsInteraction(text: string) {
  const replies: string[] = [];
  return {
    commandName: 'tts',
    guildId: GUILD,
    user: { id: USER },
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    deferReply: async function (this: { deferred: boolean }) {
      this.deferred = true;
    },
    editReply: async (o: string | { content: string }) => {
      replies.push(typeof o === 'string' ? o : o.content);
    },
    // guild.members.cache / channels.cache usados pelo cleanText resolver.
    guild: {
      members: { cache: new Map() },
      channels: { cache: new Map() },
    },
    options: {
      getString: (name: string, _required?: boolean) => {
        if (name === 'text') return text;
        return null;
      },
      getNumber: () => null,
    },
  };
}

describe('/tts — say() cheio nao mente "queued"', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('quando say() devolve true responde "queued"', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    const i = makeTtsInteraction('ola mundo');

    await handleInteraction(i as any, deps);

    expect(say).toHaveBeenCalledOnce();
    // t('tts.queued', 'en') = "Got it — it's in the queue."
    expect(i.replies.some((r) => /queue/i.test(r))).toBe(true);
    expect(i.replies.some((r) => /busy/i.test(r))).toBe(false);
  });

  it('quando say() devolve false (fila cheia) responde "busy", NAO "queued"', async () => {
    const say = vi.fn().mockResolvedValue(false);
    const deps = makeDeps(db, { say });
    const i = makeTtsInteraction('ola mundo');

    await handleInteraction(i as any, deps);

    expect(say).toHaveBeenCalledOnce();
    // t('tts.busy', 'en') = "I'm busy right now — try again in a moment."
    expect(i.replies.some((r) => /busy/i.test(r))).toBe(true);
    expect(i.replies.some((r) => /queue/i.test(r))).toBe(false);
  });
});

describe('/tts — guard de vazio (nada legivel -> nao sintetiza)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  // ❤️ (U+2764 U+FE0F): antes do fix o VS16 sobrevivia -> resíduo truthy passava
  // o guard `if (!cleaned)` -> Piper sintetizava clipe vazio. Agora é ignorado.
  it('só emoji ❤️ (VS16) → nothingAfterClean, NÃO chama say', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    const i = makeTtsInteraction('❤️');

    await handleInteraction(i as any, deps);

    expect(say).not.toHaveBeenCalled();
    // t('tts.nothingAfterClean', 'en') fala em "nothing"/"read".
    expect(i.replies.some((r) => /nothing|read/i.test(r))).toBe(true);
  });

  it('só bandeira 🇦🇩 (regional indicators) → NÃO chama say', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    const i = makeTtsInteraction('🇦🇩');

    await handleInteraction(i as any, deps);

    expect(say).not.toHaveBeenCalled();
  });

  // Isola a mudança do guard: cleanText('!!!') = '!!!' (truthy) -> o antigo guard
  // deixava passar; o novo exige \p{L}\p{N}.
  it('só pontuação ("!!!") → NÃO chama say', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    const i = makeTtsInteraction('!!!');

    await handleInteraction(i as any, deps);

    expect(say).not.toHaveBeenCalled();
  });

  it('texto com dígitos ("$100") → chama say (contém \\p{N})', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    const i = makeTtsInteraction('$100');

    await handleInteraction(i as any, deps);

    expect(say).toHaveBeenCalledOnce();
  });

  // Beginner-friendly: sem player, a mensagem GUIA o principiante (entra num canal
  // de voz E corre /join), em vez de so constatar o estado.
  it('sem player responde uma mensagem que GUIA a juntar-se a voz e correr /join', async () => {
    const say = vi.fn();
    const deps = makeDeps(db); // sem player
    const i = makeTtsInteraction('Hello everyone!');

    await handleInteraction(i as any, deps);

    expect(say).not.toHaveBeenCalled();
    const text = i.replies.join('\n');
    expect(text).toMatch(/\/join/); // aponta o comando a correr
    expect(text).toMatch(/voice channel/i); // diz para entrar num canal de voz
  });

  // nothingAfterClean deve ser instrutivo (dizer o que fazer), nao so terse.
  it('só emoji → nothingAfterClean pede texto legivel/normal', async () => {
    const say = vi.fn();
    const deps = makeDeps(db, { say });
    const i = makeTtsInteraction('❤️');

    await handleInteraction(i as any, deps);

    expect(say).not.toHaveBeenCalled();
    const text = i.replies.join('\n');
    // continua a falar de "nothing/read" (compat) mas agora sugere texto normal
    expect(text).toMatch(/nothing|read/i);
    expect(text).toMatch(/some text|letters|words|normal/i);
  });
});
