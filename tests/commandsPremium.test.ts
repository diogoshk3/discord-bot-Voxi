import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock mínimo de @discordjs/voice (o módulo de comandos importa-o em cadeia).
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { grantGuildPass, activateSeat } from '../src/store/premium';
import type Database from 'better-sqlite3';

const GUILD = 'g-prem';
const OTHER = 'g-other';
const U = 'u-1';

function makeDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: 'bot-1' }, guilds: { cache: new Map() } },
    players: new Map(),
    db,
    config: { kofiUrl: 'https://ko-fi.com/vozentest' },
    availableModels: [],
  } as unknown as BotDeps;
}

/** Interação falsa do /premium <sub>. manage = tem Gerir Servidor? */
function makePremiumInteraction(
  sub: 'info' | 'activate' | 'deactivate',
  opts: { manage?: boolean; guildId?: string | null; userId?: string } = {},
) {
  const { manage = true, guildId = GUILD, userId = U } = opts;
  const replies: string[] = [];
  const embedTexts: string[] = [];
  return {
    commandName: 'premium',
    guildId,
    isRepliable: () => true,
    user: { id: userId },
    member: { permissions: { has: () => manage } },
    replies,
    embedTexts,
    reply: async (o: { content?: string; embeds?: { data: { description?: string } }[] }) => {
      if (o.content) replies.push(o.content);
      if (o.embeds)
        for (const e of o.embeds) if (e.data.description) embedTexts.push(e.data.description);
    },
    editReply: async () => {},
    // Só o caminho de confirmação do activate chega aqui; nunca clicamos (timeout).
    fetchReply: async () => ({
      awaitMessageComponent: async () => {
        throw new Error('no-click');
      },
    }),
    options: {
      getSubcommand: () => sub,
      getSubcommandGroup: () => null,
      getString: () => '',
    },
  };
}

describe('/premium — info / activate / deactivate (passe de licenças)', () => {
  let db: Database.Database;
  const now = Date.now();
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('info sem Premium -> montra + link de compra do Ko-fi', async () => {
    const i = makePremiumInteraction('info');
    await handleInteraction(i as any, makeDeps(db));
    expect(i.embedTexts.join('\n')).toMatch(/ko-fi\.com\/vozentest/);
  });

  it('info com passe ativo -> mostra a linha do passe (licenças em uso)', async () => {
    grantGuildPass(db, U, 2, 30, 'kofi', now);
    activateSeat(db, U, GUILD, now);
    const i = makePremiumInteraction('info');
    await handleInteraction(i as any, makeDeps(db));
    // linha do passe menciona 1/2 licenças
    expect(i.embedTexts.join('\n')).toMatch(/1\/2/);
  });

  it('activate sem Gerir Servidor -> recusa (needManageGuild)', async () => {
    grantGuildPass(db, U, 2, 30, 'kofi', now);
    const i = makePremiumInteraction('activate', { manage: false });
    await handleInteraction(i as any, makeDeps(db));
    expect(i.replies.join('\n')).toMatch(/Manage Server|Gerir Servidor/i);
  });

  it('activate com Gerir Servidor mas SEM passe -> diz que não tem passe + link', async () => {
    const i = makePremiumInteraction('activate');
    await handleInteraction(i as any, makeDeps(db));
    expect(i.replies.join('\n')).toMatch(/ko-fi\.com\/vozentest/);
  });

  it('activate num servidor já ativado -> alreadyActive (não abre confirmação)', async () => {
    grantGuildPass(db, U, 2, 30, 'kofi', now);
    activateSeat(db, U, GUILD, now);
    const i = makePremiumInteraction('activate');
    await handleInteraction(i as any, makeDeps(db));
    expect(i.replies.length).toBeGreaterThan(0); // respondeu com reply(), não com confirmação
  });

  it('activate sem licenças livres (2 usadas noutros servidores) -> noSeats', async () => {
    grantGuildPass(db, U, 2, 30, 'kofi', now);
    activateSeat(db, U, OTHER, now);
    activateSeat(db, U, 'g-third', now);
    const i = makePremiumInteraction('activate'); // tenta num 3.º servidor
    await handleInteraction(i as any, makeDeps(db));
    expect(i.replies.length).toBeGreaterThan(0);
    expect(i.replies.join('\n')).toMatch(/2/); // menciona o total de licenças
  });

  it('deactivate liberta a licença do servidor; sem licença -> deactivateNone', async () => {
    grantGuildPass(db, U, 2, 30, 'kofi', now);
    activateSeat(db, U, GUILD, now);
    const i1 = makePremiumInteraction('deactivate');
    await handleInteraction(i1 as any, makeDeps(db));
    expect(i1.replies.join('\n')).toMatch(/Freed|Libertaste/i);
    // segunda vez já não há nada para libertar
    const i2 = makePremiumInteraction('deactivate');
    await handleInteraction(i2 as any, makeDeps(db));
    expect(i2.replies.join('\n')).toMatch(/no Premium licence|nenhuma licença/i);
  });
});
