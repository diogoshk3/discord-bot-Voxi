/**
 * Context-menu "Speak" (Vaga 2·I): botão direito numa mensagem -> Apps -> Speak ->
 * o Vozen lê essa mensagem com a voz de quem clicou (mesmo pipeline do /tts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';

vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleMessageContextMenu, commandDefs } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';

const GUILD = 'g-speak';

function makeDeps(db: Database.Database, say: ReturnType<typeof vi.fn>, withPlayer = true): BotDeps {
  const players = new Map<string, unknown>();
  if (withPlayer) players.set(GUILD, { say });
  return {
    client: { user: { id: 'bot-1' }, users: { cache: { get: () => undefined } } },
    db,
    players,
    limiters: new Map(),
    availableModels: ['en_US-amy-medium'],
    config: { defaultVoice: 'en_US-amy-medium', defaultSpeed: 1.0, messageLeadMs: 0 },
  } as unknown as BotDeps;
}

function makeInteraction(content: string) {
  const replies: string[] = [];
  return {
    commandName: 'Speak',
    guildId: GUILD,
    guild: { members: { cache: { get: () => undefined } }, channels: { cache: { get: () => undefined } } },
    user: { id: 'u-1' },
    locale: 'pt-BR',
    targetMessage: { content },
    replies,
    deferReply: async () => {},
    editReply: async (msg: string | { content?: string }) => {
      replies.push(typeof msg === 'string' ? msg : (msg.content ?? ''));
    },
  };
}

describe('context-menu "Speak"', () => {
  let db: Database.Database;
  let say: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = initDb(':memory:');
    say = vi.fn().mockResolvedValue(true);
    setGuildConfig(db, GUILD, { enabled: true });
  });
  afterEach(() => db.close());

  it('lê a mensagem-alvo com a voz do user (player.say chamado)', async () => {
    const i = makeInteraction('olá pessoal isto é a mensagem');
    await handleMessageContextMenu(i as any, makeDeps(db, say));
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('olá pessoal isto é a mensagem');
  });

  it('mensagem sem texto -> avisa, não fala', async () => {
    const i = makeInteraction('   ');
    await handleMessageContextMenu(i as any, makeDeps(db, say));
    expect(say).not.toHaveBeenCalled();
    expect(i.replies.join('')).toMatch(/texto|read/i);
  });

  it('bot fora de voz -> avisa, não fala', async () => {
    const i = makeInteraction('olá');
    await handleMessageContextMenu(i as any, makeDeps(db, say, false));
    expect(say).not.toHaveBeenCalled();
    expect(i.replies.length).toBe(1);
  });

  it('ignora outros comandos de context-menu (nome != Speak)', async () => {
    const i = makeInteraction('olá');
    (i as any).commandName = 'Outro';
    await handleMessageContextMenu(i as any, makeDeps(db, say));
    expect(say).not.toHaveBeenCalled();
  });

  it('está registado em commandDefs como comando de MENSAGEM (type 3)', () => {
    const def = commandDefs.find((c) => c.name === 'Speak');
    expect(def).toBeDefined();
    expect(def?.type).toBe(3); // ApplicationCommandType.Message
  });

  // Bug-hunt 2026-07: o handler do context-menu é despachado com `void ...` SEM catch
  // e não tinha try/catch próprio. Um throw no speakRawText (ex.: player.say rejeita)
  // deixava o utilizador preso em "Vozen is thinking…" para sempre + unhandledRejection.
  // Agora tem que apanhar o erro e responder com a mensagem genérica.
  it('se a síntese/say lança, responde erro (não fica preso em "thinking…") e não rejeita', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('synth boom'));
    // Interação que regista o ciclo defer/reply para exercer o ramo editReply do catch.
    const replies: string[] = [];
    const i = {
      commandName: 'Speak',
      guildId: GUILD,
      guild: {
        members: { cache: { get: () => undefined } },
        channels: { cache: { get: () => undefined } },
      },
      user: { id: 'u-1' },
      locale: 'pt-BR',
      targetMessage: { content: 'lê isto por favor' },
      deferred: false,
      replied: false,
      isRepliable: () => true,
      deferReply: async function (this: { deferred: boolean }) {
        this.deferred = true;
      },
      editReply: async (msg: string | { content?: string }) => {
        replies.push(typeof msg === 'string' ? msg : (msg.content ?? ''));
      },
      reply: async (msg: string | { content?: string }) => {
        replies.push(typeof msg === 'string' ? msg : (msg.content ?? ''));
      },
    };

    // NÃO deve rejeitar (o catch engole o erro e responde).
    await expect(handleMessageContextMenu(i as any, makeDeps(db, boom))).resolves.toBeUndefined();
    expect(boom).toHaveBeenCalledTimes(1);
    // Recebeu uma resposta de erro (em vez de ficar preso).
    expect(replies.length).toBe(1);
    expect(replies[0]).toMatch(/erro|wrong|try/i);
  });
});
