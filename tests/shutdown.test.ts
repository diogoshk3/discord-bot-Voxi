// tests/shutdown.test.ts
import { describe, it, expect, vi } from 'vitest';
import { shutdown } from '../src/bot/shutdown';
import type { GuildVoicePlayer } from '../src/voice/player';
import type Database from 'better-sqlite3';

function fakePlayer() {
  return { destroy: vi.fn() } as unknown as GuildVoicePlayer;
}

function fakeDb() {
  // Modela a propriedade `open` do better-sqlite3: flip para false ao fechar.
  const db = {
    open: true,
    close: vi.fn(function (this: { open: boolean }) {
      this.open = false;
    }),
  };
  return db as unknown as Database.Database & { open: boolean; close: ReturnType<typeof vi.fn> };
}

describe('shutdown', () => {
  it('destroi todos os players e fecha a DB', () => {
    const p1 = fakePlayer();
    const p2 = fakePlayer();
    const players = new Map<string, GuildVoicePlayer>([
      ['g1', p1],
      ['g2', p2],
    ]);
    const db = fakeDb();

    shutdown({ players, db });

    expect(p1.destroy).toHaveBeenCalledTimes(1);
    expect(p2.destroy).toHaveBeenCalledTimes(1);
    expect(db.close).toHaveBeenCalledTimes(1);
    // O mapa fica vazio para que uma 2.a chamada nao re-destrua nada.
    expect(players.size).toBe(0);
  });

  it('e idempotente: chamar 2x nao rebenta nem re-fecha a DB', () => {
    const p1 = fakePlayer();
    const players = new Map<string, GuildVoicePlayer>([['g1', p1]]);
    const db = fakeDb();

    shutdown({ players, db });
    expect(() => shutdown({ players, db })).not.toThrow();

    // destroy do player so e chamado na 1.a vez (mapa ja foi esvaziado).
    expect(p1.destroy).toHaveBeenCalledTimes(1);
    // close() so na 1.a vez — guardado por db.open.
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('sem players: fecha a DB na mesma', () => {
    const players = new Map<string, GuildVoicePlayer>();
    const db = fakeDb();

    shutdown({ players, db });

    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('continua a fechar a DB mesmo que um player.destroy() lance', () => {
    const bad = { destroy: vi.fn(() => { throw new Error('boom'); }) } as unknown as GuildVoicePlayer;
    const good = fakePlayer();
    const players = new Map<string, GuildVoicePlayer>([
      ['g1', bad],
      ['g2', good],
    ]);
    const db = fakeDb();

    expect(() => shutdown({ players, db })).not.toThrow();
    expect(good.destroy).toHaveBeenCalledTimes(1);
    expect(db.close).toHaveBeenCalledTimes(1);
  });
});
