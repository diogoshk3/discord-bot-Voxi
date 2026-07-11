// Testes do /pronunciation (pessoal) via dispatcher — cobre a SUPERFÍCIE DE MONETIZAÇÃO:
// o limite Free (3) vs Premium (50) e o upsell do Ko-fi quando o limite é atingido.
// Segue o padrão de tests/commandsServerPron.test.ts (stub de interação + fast-path add,
// que dispensa o modal).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { getUserPronunciations } from '../src/store/pronunciation';
import { grantUserPremium } from '../src/store/premium';
import type Database from 'better-sqlite3';

const GUILD = 'g-pron';
const USER = 'user-1';
const KOFI = 'https://ko-fi.com/teste';

function makeDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    db,
    config: { kofiUrl: KOFI },
    availableModels: [],
  } as unknown as BotDeps;
}

function makeInteraction(opts: { sub: string; optionsMap?: Record<string, unknown> }) {
  const replies: string[] = [];
  const optionsMap = opts.optionsMap ?? {};
  return {
    commandName: 'pronunciation',
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
    followUp: async (o: { content: string }) => {
      replies.push(o.content);
    },
    member: { permissions: { has: () => true } },
    guild: null,
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => opts.sub,
      getInteger: () => null,
      getString: (name: string) => (optionsMap[name] as string) ?? '',
      getBoolean: () => false,
      getChannel: () => null,
      getRole: () => null,
    },
  };
}

async function add(db: Database.Database, term: string, say: string): Promise<string[]> {
  const i = makeInteraction({ sub: 'add', optionsMap: { term, say } });
  await handleInteraction(i as never, makeDeps(db));
  return i.replies;
}

describe('/pronunciation — limite Free 3 vs Premium 50 + upsell (monetização)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('Free: aceita 3; a 4.ª bate no limite COM upsell do Ko-fi', async () => {
    for (const t of ['a', 'b', 'c']) {
      await add(db, t, `${t}-say`);
    }
    expect(getUserPronunciations(db, USER)).toHaveLength(3);

    const replies = await add(db, 'd', 'd-say');
    const all = replies.join('\n');
    expect(all).toMatch(/3/); // menciona o limite
    expect(all).toContain(KOFI); // upsell para não-premium
    expect(getUserPronunciations(db, USER)).toHaveLength(3); // nada guardado
  });

  it('Premium: passa das 3 sem limite nem upsell (cap 50)', async () => {
    grantUserPremium(db, USER, 30, 'kofi', Date.now());
    for (const t of ['a', 'b', 'c', 'd', 'e']) {
      await add(db, t, `${t}-say`);
    }
    expect(getUserPronunciations(db, USER)).toHaveLength(5);
    const replies = await add(db, 'f', 'f-say');
    expect(replies.join('\n')).not.toContain(KOFI);
    expect(getUserPronunciations(db, USER)).toHaveLength(6);
  });

  it('Premium do SERVIDOR NÃO eleva o limite pessoal (as 50 pessoais são só do Plus)', async () => {
    const { grantGuildPremium } = await import('../src/store/premium.js');
    grantGuildPremium(db, GUILD, 30, 'kofi', Date.now());
    for (const t of ['a', 'b', 'c', 'd']) {
      await add(db, t, `${t}-say`);
    }
    expect(getUserPronunciations(db, USER)).toHaveLength(3); // continua 3: pessoal é do Plus
  });
});
