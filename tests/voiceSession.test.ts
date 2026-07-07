// tests/voiceSession.test.ts — o guard IDENTITY-AWARE do onIdle em createVoiceSession.
//
// Cenário (variante do P19.B ao nível do createVoiceSession): quando um player é
// SUBSTITUÍDO (novo /join ou autojoin na mesma guild), o onIdle do player VELHO pode
// disparar tarde. Esse callback obsoleto NÃO pode derrubar o player NOVO. O guard é a
// linha `if (deps.players.get(guildId) !== player) return;`. Nenhum teste exercitava o
// closure REAL construído aqui (um mockava o módulo todo, outro testava uma réplica).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType } from 'discord.js';

// Mock de @discordjs/voice — só o que o session.ts chama em runtime.
const h = vi.hoisted(() => ({
  joinVoiceChannel: vi.fn((_opts: unknown) => ({ fake: 'connection' })),
  connDestroy: vi.fn(),
}));
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: (opts: unknown) => h.joinVoiceChannel(opts),
  getVoiceConnection: () => ({ destroy: h.connDestroy }),
}));

// Fake do GuildVoicePlayer que CAPTURA o onIdle (5.º arg do ctor) e expõe destroy.
const captured = vi.hoisted(() => ({ players: [] as Array<{ onIdle: () => void; destroy: ReturnType<typeof vi.fn> }> }));
vi.mock('../src/voice/player', () => ({
  GuildVoicePlayer: class {
    onIdle: () => void;
    destroy = vi.fn();
    constructor(_conn: unknown, _engine: unknown, _cap: number, _idleMs: number, onIdle: () => void) {
      this.onIdle = onIdle;
      captured.players.push(this as unknown as { onIdle: () => void; destroy: ReturnType<typeof vi.fn> });
    }
  },
}));

import { createVoiceSession, becomeSpeakerIfStage } from '../src/voice/session';
import type { BotDeps } from '../src/bot/deps';

function makeDeps(): BotDeps {
  return {
    players: new Map(),
    engine: {},
    config: { queueCap: 20, inactivityMs: 1000 },
  } as unknown as BotDeps;
}

describe('createVoiceSession — guard identity-aware do onIdle', () => {
  beforeEach(() => {
    captured.players.length = 0;
    h.joinVoiceChannel.mockClear();
    h.connDestroy.mockClear();
  });

  it('(a) idle normal: remove o player e destrói a ligação', () => {
    const deps = makeDeps();
    const player = createVoiceSession(deps, 'G', 'C', {} as never) as unknown as { onIdle: () => void; destroy: ReturnType<typeof vi.fn> };
    expect(deps.players.get('G')).toBe(player);
    expect(h.joinVoiceChannel).toHaveBeenCalledWith({
      channelId: 'C',
      guildId: 'G',
      adapterCreator: {},
      selfDeaf: true,
      selfMute: false,
    });
    player.onIdle();
    expect(deps.players.has('G')).toBe(false);
    expect(player.destroy).toHaveBeenCalled();
    expect(h.connDestroy).toHaveBeenCalledTimes(1);
  });

  it('(b) REGRESSÃO: o onIdle do player VELHO não derruba o SUBSTITUTO', () => {
    const deps = makeDeps();
    const a = createVoiceSession(deps, 'G', 'C1', {} as never) as unknown as { onIdle: () => void; destroy: ReturnType<typeof vi.fn> };
    const b = createVoiceSession(deps, 'G', 'C2', {} as never) as unknown as { onIdle: () => void; destroy: ReturnType<typeof vi.fn> };
    expect(deps.players.get('G')).toBe(b);
    h.connDestroy.mockClear(); // isola o callback obsoleto (o replace já chamou removePlayer)
    // Dispara o closure OBSOLETO do A:
    a.onIdle();
    // O guard segurou: B continua registado e intacto.
    expect(deps.players.get('G')).toBe(b);
    expect(b.destroy).not.toHaveBeenCalled();
    expect(h.connDestroy).not.toHaveBeenCalled();
  });

  it('(c) becomeSpeakerIfStage é no-op num canal de voz NORMAL (não-palco)', () => {
    const setSuppressed = vi.fn();
    const channel = {
      type: ChannelType.GuildVoice,
      guild: { members: { me: { voice: { setSuppressed } } } },
    } as never;
    expect(() => becomeSpeakerIfStage(channel)).not.toThrow();
    expect(setSuppressed).not.toHaveBeenCalled();
  });
});
