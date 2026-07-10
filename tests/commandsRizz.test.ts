import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction, handleAutocomplete } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';
import { setUserVoice } from '../src/store/userVoice';
import { grantGuildPremium } from '../src/store/premium';
import type Database from 'better-sqlite3';

const GUILD = 'g-rizz';
const USER = 'u-rizz';
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
    availableModels: availableModels ?? [
      'en_US-amy-medium',
      'ru_RU-dmitri-medium',
      'fr_FR-siwis-medium',
    ],
    limiters: new Map(),
  } as unknown as BotDeps;
  if (player) (deps.players as Map<string, unknown>).set(GUILD, player);
  return deps;
}

function makeRizzInteraction(opts: { language: string | null; sound: boolean | null }) {
  const replies: string[] = [];
  return {
    commandName: 'rizz',
    guildId: GUILD,
    user: { id: USER },
    replies,
    deferReply: async () => {},
    editReply: async (o: string | { content: string }) => {
      replies.push(typeof o === 'string' ? o : o.content);
    },
    options: {
      getSubcommandGroup: () => null,
      getString: (name: string) => (name === 'language' ? opts.language : null),
      getBoolean: (name: string) => (name === 'sound' ? opts.sound : null),
      getNumber: () => null,
    },
  };
}

describe('/rizz', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
    // /rizz é Premium — a maioria dos testes exercita o caminho feliz, por isso o
    // servidor tem Premium por defeito. O teste do gate remove-o.
    grantGuildPremium(db, GUILD, 30, 'test', Date.now());
  });
  afterEach(() => {
    db.close();
  });

  it('sem Premium (Plus nem Premium do servidor) -> responde locked e NÃO chama say', async () => {
    db.prepare('DELETE FROM premium_guild WHERE guild_id = ?').run(GUILD);
    const say = vi.fn().mockResolvedValue(true);
    const i = makeRizzInteraction({ language: 'en', sound: false });
    await handleInteraction(i as any, makeDeps(db, { say }));
    expect(say).not.toHaveBeenCalled();
    expect(i.replies.some((r) => /Premium/i.test(r))).toBe(true);
  });

  it('sem player ativo responde "join" e NÃO chama say', async () => {
    const say = vi.fn();
    const i = makeRizzInteraction({ language: 'en', sound: false });
    await handleInteraction(i as any, makeDeps(db));
    expect(say).not.toHaveBeenCalled();
    expect(i.replies.some((r) => /join/i.test(r))).toBe(true);
  });

  it('idioma desconhecido responde erro e NÃO chama say', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const i = makeRizzInteraction({ language: 'xx-nao-existe', sound: false });
    await handleInteraction(i as any, makeDeps(db, { say }));
    expect(say).not.toHaveBeenCalled();
    expect(i.replies.length).toBeGreaterThan(0);
  });

  it('escolhe a voz pelo prefixo da língua e fala a frase nessa língua (ru -> Cirílico)', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const i = makeRizzInteraction({ language: 'ru', sound: false });
    await handleInteraction(i as any, makeDeps(db, { say }));
    expect(say).toHaveBeenCalledOnce();
    const req = say.mock.calls[0][0];
    expect(req.model.startsWith('ru_')).toBe(true);
    expect(req.text).toMatch(CYRILLIC);
  });

  it('sound:true enfileira DUAS falas: a frase, e depois o efeito sonoro (assetPath)', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const i = makeRizzInteraction({ language: 'en', sound: true });
    await handleInteraction(i as any, makeDeps(db, { say }));
    expect(say).toHaveBeenCalledTimes(2);
    // 1.ª fala: a pick-up line, sem assetPath.
    expect(say.mock.calls[0][0].assetPath).toBeUndefined();
    expect(say.mock.calls[0][0].text.length).toBeGreaterThan(0);
    // 2.ª fala: o efeito sonoro — assetPath aponta para rizz.wav e o texto é vazio.
    const sfx = say.mock.calls[1][0];
    expect(String(sfx.assetPath)).toMatch(/rizz\.wav$/);
    expect(sfx.text).toBe('');
  });

  it('sound:false enfileira UMA só fala (sem efeito sonoro)', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const i = makeRizzInteraction({ language: 'en', sound: false });
    await handleInteraction(i as any, makeDeps(db, { say }));
    expect(say).toHaveBeenCalledOnce();
    expect(say.mock.calls[0][0].assetPath).toBeUndefined();
  });

  it('sound:true com fila cheia (say false): NÃO enfileira o efeito e responde busy', async () => {
    const say = vi.fn().mockResolvedValue(false);
    const i = makeRizzInteraction({ language: 'ru', sound: true });
    await handleInteraction(i as any, makeDeps(db, { say }));
    expect(say).toHaveBeenCalledOnce();
    expect(i.replies.some((r) => /busy/i.test(r))).toBe(true);
  });

  it('sem modelo instalado para a língua cai no default (.env)', async () => {
    const say = vi.fn().mockResolvedValue(true);
    const i = makeRizzInteraction({ language: 'ka', sound: false });
    await handleInteraction(i as any, makeDeps(db, { say }, ['en_US-amy-medium']));
    expect(say.mock.calls[0][0].model).toBe('en_US-amy-medium');
  });

  it('segue o MOTOR escolhido pelo utilizador (engine:piper)', async () => {
    setUserVoice(db, GUILD, USER, 'en_US-amy-medium', 1.0, 'piper');
    const say = vi.fn().mockResolvedValue(true);
    const i = makeRizzInteraction({ language: 'en', sound: false });
    await handleInteraction(i as any, makeDeps(db, { say }));
    expect(say.mock.calls[0][0].engine).toBe('piper');
  });

  it('quando o limiter nega responde tts.tooFast e NÃO chama say', async () => {
    setGuildConfig(db, GUILD, { ratePerMin: 0 });
    const say = vi.fn().mockResolvedValue(true);
    const i = makeRizzInteraction({ language: 'en', sound: false });
    await handleInteraction(i as any, makeDeps(db, { say }));
    expect(say).not.toHaveBeenCalled();
    expect(i.replies.some((r) => /slow down/i.test(r))).toBe(true);
  });
});

describe('/rizz — autocomplete de língua (reutiliza o do /joke)', () => {
  it('a opção "language" do /rizz responde com as línguas filtradas', async () => {
    const respond = vi.fn();
    const i = {
      commandName: 'rizz',
      options: { getFocused: () => ({ name: 'language', value: 'french' }) },
      respond,
    } as any;
    await handleAutocomplete(i, { availableModels: ['en_US-amy-medium'] } as any);
    expect(respond).toHaveBeenCalledWith([{ name: 'French', value: 'fr' }]);
  });
});
