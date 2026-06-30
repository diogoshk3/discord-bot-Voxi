import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

// Mock de @discordjs/voice: joinVoiceChannel/getVoiceConnection sao spies para
// podermos afirmar que NAO se tenta ligar quando faltam permissoes.
const joinVoiceChannel = vi.fn();
const getVoiceConnection = vi.fn();
vi.mock('@discordjs/voice', async () => {
  const { EventEmitter } = await import('node:events');
  // AudioPlayer falso (so o necessario para o construtor do GuildVoicePlayer real).
  class FakeAudioPlayer extends EventEmitter {
    play(): void {}
    stop(): void {}
  }
  return {
    joinVoiceChannel: (...args: unknown[]) => joinVoiceChannel(...args),
    getVoiceConnection: (...args: unknown[]) => getVoiceConnection(...args),
    createAudioPlayer: () => new FakeAudioPlayer(),
    createAudioResource: (path: string) => ({ path }),
    entersState: () => Promise.resolve(),
    AudioPlayerStatus: { Idle: 'idle' },
    VoiceConnectionStatus: {
      Disconnected: 'disconnected',
      Signalling: 'signalling',
      Connecting: 'connecting',
      Ready: 'ready',
    },
    StreamType: { Arbitrary: 'arbitrary' },
  };
});

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';

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
}

function makeJoinInteraction(opts: {
  channel: unknown;
}): FakeInteraction {
  const replies: string[] = [];
  return {
    commandName: 'join',
    guildId: 'g1',
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: { content: string }) => {
      replies.push(o.content);
    },
    member: { voice: { channel: opts.channel } },
    guild: { voiceAdapterCreator: {} },
  };
}

function makeDeps(): BotDeps {
  // Apenas os campos que handleJoin toca; o resto fica como stub minimo.
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    config: { queueCap: 10, inactivityMs: 1000 },
  } as unknown as BotDeps;
}

describe('handleJoin — permissoes Connect/Speak', () => {
  beforeEach(() => {
    joinVoiceChannel.mockReset();
    getVoiceConnection.mockReset();
  });

  it('responde com mensagem clara e NAO liga quando faltam Connect/Speak', async () => {
    const channel = {
      id: 'c1',
      name: 'Geral',
      permissionsFor: () => ({ has: () => false }),
    };
    const i = makeJoinInteraction({ channel });
    const deps = makeDeps();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleInteraction(i as any, deps);

    expect(joinVoiceChannel).not.toHaveBeenCalled();
    expect(i.replies.some((r) => /permiss/i.test(r))).toBe(true);
    expect(i.replies.join(' ')).toContain('Geral');
  });

  it('liga quando tem Connect e Speak', async () => {
    const channel = {
      id: 'c1',
      name: 'Geral',
      permissionsFor: () => ({
        has: (flag: bigint) =>
          flag === PermissionFlagsBits.Connect || flag === PermissionFlagsBits.Speak,
      }),
    };
    const i = makeJoinInteraction({ channel });
    const deps = makeDeps();
    // Conexao falsa devolvida por joinVoiceChannel — so precisa de subscribe/on/destroy
    // porque o GuildVoicePlayer real e construido no handler.
    const fakeConn = {
      subscribe: () => {},
      on: () => {},
      destroy: () => {},
    };
    joinVoiceChannel.mockReturnValue(fakeConn);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleInteraction(i as any, deps);

    expect(joinVoiceChannel).toHaveBeenCalledTimes(1);
    expect(i.replies.some((r) => /Entrei/i.test(r))).toBe(true);

    // Limpeza: destruir o player criado para nao deixar timers pendurados.
    const player = deps.players.get('g1');
    player?.destroy();
  });

  it('responde "Tens de estar num canal" quando o membro nao esta em voz', async () => {
    const i = makeJoinInteraction({ channel: null });
    const deps = makeDeps();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleInteraction(i as any, deps);

    expect(joinVoiceChannel).not.toHaveBeenCalled();
    expect(i.replies.some((r) => /canal de voz/i.test(r))).toBe(true);
  });
});
