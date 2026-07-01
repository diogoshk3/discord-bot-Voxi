import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock mínimo de @discordjs/voice — não é usado no /voice preview, mas o import
// de index.ts resolve-o.
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setUserVoice } from '../src/store/userVoice';
import type Database from 'better-sqlite3';

const GUILD = 'g-preview';
const USER = 'u-preview';
// Migrado PT->EN (P16.2): a frase-amostra falada pelo /voice preview passou a
// ingles por defeito (t('preview.sample', 'en')).
const SAMPLE = "Hi, I'm Voxi. type it, hear it.";

function makeDeps(db: Database.Database, player?: { say: ReturnType<typeof vi.fn> }): BotDeps {
  const deps = {
    client: { user: { id: 'bot-1' } },
    players: new Map<string, unknown>(),
    db,
    config: { defaultSpeed: 1.0, defaultVoice: '' },
    availableModels: ['en_US-amy-medium', 'pt_PT-tugão-medium'],
    limiters: new Map(),
  } as unknown as BotDeps;
  if (player) {
    (deps.players as Map<string, unknown>).set(GUILD, player);
  }
  return deps;
}

function makePreviewInteraction(opts: { model?: string | null } = {}) {
  const replies: string[] = [];
  // model === undefined → opção não fornecida (getString devolve null)
  // model === null    → idem (forçado explicitamente)
  // model === 'xxx'   → opção fornecida com valor 'xxx'
  const modelValue = opts.model !== undefined ? opts.model : null;
  return {
    commandName: 'voice',
    guildId: GUILD,
    user: { id: USER },
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content: string }) => {
      replies.push(o.content);
    },
    options: {
      getSubcommand: () => 'preview',
      getString: (name: string, _required?: boolean) => {
        if (name === 'model') return modelValue;
        return null;
      },
      getNumber: () => null,
    },
  };
}

describe('/voice preview', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('com model válido chama player.say com a frase de amostra e o model correto', async () => {
    // say() devolve true (enfileirou) -> a resposta e "playing a sample".
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    const i = makePreviewInteraction({ model: 'pt_PT-tugão-medium' });

    await handleInteraction(i as any, deps);

    expect(say).toHaveBeenCalledOnce();
    const req = say.mock.calls[0][0];
    expect(req.text).toBe(SAMPLE);
    expect(req.model).toBe('pt_PT-tugão-medium');
    // Migrado PT->EN: "Playing a sample…"
    expect(i.replies.some((r) => /sample/i.test(r))).toBe(true);
  });

  it('quando say() devolve false (fila cheia) responde "busy", NAO "sample"', async () => {
    // P18.1: fila no cap -> say() resolve false -> o preview responde tts.busy em
    // vez de mentir "a reproduzir uma amostra".
    const say = vi.fn().mockResolvedValue(false);
    const deps = makeDeps(db, { say });
    const i = makePreviewInteraction({ model: 'en_US-amy-medium' });

    await handleInteraction(i as any, deps);

    expect(say).toHaveBeenCalledOnce();
    // t('tts.busy', 'en') = "I'm busy right now — try again in a moment."
    expect(i.replies.some((r) => /busy/i.test(r))).toBe(true);
    expect(i.replies.some((r) => /sample/i.test(r))).toBe(false);
  });

  it('model inválido responde com mensagem de erro e NÃO chama say', async () => {
    const say = vi.fn();
    const deps = makeDeps(db, { say });
    const i = makePreviewInteraction({ model: 'modelo-inexistente' });

    await handleInteraction(i as any, deps);

    expect(say).not.toHaveBeenCalled();
    expect(i.replies.some((r) => /desconhecido|voice list/i.test(r))).toBe(true);
  });

  it('sem player ativo responde "usa /join" e NÃO chama say', async () => {
    const say = vi.fn();
    // deps SEM player
    const deps = makeDeps(db);
    const i = makePreviewInteraction({ model: 'en_US-amy-medium' });

    await handleInteraction(i as any, deps);

    expect(say).not.toHaveBeenCalled();
    expect(i.replies.some((r) => /join/i.test(r))).toBe(true);
  });

  it('sem model usa a voz guardada do utilizador', async () => {
    // Guarda uma voz específica para o utilizador antes de chamar o comando.
    setUserVoice(db, GUILD, USER, 'pt_PT-tugão-medium', 1.2);

    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, { say });
    // model === null → nenhuma opção fornecida
    const i = makePreviewInteraction({ model: null });

    await handleInteraction(i as any, deps);

    expect(say).toHaveBeenCalledOnce();
    const req = say.mock.calls[0][0];
    expect(req.text).toBe(SAMPLE);
    expect(req.model).toBe('pt_PT-tugão-medium');
    expect(req.speed).toBe(1.2);
  });
});
