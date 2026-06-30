import { describe, it, expect, vi } from 'vitest';

// Mock minimo de @discordjs/voice — o /vote nao liga a voz, mas o modulo de
// comandos importa-o no topo, por isso o import precisa de resolver.
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction, commandDefs } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';

const GUILD = 'g-vote-test';
const CLIENT_ID = '123456789012345678';

interface FakeInteraction {
  commandName: string;
  guildId: string;
  replies: string[];
  flags: (number | undefined)[];
  reply: (opts: { content: string; flags?: number }) => Promise<void>;
  isRepliable: () => boolean;
  replied: boolean;
  deferred: boolean;
}

function makeVoteInteraction(): FakeInteraction {
  const replies: string[] = [];
  const flags: (number | undefined)[] = [];
  return {
    commandName: 'vote',
    guildId: GUILD,
    replies,
    flags,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content: string; flags?: number }) => {
      replies.push(o.content);
      flags.push(o.flags);
    },
  };
}

function makeDeps(clientId: string | undefined): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    config: clientId === undefined ? {} : { clientId },
    availableModels: [],
  } as unknown as BotDeps;
}

describe('/vote — link para a pagina de voto top.gg', () => {
  it('(a) o reply contem o CLIENT_ID e o caminho /vote do top.gg', async () => {
    const i = makeVoteInteraction();
    await handleInteraction(i as any, makeDeps(CLIENT_ID));
    const text = i.replies.join('\n');
    expect(text).toContain(`https://top.gg/bot/${CLIENT_ID}/vote`);
    expect(text).toContain(CLIENT_ID);
    expect(text).toContain('/vote');
  });

  it('inclui a linha de marca/CTA do Voxi', async () => {
    const i = makeVoteInteraction();
    await handleInteraction(i as any, makeDeps(CLIENT_ID));
    const text = i.replies.join('\n');
    expect(text).toMatch(/Voxi/);
    expect(text).toMatch(/12h/);
  });

  it('a resposta e partilhavel (NAO ephemeral) — como o /invite', async () => {
    const i = makeVoteInteraction();
    await handleInteraction(i as any, makeDeps(CLIENT_ID));
    // reply normal: sem flags ephemeral, para o link ficar visivel no canal.
    for (const f of i.flags) {
      expect(f).toBeUndefined();
    }
  });

  it('(b) CLIENT_ID ausente => mensagem clara, sem link partido', async () => {
    const i = makeVoteInteraction();
    await handleInteraction(i as any, makeDeps(undefined));
    const text = i.replies.join('\n');
    expect(i.replies.length).toBeGreaterThan(0);
    // nao gera um link partido (top.gg/bot//vote)
    expect(text).not.toContain('top.gg/bot//vote');
    expect(text).not.toContain('top.gg/bot/');
    // explica que falta configuracao
    expect(text).toMatch(/nao.*configurad|configurad.*nao|CLIENT_ID/i);
  });
});

describe('/vote — definicao do comando', () => {
  it('esta registado em commandDefs como comando top-level (NAO admin-only)', () => {
    const def = commandDefs.find((c) => c.name === 'vote');
    expect(def).toBeDefined();
    expect(def?.default_member_permissions ?? undefined).toBeUndefined();
  });
});
