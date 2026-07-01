import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock minimo de @discordjs/voice — o /voice abbrev nao liga a voz, mas o import
// de index.ts resolve-o.
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { getUserAbbrev, addUserAbbrev } from '../src/store/userAbbrev';
import type Database from 'better-sqlite3';

const GUILD = 'g-abbrev';
const USER = 'u-abbrev';

function makeDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map<string, unknown>(),
    db,
    config: { defaultSpeed: 1.0, defaultVoice: '' },
    availableModels: ['en_US-amy-medium'],
    limiters: new Map(),
  } as unknown as BotDeps;
}

/** Interacao /voice abbrev <sub> com opcoes termo/leitura. */
function makeAbbrevInteraction(opts: {
  sub: 'add' | 'remove' | 'list';
  termo?: string;
  leitura?: string;
  userId?: string;
}) {
  const replies: string[] = [];
  const optionsMap: Record<string, string> = {};
  if (opts.termo !== undefined) optionsMap.term = opts.termo;
  if (opts.leitura !== undefined) optionsMap.reading = opts.leitura;
  return {
    commandName: 'voice',
    guildId: GUILD,
    user: { id: opts.userId ?? USER },
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content: string }) => {
      replies.push(o.content);
    },
    options: {
      getSubcommandGroup: (_required = false) => 'abbrev',
      getSubcommand: () => opts.sub,
      getString: (name: string, _required?: boolean) => optionsMap[name] ?? '',
      getNumber: () => null,
    },
  };
}

describe('/voice abbrev', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('add cria uma abreviatura pessoal e confirma', async () => {
    const i = makeAbbrevInteraction({ sub: 'add', termo: 'brb', leitura: 'bora rapaz' });
    await handleInteraction(i as any, makeDeps(db));
    expect(getUserAbbrev(db, USER)).toEqual([{ term: 'brb', replacement: 'bora rapaz' }]);
    expect(i.replies.join('\n')).toMatch(/brb|bora rapaz/i);
  });

  it('add com termo invalido (com espacos) rejeita com mensagem e nao persiste', async () => {
    const i = makeAbbrevInteraction({ sub: 'add', termo: 'a b', leitura: 'algo' });
    await handleInteraction(i as any, makeDeps(db));
    expect(getUserAbbrev(db, USER)).toEqual([]);
    expect(i.replies.join('\n')).toMatch(/single word|unica palavra/i);
  });

  it('add com leitura vazia rejeita', async () => {
    const i = makeAbbrevInteraction({ sub: 'add', termo: 'brb', leitura: '   ' });
    await handleInteraction(i as any, makeDeps(db));
    expect(getUserAbbrev(db, USER)).toEqual([]);
    expect(i.replies.join('\n')).toMatch(/empty|vazia/i);
  });

  it('add no cap de 10 rejeita o 11.o termo NOVO com mensagem amigavel', async () => {
    for (let n = 0; n < 10; n++) addUserAbbrev(db, USER, `t${n}`, `r${n}`);
    const i = makeAbbrevInteraction({ sub: 'add', termo: 'extra', leitura: 'demais' });
    await handleInteraction(i as any, makeDeps(db));
    expect(getUserAbbrev(db, USER)).toHaveLength(10);
    expect(i.replies.join('\n')).toMatch(/limit|limite|10/i);
  });

  it('remove apaga a abreviatura e confirma', async () => {
    addUserAbbrev(db, USER, 'brb', 'bora rapaz');
    const i = makeAbbrevInteraction({ sub: 'remove', termo: 'brb' });
    await handleInteraction(i as any, makeDeps(db));
    expect(getUserAbbrev(db, USER)).toEqual([]);
    expect(i.replies.join('\n')).toMatch(/removed|removi/i);
  });

  it('list vazio mostra o cabecalho com 0/10', async () => {
    const i = makeAbbrevInteraction({ sub: 'list' });
    await handleInteraction(i as any, makeDeps(db));
    expect(i.replies.join('\n')).toMatch(/0\/10/);
  });

  it('list mostra as abreviaturas e o contador usado', async () => {
    addUserAbbrev(db, USER, 'brb', 'bora rapaz');
    addUserAbbrev(db, USER, 'js', 'JavaScript');
    const i = makeAbbrevInteraction({ sub: 'list' });
    await handleInteraction(i as any, makeDeps(db));
    const text = i.replies.join('\n');
    expect(text).toMatch(/2\/10/);
    expect(text).toContain('brb');
    expect(text).toContain('js');
  });

  it('e GLOBAL: dois users tem listas independentes', async () => {
    const i1 = makeAbbrevInteraction({ sub: 'add', termo: 'brb', leitura: 'bora rapaz', userId: 'u-A' });
    await handleInteraction(i1 as any, makeDeps(db));
    expect(getUserAbbrev(db, 'u-A')).toHaveLength(1);
    expect(getUserAbbrev(db, 'u-B')).toHaveLength(0);
  });
});
