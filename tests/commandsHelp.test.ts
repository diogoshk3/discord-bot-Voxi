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
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';

const GUILD = 'g-help-test';

// O /help agora responde com um EMBED ({ embeds: [embed] }), nao com { content }.
// Este helper achata o embed.data (title + description + nome/valor de cada field
// + footer) numa unica string pesquisavel, para que todas as afirmacoes de texto
// (lista de comandos, cabecalhos de grupo, tagline, GUARD) continuem a correr
// sobre `i.replies.join('\n')` como antes. Se o handler voltar a { content },
// tambem e capturado.
interface FakeInteraction {
  commandName: string;
  guildId: string;
  replies: string[];
  flags: (number | undefined)[];
  reply: (opts: { content?: string; embeds?: unknown[]; flags?: number }) => Promise<void>;
  isRepliable: () => boolean;
  replied: boolean;
  deferred: boolean;
  // Embeds crus (EmbedBuilder), para exercitar o caminho real de serializacao
  // (embed.toJSON(), que valida os limites do Discord) num teste.
  rawEmbeds: unknown[];
}

// Achata o `.data` de um EmbedBuilder (ou um embed cru) numa string pesquisavel.
function flattenEmbed(embed: unknown): string {
  // EmbedBuilder expoe os dados em `.data`; um embed cru ja e o proprio objeto.
  const data = (embed as { data?: unknown }).data ?? embed;
  const d = data as {
    title?: string;
    description?: string;
    fields?: { name?: string; value?: string }[];
    footer?: { text?: string };
  };
  const parts: string[] = [];
  if (d.title) parts.push(d.title);
  if (d.description) parts.push(d.description);
  for (const f of d.fields ?? []) {
    if (f.name) parts.push(f.name);
    if (f.value) parts.push(f.value);
  }
  if (d.footer?.text) parts.push(d.footer.text);
  return parts.join('\n');
}

function makeHelpInteraction(): FakeInteraction {
  const replies: string[] = [];
  const flags: (number | undefined)[] = [];
  const rawEmbeds: unknown[] = [];
  return {
    commandName: 'help',
    guildId: GUILD,
    replies,
    flags,
    rawEmbeds,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content?: string; embeds?: unknown[]; flags?: number }) => {
      if (o.content) replies.push(o.content);
      for (const e of o.embeds ?? []) {
        rawEmbeds.push(e);
        replies.push(flattenEmbed(e));
      }
      flags.push(o.flags);
    },
  };
}

// O /help agora renderiza via t() no locale da guild, por isso precisa de
// deps.db para ler getGuildConfig(guildId).locale. Usamos uma DB in-memory real.
function makeDeps(): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    config: {},
    availableModels: [],
    db: initDb(':memory:'),
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

  it('mostra os cabecalhos dos grupos em INGLES por defeito', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    const text = i.replies.join('\n');
    // locale default 'en' -> cabecalhos em ingles (5 grupos beginner-friendly)
    expect(text).toContain('Getting started');
    expect(text).toMatch(/Your voice/);
    expect(text).toContain('Fun');
    expect(text).toContain('Server admin');
    expect(text).toContain('More');
  });

  it('renderiza o chrome do /help em PT quando a guild tem locale="pt"', async () => {
    const deps = makeDeps();
    setGuildConfig((deps as any).db, GUILD, { locale: 'pt' });
    const i = makeHelpInteraction();
    await handleInteraction(i as any, deps);
    const text = i.replies.join('\n');
    // O chrome (cabecalhos de grupo) e o que discrimina EN vs PT.
    expect(text).toContain('Primeiros passos');
    expect(text).toMatch(/A tua voz/);
    // e NAO deve conter o cabecalho ingles neste locale
    expect(text).not.toContain('Getting started');
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

  it('(d) responde com um embed que serializa sem violar limites do Discord', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    // O /help responde com um EmbedBuilder. embed.toJSON() e o caminho REAL de
    // envio no discord.js e valida os limites (field name/value nao-vazios,
    // value <=1024, total <=6000). Se algum grupo ficasse vazio ou gigante, isto
    // lancava — guarda o contrato do embed, nao so o texto achatado.
    expect(i.rawEmbeds.length).toBe(1);
    const embed = i.rawEmbeds[0] as { toJSON: () => { fields?: unknown[] } };
    expect(() => embed.toJSON()).not.toThrow();
    const json = embed.toJSON();
    // quick-start + cinco grupos -> seis fields
    expect(json.fields?.length).toBe(6);
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

  // ── beginner-friendly: quick-start + comandos antes undiscoverable ─────────
  it('inclui um quick-start de 3 passos', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    const text = i.replies.join('\n');
    // titulo do quick-start (EN default) + os tres numeros dos passos
    expect(text).toMatch(/quick start/i);
    expect(text).toContain('1)');
    expect(text).toContain('2)');
    expect(text).toContain('3)');
    // o primeiro passo tem de mandar juntar-se a voz e correr /join
    expect(text).toMatch(/\/join/);
  });

  it('refere os comandos novos antes undiscoverable: /joke, /laugh, /voice abbrev', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    const text = i.replies.join('\n');
    expect(text).toContain('/joke');
    expect(text).toContain('/laugh');
    // /voice abbrev e um grupo de subcomandos (type 2); helpSubcommands filtra
    // type 1, por isso NAO aparecia antes — o /help beginner-friendly tem de o citar.
    expect(text).toContain('/voice abbrev');
  });

  it('da pelo menos um exemplo concreto por seccao', async () => {
    const i = makeHelpInteraction();
    await handleInteraction(i as any, makeDeps());
    const text = i.replies.join('\n');
    // exemplos concretos hand-authored (nao derivaveis das descricoes)
    expect(text).toMatch(/\/tts Hello/i);
    expect(text).toMatch(/\/voice set/i);
    expect(text).toMatch(/\/joke /i);
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
