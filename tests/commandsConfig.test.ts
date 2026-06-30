import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionFlagsBits, ChannelType } from 'discord.js';

// Mock minimo de @discordjs/voice — nao e usado no /config, mas o import resolve-o.
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { getGuildConfig, setGuildConfig, resetGuildConfig } from '../src/store/guildConfig';
import { getBlocklist, addBlockword } from '../src/store/blocklist';
import { getPronunciations, addPronunciation } from '../src/store/pronunciation';
import type Database from 'better-sqlite3';

const GUILD = 'g-config-test';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeConfigDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    db,
    config: {},
    availableModels: ['en_US-amy-medium', 'pt_PT-tugao-medium'],
  } as unknown as BotDeps;
}

interface FakeInteraction {
  commandName: string;
  guildId: string;
  replies: string[];
  reply: (opts: { content: string }) => Promise<void>;
  isRepliable: () => boolean;
  replied: boolean;
  deferred: boolean;
  member: unknown;
  guild: unknown;
  options: unknown;
}

function makeConfigInteraction(opts: {
  sub?: string;
  group?: string | null;
  optionsMap?: Record<string, unknown>;
  guild?: unknown;
}): FakeInteraction {
  const replies: string[] = [];
  const optionsMap = opts.optionsMap ?? {};
  return {
    commandName: 'config',
    guildId: GUILD,
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content: string }) => {
      replies.push(o.content);
    },
    member: {
      permissions: { has: () => true }, // admin by default
    },
    guild: opts.guild ?? null,
    options: {
      getSubcommandGroup: (_required = false) => opts.group ?? null,
      getSubcommand: () => opts.sub ?? '',
      getInteger: (name: string) => (optionsMap[name] as number) ?? null,
      getString: (name: string) => (optionsMap[name] as string) ?? '',
      getBoolean: (name: string) => (optionsMap[name] as boolean) ?? false,
      getChannel: (name: string) => (optionsMap[name] as unknown) ?? null,
      getRole: (name: string) => (optionsMap[name] as unknown) ?? null,
    },
  };
}

// ── max-chars ────────────────────────────────────────────────────────────────

