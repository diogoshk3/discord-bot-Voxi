import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction, handleAutocomplete, filterJokeLanguages } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';
import { laughterFor } from '../src/content/laughter';
import { JOKE_LANGUAGES } from '../src/content/jokes';
import type Database from 'better-sqlite3';

const GUILD = 'g-joke';
const USER = 'u-joke';

const CYRILLIC = /[Ѐ-ӿ]/;

function makeDeps(
  db: Database.Database,
  player?: { say: ReturnType<typeof vi.fn> },
  availableModels?: string[],
): BotDeps {
  const deps = {
    client: { user: { id: 'bot-1' } },
    players: new Map<string, unknown>(),
    db,
    config: { defaultSpeed: 1.0, defaultVoice: 'en_US-amy-medium' },
    availableModels: availableModels ?? ['en_US-amy-medium', 'ru_RU-dmitri-medium', 'fr_FR-siwis-medium'],
    limiters: new Map(),
  } as unknown as BotDeps;
  if (player) {
    (deps.players as Map<string, unknown>).set(GUILD, player);
  }
  return deps;
}

function makeJokeInteraction(opts: { idioma: string | null; risos: boolean | null }) {
  const replies: string[] = [];
  return {
    commandName: 'joke',
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
    options: {
      getSubcommandGroup: (_r = false) => null,
      getString: (name: string, _req?: boolean) => (name === 'language' ? opts.idioma : null),
      getBoolean: (name: string, _req?: boolean) => (name === 'laughter' ? opts.risos : null),
      getNumber: () => null,
    },
  };
}

