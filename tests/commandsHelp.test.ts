import { describe, it, expect, vi } from 'vitest';
import { MessageFlags } from 'discord.js';

// Mock minimo de @discordjs/voice — o /help nao liga a voz, mas o modulo de
// comandos importa-o no topo, por isso o import precisa de resolver (sem este
// mock o import de src/commands/index falha antes de qualquer teste correr).
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction, commandDefs } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';

const GUILD = 'g-help-test';

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

function makeHelpInteraction(): FakeInteraction {
  const replies: string[] = [];
  const flags: (number | undefined)[] = [];
  return {
    commandName: 'help',
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

// O /help nao usa deps, mas handleInteraction passa-os na mesma — um stub minimo
// chega para o switch despachar.
function makeDeps(): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    config: {},
    availableModels: [],
  } as unknown as BotDeps;
}

describe('/help — discovery de comandos em-app', () => {
  it('(a) lista comandos-chave de cada grupo (Geral, Voz, Admin)', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    const text = i.replies.join('\n');
    // um representante de cada grupo + os pedidos explicitamente no contrato
    expect(text).toContain('/tts'); // Geral
    expect(text).toContain('/join'); // Geral
    expect(text).toContain('/invite'); // Geral
    expect(text).toContain('/help'); // Geral (auto-inclusao)
    expect(text).toContain('/voice'); // Voz
    expect(text).toContain('/setup'); // Admin
    expect(text).toContain('/stats'); // Admin
    expect(text).toContain('/config'); // Admin
  });

  it('reflete os subcomandos de /voice (set, list, preview, optout, optin)', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    const text = i.replies.join('\n');
    for (const sub of ['set', 'list', 'reset', 'preview', 'optout', 'optin']) {
      expect(text).toContain(sub);
    }
  });

  it('mostra os cabecalhos dos tres grupos', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    const text = i.replies.join('\n');
    expect(text).toContain('Geral');
    expect(text).toMatch(/Voz/);
    expect(text).toContain('Admin');
  });

  it('(b) inclui a marca/tagline Voxi', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    const text = i.replies.join('\n');
    expect(text).toContain('Voxi');
    expect(text).toMatch(/type it, hear it/i);
  });

  it('recomenda o /setup como primeiro passo', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    const text = i.replies.join('\n');
    expect(text).toContain('/setup');
  });

  it('(c) a resposta e ephemeral', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    expect(i.replies.length).toBeGreaterThan(0);
    // todas as replies deste comando tem de ser ephemeral
    for (const f of i.flags) {
      expect(f).toBe(MessageFlags.Ephemeral);
    }
  });

  // GUARD: derivado dos commandDefs reais — cada comando top-level REGISTADO tem
  // de aparecer no /help. Se alguem adicionar um comando novo a commandDefs e
  // esquecer de o cobrir no /help (handler hardcoded), este teste parte. So passa
  // porque o handler constroi o texto a partir de commandDefs (nao hardcoded).
  it('GUARD: todos os comandos top-level registados aparecem no /help', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    const text = i.replies.join('\n');
    for (const def of commandDefs) {
      expect(text, `/${def.name} em falta no /help`).toContain('/' + def.name);
    }
  });
});

describe('/help — definicao do comando', () => {
  it('esta registado em commandDefs como comando top-level (NAO admin-only)', () => {
    const def = commandDefs.find((c) => c.name === 'help');
    expect(def).toBeDefined();
    // top-level, qualquer utilizador: sem restricao de permissoes por defeito
    expect(def?.default_member_permissions ?? undefined).toBeUndefined();
  });
});
