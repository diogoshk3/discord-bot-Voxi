// tests/commandsGameStop.test.ts — /game stop com gate de permissão (plano 030, ABUSE-04).
// Antes, QUALQUER membro podia parar o jogo de outro (sem gate nenhum). Gate mínimo:
// exige ManageGuild — mesmo padrão de /transcribe stop (transcribe.ts) e /config
// (config.ts): `i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { handleGame } from '../src/commands/handlers/games';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';

const GUILD = 'g-game';
const USER = 'user-1';

function makeDeps(db: Database.Database, stop: ReturnType<typeof vi.fn>): BotDeps {
  return {
    db,
    games: { stop },
  } as unknown as BotDeps;
}

function makeStopInteraction(opts: { canManage: boolean }) {
  const replies: string[] = [];
  return {
    guildId: GUILD,
    user: { id: USER },
    memberPermissions: { has: () => opts.canManage },
    options: { getSubcommand: () => 'stop' },
    reply: vi.fn(async (o: { content: string }) => {
      replies.push(o.content);
    }),
    replies,
  };
}

describe('/game stop — gate de permissão (ABUSE-04)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('SEM ManageGuild: recusa com erro e NÃO chama games.stop', async () => {
    const stop = vi.fn().mockReturnValue(true);
    const deps = makeDeps(db, stop);
    const i = makeStopInteraction({ canManage: false });

    await handleGame(i as any, deps);

    expect(stop).not.toHaveBeenCalled();
    expect(i.replies.some((r) => /manage server/i.test(r))).toBe(true);
  });

  it('COM ManageGuild: chama games.stop e responde "parei o jogo"', async () => {
    const stop = vi.fn().mockReturnValue(true);
    const deps = makeDeps(db, stop);
    const i = makeStopInteraction({ canManage: true });

    await handleGame(i as any, deps);

    expect(stop).toHaveBeenCalledWith(GUILD);
    expect(i.replies.some((r) => /stopped/i.test(r))).toBe(true);
  });

  it('COM ManageGuild mas sem jogo ativo: responde "nenhum jogo a decorrer"', async () => {
    const stop = vi.fn().mockReturnValue(false);
    const deps = makeDeps(db, stop);
    const i = makeStopInteraction({ canManage: true });

    await handleGame(i as any, deps);

    expect(stop).toHaveBeenCalledWith(GUILD);
    expect(i.replies.some((r) => /no game running/i.test(r))).toBe(true);
  });
});