describe('/joke', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('sem player ativo responde "join" e NAO chama say', async () => {
    const say = vi.fn();
    const deps = makeDeps(db); // sem player
    const i = makeJokeInteraction({ idioma: 'en', risos: false });

    await handleInteraction(i as any, deps);

    expect(say).not.toHaveBeenCalled();
    expect(i.replies.some((r) => /join/i.test(r))).toBe(true);
  });

  it('idioma desconhecido responde erro e NAO chama say', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    const i = makeJokeInteraction({ idioma: 'xx-nao-existe', risos: false });

    await handleInteraction(i as any, deps);

    expect(say).not.toHaveBeenCalled();
    expect(i.replies.length).toBeGreaterThan(0);
  });

  it('escolhe a voz cujo modelo casa com o prefixo da lingua escolhida', async () => {
    // idioma russo -> modelo tem de comecar por 'ru_', e a piada em Cirilico.
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    const i = makeJokeInteraction({ idioma: 'ru', risos: false });

    await handleInteraction(i as any, deps);

    expect(say).toHaveBeenCalledOnce();
    const req = say.mock.calls[0][0];
    expect(req.model.startsWith('ru_')).toBe(true);
    expect(req.text).toMatch(CYRILLIC);
  });

  it('risos:true enfileira DUAS falas: a piada, e depois o riso com pausa (leadSilenceMs:1000)', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    const i = makeJokeInteraction({ idioma: 'ru', risos: true });

    await handleInteraction(i as any, deps);

    // Duas falas separadas: a piada (imediata) e o riso (com 1s de silencio a frente).
    expect(say).toHaveBeenCalledTimes(2);

    // 1.ª fala: SO a piada, SEM riso e SEM leadSilenceMs.
    const jokeReq = say.mock.calls[0][0];
    expect(jokeReq.text.endsWith(laughterFor('ru_'))).toBe(false);
    expect(jokeReq.leadSilenceMs).toBeUndefined();

    // 2.ª fala: o riso da lingua, com 1000ms de silencio a frente (a pausa real).
    const laughReq = say.mock.calls[1][0];
    expect(laughReq.text).toBe(laughterFor('ru_'));
    expect(laughReq.leadSilenceMs).toBe(1000);
    // Mesma voz da piada.
    expect(laughReq.model).toBe(jokeReq.model);
  });

  it('risos:false enfileira UMA so fala: a piada, sem riso', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    const i = makeJokeInteraction({ idioma: 'en', risos: false });

    await handleInteraction(i as any, deps);

    expect(say).toHaveBeenCalledOnce();
    const req = say.mock.calls[0][0];
    expect(req.text.endsWith(laughterFor('en_'))).toBe(false);
    expect(req.leadSilenceMs).toBeUndefined();
  });

  it('risos:true com fila cheia (say false na piada): NAO enfileira o riso e responde busy', async () => {
    // A piada nao entrou na fila (cap) -> nao adianta enfileirar o riso. Uma so
    // chamada a say, e a resposta e busy (nao "playing").
    const say = vi.fn().mockResolvedValue(false);
    const deps = makeDeps(db, { say });
    const i = makeJokeInteraction({ idioma: 'ru', risos: true });

    await handleInteraction(i as any, deps);

    expect(say).toHaveBeenCalledOnce();
    expect(i.replies.some((r) => /busy/i.test(r))).toBe(true);
  });

  it('sem modelo instalado para a lingua cai no default (.env)', async () => {
    // availableModels sem 'ka_' -> a voz cai no config.defaultVoice.
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say }, ['en_US-amy-medium']);
    const i = makeJokeInteraction({ idioma: 'ka', risos: false });

    await handleInteraction(i as any, deps);

    expect(say).toHaveBeenCalledOnce();
    const req = say.mock.calls[0][0];
    expect(req.model).toBe('en_US-amy-medium');
  });

  it('say() false (fila cheia) responde "busy"', async () => {
    const say = vi.fn().mockResolvedValue(false);
    const deps = makeDeps(db, { say });
    const i = makeJokeInteraction({ idioma: 'en', risos: false });

    await handleInteraction(i as any, deps);

    expect(i.replies.some((r) => /busy/i.test(r))).toBe(true);
  });

  // ── rate-limit por-utilizador (mesmo limiter do /tts) ───────────────────────
  // ratePerMin=0 -> RateLimiter.allow devolve sempre false. Sem o guard, o /joke
  // enfileirava sem limite (vetor de spam da fila de voz). Idioma VALIDO ('en')
  // para o teste falhar pelo limiter e nao pelo unknownLang.
  it('quando o limiter nega responde tts.tooFast e NAO chama say', async () => {
    setGuildConfig(db, GUILD, { ratePerMin: 0 });
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    const i = makeJokeInteraction({ idioma: 'en', risos: false });

    await handleInteraction(i as any, deps);

    expect(say).not.toHaveBeenCalled();
    // t('tts.tooFast', 'en') = "Whoa, slow down a little — try again in a moment."
    expect(i.replies.some((r) => /slow down/i.test(r))).toBe(true);
  });
});

describe('filterJokeLanguages (autocomplete idioma)', () => {
  it('filtra por substring do display name em ingles', () => {
    const out = filterJokeLanguages('russ');
    expect(out).toEqual([{ name: 'Russian', value: 'ru' }]);
  });

  it('e case-insensitive e ignora espacos', () => {
    expect(filterJokeLanguages('  ARAB ')).toEqual([{ name: 'Arabic', value: 'ar' }]);
  });

  it('query vazia devolve no maximo 25 (cap do Discord), embora hajam 34 linguas', () => {
    expect(JOKE_LANGUAGES.length).toBeGreaterThan(25);
    expect(filterJokeLanguages('').length).toBe(25);
  });

  it('query sem match devolve []', () => {
    expect(filterJokeLanguages('zzzz')).toEqual([]);
  });
});

describe('handleAutocomplete — language', () => {
  const deps = { availableModels: ['en_US-amy-medium'] } as any;

  it('opcao focada "language": responde com as linguas filtradas', async () => {
    const respond = vi.fn();
    const i = {
      options: { getFocused: () => ({ name: 'language', value: 'french' }) },
      respond,
    } as any;
    await handleAutocomplete(i, deps);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith([{ name: 'French', value: 'fr' }]);
  });
});
