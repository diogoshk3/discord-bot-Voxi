import { describe, it, expect, vi } from 'vitest';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';

// Mock minimo de @discordjs/voice — o /invite nao liga a voz, mas o modulo de
// comandos importa-o no topo, por isso o import precisa de resolver.
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction, commandDefs } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';

const GUILD = 'g-invite-test';

// O valor "verdadeiro" das permissoes, recomputado AQUI a partir dos 5 bits
// nomeados (NAO importado da implementacao, NAO um literal solto). Se a
// implementacao deixar cair um bit, este valor diverge e o teste (c) falha —
// e exatamente esse o guard que o contrato pede.
const EXPECTED_PERMISSIONS = new PermissionsBitField([
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
]).bitfield.toString();

interface FakeInteraction {
  commandName: string;
  guildId: string;
  replies: string[];
  reply: (opts: { content: string; flags?: number }) => Promise<void>;
  isRepliable: () => boolean;
  replied: boolean;
  deferred: boolean;
}

function makeInviteInteraction(): FakeInteraction {
  const replies: string[] = [];
  return {
    commandName: 'invite',
    guildId: GUILD,
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content: string; flags?: number }) => {
      replies.push(o.content);
    },
  };
}

// deps com um clientId presente (caminho feliz)
function makeDeps(clientId: string | undefined): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    config: clientId === undefined ? {} : { clientId },
    availableModels: [],
  } as unknown as BotDeps;
}

const CLIENT_ID = '123456789012345678';

describe('/invite — gera o link de convite OAuth2', () => {
  it('(a) o reply contem o CLIENT_ID esperado', async () => {
    const i = makeInviteInteraction();
    await handleInteraction(i as any, makeDeps(CLIENT_ID));
    const text = i.replies.join('\n');
    expect(text).toContain(`client_id=${CLIENT_ID}`);
  });

  it('(b) contem os scopes bot e applications.commands', async () => {
    const i = makeInviteInteraction();
    await handleInteraction(i as any, makeDeps(CLIENT_ID));
    const text = i.replies.join('\n');
    // O scope viaja como "bot applications.commands"; o espaco pode ficar
    // codificado (+/%20) consoante a construcao do URL, por isso afirmamos cada
    // token de forma independente em vez de um literal com espaco cru.
    expect(text).toMatch(/scope=/);
    expect(text).toContain('bot');
    expect(text).toContain('applications.commands');
  });

  it('(c) permissions corresponde ao inteiro derivado dos 5 bits', async () => {
    const i = makeInviteInteraction();
    await handleInteraction(i as any, makeDeps(CLIENT_ID));
    const text = i.replies.join('\n');
    expect(text).toContain(`permissions=${EXPECTED_PERMISSIONS}`);
  });

  it('e o URL e o endpoint oauth2/authorize do Discord', async () => {
    const i = makeInviteInteraction();
    await handleInteraction(i as any, makeDeps(CLIENT_ID));
    const text = i.replies.join('\n');
    expect(text).toContain('https://discord.com/oauth2/authorize');
    // mensagem de marca em PT
    expect(text).toMatch(/Voxi/);
  });

  it('(d) CLIENT_ID ausente → mensagem clara, sem link partido', async () => {
    const i = makeInviteInteraction();
    await handleInteraction(i as any, makeDeps(undefined));
    const text = i.replies.join('\n');
    expect(i.replies.length).toBeGreaterThan(0);
    // mensagem clara (nao um link partido)
    expect(text).not.toContain('discord.com/oauth2');
    expect(text).not.toContain('client_id=');
    // explica que falta configuracao
    expect(text).toMatch(/nao.*configurad|configurad.*nao|indisponivel|CLIENT_ID/i);
  });
});

describe('/invite — definicao do comando', () => {
  it('esta registado em commandDefs como comando top-level (NAO admin-only)', () => {
    const def = commandDefs.find((c) => c.name === 'invite');
    expect(def).toBeDefined();
    // top-level, qualquer utilizador: sem restricao de permissoes por defeito
    expect(def?.default_member_permissions ?? undefined).toBeUndefined();
  });
});