describe('/config max-chars — validacao de range', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('rejeita valor 0 com mensagem clara e nao aplica', async () => {
    const i = makeConfigInteraction({ sub: 'max-chars', optionsMap: { valor: 0 } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /max-chars|entre|1.*2000|2000.*1/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).maxChars).toBe(300); // default intacto
  });

  it('rejeita valor 2001 com mensagem clara e nao aplica', async () => {
    const i = makeConfigInteraction({ sub: 'max-chars', optionsMap: { valor: 2001 } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /max-chars|entre|1.*2000|2000.*1/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).maxChars).toBe(300);
  });

  it('aceita valor 500 e persiste', async () => {
    const i = makeConfigInteraction({ sub: 'max-chars', optionsMap: { valor: 500 } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /500/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).maxChars).toBe(500);
  });

  it('aceita valor limite 1 e persiste', async () => {
    const i = makeConfigInteraction({ sub: 'max-chars', optionsMap: { valor: 1 } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(getGuildConfig(db, GUILD).maxChars).toBe(1);
  });

  it('aceita valor limite 2000 e persiste', async () => {
    const i = makeConfigInteraction({ sub: 'max-chars', optionsMap: { valor: 2000 } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(getGuildConfig(db, GUILD).maxChars).toBe(2000);
  });
});

// ── rate-limit ───────────────────────────────────────────────────────────────

describe('/config rate-limit — validacao de range', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('rejeita valor 0 com mensagem clara e nao aplica', async () => {
    const i = makeConfigInteraction({ sub: 'rate-limit', optionsMap: { valor: 0 } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /rate-limit|entre|1.*120|120.*1/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).ratePerMin).toBe(5); // default intacto
  });

  it('rejeita valor 121 com mensagem clara e nao aplica', async () => {
    const i = makeConfigInteraction({ sub: 'rate-limit', optionsMap: { valor: 121 } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /rate-limit|entre|1.*120|120.*1/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).ratePerMin).toBe(5);
  });

  it('aceita valor 10 e persiste', async () => {
    const i = makeConfigInteraction({ sub: 'rate-limit', optionsMap: { valor: 10 } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /10/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).ratePerMin).toBe(10);
  });

  it('aceita valor limite 1 e persiste', async () => {
    const i = makeConfigInteraction({ sub: 'rate-limit', optionsMap: { valor: 1 } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(getGuildConfig(db, GUILD).ratePerMin).toBe(1);
  });

  it('aceita valor limite 120 e persiste', async () => {
    const i = makeConfigInteraction({ sub: 'rate-limit', optionsMap: { valor: 120 } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(getGuildConfig(db, GUILD).ratePerMin).toBe(120);
  });
});

// ── tts-channel ──────────────────────────────────────────────────────────────

describe('/config tts-channel — validacao de tipo e acesso', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('rejeita canal de voz (tipo errado) com mensagem clara', async () => {
    const fakeChannel = { id: 'ch-voice', type: ChannelType.GuildVoice };
    const i = makeConfigInteraction({
      sub: 'tts-channel',
      optionsMap: { canal: fakeChannel },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /texto|voz|categoria/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).ttsChannelId).toBeNull();
  });

  it('rejeita canal de texto sem permissao ViewChannel', async () => {
    const fakeChannel = { id: 'ch-noaccess', type: ChannelType.GuildText };
    const guild = {
      channels: {
        cache: {
          get: () => ({
            permissionsFor: () => ({ has: () => false }),
          }),
        },
      },
    };
    const i = makeConfigInteraction({
      sub: 'tts-channel',
      optionsMap: { canal: fakeChannel },
      guild,
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /acesso|permiss/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).ttsChannelId).toBeNull();
  });

  it('aceita canal de texto acessivel e persiste', async () => {
    const fakeChannel = { id: 'ch-ok', type: ChannelType.GuildText };
    const guild = {
      channels: {
        cache: {
          get: () => ({
            permissionsFor: () => ({ has: () => true }),
          }),
        },
      },
    };
    const i = makeConfigInteraction({
      sub: 'tts-channel',
      optionsMap: { canal: fakeChannel },
      guild,
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /ch-ok/.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).ttsChannelId).toBe('ch-ok');
  });
});

// ── role (gating por role) ────────────────────────────────────────────────────

describe('/config role — definir e limpar', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('define o ttsRoleId quando um role e fornecido', async () => {
    const fakeRole = { id: 'role-99', name: 'Leitores' };
    const i = makeConfigInteraction({ sub: 'role', optionsMap: { role: fakeRole } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /role-99|restrit/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).ttsRoleId).toBe('role-99');
  });

  it('limpa o ttsRoleId quando o role e omitido', async () => {
    // Primeiro definir, depois limpar (role omitido → getRole devolve null).
    setGuildConfig(db, GUILD, { ttsRoleId: 'role-99' });
    const i = makeConfigInteraction({ sub: 'role', optionsMap: {} });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /remov|sem restricao|todos/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).ttsRoleId).toBeNull();
  });
});

// ── blockword add/remove ─────────────────────────────────────────────────────

describe('/config blockword — validacao de palavra vazia', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('blockword add: rejeita string vazia com mensagem clara', async () => {
    const i = makeConfigInteraction({
      group: 'blockword',
      sub: 'add',
      optionsMap: { palavra: '' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /vazia|vazio|palavra/i.test(r))).toBe(true);
    expect(getBlocklist(db, GUILD)).toHaveLength(0);
  });

  it('blockword add: rejeita string so com espacos (apos trim)', async () => {
    const i = makeConfigInteraction({
      group: 'blockword',
      sub: 'add',
      optionsMap: { palavra: '   ' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /vazia|vazio|palavra/i.test(r))).toBe(true);
    expect(getBlocklist(db, GUILD)).toHaveLength(0);
  });

  it('blockword add: aceita palavra valida, guarda trimada', async () => {
    const i = makeConfigInteraction({
      group: 'blockword',
      sub: 'add',
      optionsMap: { palavra: '  spam  ' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /spam/i.test(r))).toBe(true);
    expect(getBlocklist(db, GUILD)).toContain('spam');
    // Nao guarda com espacos
    expect(getBlocklist(db, GUILD)).not.toContain('  spam  ');
  });

  it('blockword remove: rejeita string vazia com mensagem clara', async () => {
    const i = makeConfigInteraction({
      group: 'blockword',
      sub: 'remove',
      optionsMap: { palavra: '' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /vazia|vazio|palavra/i.test(r))).toBe(true);
  });

  it('blockword remove: aceita palavra valida', async () => {
    // Pre-adicionar via blocklist diretamente para depois remover
    const { addBlockword } = await import('../src/store/blocklist');
    addBlockword(db, GUILD, 'spam');

    const i = makeConfigInteraction({
      group: 'blockword',
      sub: 'remove',
      optionsMap: { palavra: 'spam' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /[Dd]esbloqueado/i.test(r))).toBe(true);
    expect(getBlocklist(db, GUILD)).not.toContain('spam');
  });
});

// ── pronunciation add/remove/list ─────────────────────────────────────────────

describe('/config pronunciation — add/remove/list', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('add: rejeita termo vazio com mensagem clara e nao aplica', async () => {
    const i = makeConfigInteraction({
      group: 'pronunciation',
      sub: 'add',
      optionsMap: { termo: '   ', pronuncia: 'good game' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /termo|vazio|vazia/i.test(r))).toBe(true);
    expect(getPronunciations(db, GUILD)).toHaveLength(0);
  });

  it('add: rejeita pronuncia vazia com mensagem clara e nao aplica', async () => {
    const i = makeConfigInteraction({
      group: 'pronunciation',
      sub: 'add',
      optionsMap: { termo: 'gg', pronuncia: '   ' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /pronuncia|vazio|vazia/i.test(r))).toBe(true);
    expect(getPronunciations(db, GUILD)).toHaveLength(0);
  });

  it('add: aceita termo+pronuncia validos, guarda trimado', async () => {
    const i = makeConfigInteraction({
      group: 'pronunciation',
      sub: 'add',
      optionsMap: { termo: '  gg  ', pronuncia: '  good game  ' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /gg.*good game/i.test(r))).toBe(true);
    expect(getPronunciations(db, GUILD)).toEqual([{ term: 'gg', replacement: 'good game' }]);
  });

  it('remove: remove um termo existente', async () => {
    addPronunciation(db, GUILD, 'gg', 'good game');
    const i = makeConfigInteraction({
      group: 'pronunciation',
      sub: 'remove',
      optionsMap: { termo: 'gg' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /removida|gg/i.test(r))).toBe(true);
    expect(getPronunciations(db, GUILD)).toHaveLength(0);
  });

  it('remove: rejeita termo vazio com mensagem clara', async () => {
    const i = makeConfigInteraction({
      group: 'pronunciation',
      sub: 'remove',
      optionsMap: { termo: '' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /termo|vazio|vazia/i.test(r))).toBe(true);
  });

  it('list: mostra os termos definidos', async () => {
    addPronunciation(db, GUILD, 'gg', 'good game');
    addPronunciation(db, GUILD, 'btw', 'by the way');
    const i = makeConfigInteraction({ group: 'pronunciation', sub: 'list' });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /gg.*good game/i.test(r))).toBe(true);
    expect(i.replies.some((r) => /btw.*by the way/i.test(r))).toBe(true);
  });

  it('list: mensagem para dicionario vazio (sem opcoes nao rebenta)', async () => {
    const i = makeConfigInteraction({ group: 'pronunciation', sub: 'list' });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /nenhum/i.test(r))).toBe(true);
  });
});

// ── enabled (kill-switch) ─────────────────────────────────────────────────────

describe('/config enabled — kill-switch do servidor', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('desliga o TTS (enabled=false) e persiste', async () => {
    const i = makeConfigInteraction({ sub: 'enabled', optionsMap: { ativo: false } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /desativ|deslig/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).enabled).toBe(false);
  });

  it('liga o TTS (enabled=true) e persiste', async () => {
    // Primeiro desligar para confirmar que volta a ligar.
    setGuildConfig(db, GUILD, { enabled: false });
    const i = makeConfigInteraction({ sub: 'enabled', optionsMap: { ativo: true } });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /ativ|lig/i.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).enabled).toBe(true);
  });
});

// ── default-voice ─────────────────────────────────────────────────────────────

describe('/config default-voice — valida modelo disponivel', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('aceita modelo disponivel e persiste o default_voice da guild', async () => {
    const i = makeConfigInteraction({
      sub: 'default-voice',
      optionsMap: { model: 'pt_PT-tugao-medium' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /pt_PT-tugao-medium/.test(r))).toBe(true);
    expect(getGuildConfig(db, GUILD).defaultVoice).toBe('pt_PT-tugao-medium');
  });

  it('rejeita modelo desconhecido com mensagem clara e nao aplica', async () => {
    const i = makeConfigInteraction({
      sub: 'default-voice',
      optionsMap: { model: 'xx_XX-naoexiste' },
    });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);
    expect(i.replies.some((r) => /desconhecido|list/i.test(r))).toBe(true);
    // default_voice da guild fica vazio (nao definido)
    expect(getGuildConfig(db, GUILD).defaultVoice).toBe('');
  });
});

// ── /config show ──────────────────────────────────────────────────────────────

describe('/config show — mostra config atual do servidor', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('mostra os valores guardados (nao os defaults)', async () => {
    // Configurar valores nao-default para confirmar que vem do store, nao hard-coded
    setGuildConfig(db, GUILD, {
      ttsChannelId: 'ch-show-test',
      autoread: true,
      ttsRoleId: 'role-show-test',
      enabled: false,
      defaultVoice: 'pt_PT-tugao-medium',
      maxChars: 123,
      ratePerMin: 7,
    });
    addBlockword(db, GUILD, 'spam');
    addBlockword(db, GUILD, 'flood');
    addPronunciation(db, GUILD, 'gg', 'good game');

    const i = makeConfigInteraction({ sub: 'show' });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);

    const text = i.replies.join('\n');
    expect(text).toMatch(/ch-show-test/);
    expect(text).toMatch(/autoread.*on|on.*autoread/i);
    expect(text).toMatch(/role-show-test/);
    expect(text).toMatch(/enabled.*off|off.*enabled/i);
    expect(text).toMatch(/pt_PT-tugao-medium/);
    expect(text).toMatch(/123/);
    expect(text).toMatch(/7/);
    expect(text).toMatch(/2/); // 2 palavras na blocklist
    expect(text).toMatch(/1/); // 1 entrada de pronuncia
  });

  it('mostra (nenhum) para canal nao definido e qualquer para role nao definido', async () => {
    // Sem nenhuma config definida — defaults
    const i = makeConfigInteraction({ sub: 'show' });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);

    const text = i.replies.join('\n');
    expect(text).toMatch(/nenhum/i);
    expect(text).toMatch(/qualquer/i);
    expect(text).toMatch(/dete/i); // "(deteção automática)"
  });

  it('mostra deteção automática para defaultVoice vazio', async () => {
    setGuildConfig(db, GUILD, { defaultVoice: '' });
    const i = makeConfigInteraction({ sub: 'show' });
    const deps = makeConfigDeps(db);
    await handleInteraction(i as any, deps);

    const text = i.replies.join('\n');
    expect(text).toMatch(/dete/i);
  });
});
