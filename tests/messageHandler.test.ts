/**
 * messageHandler.test.ts — ramos ainda NÃO cobertos pelos testes existentes
 * (messageHandlerRole.test.ts cobre role-gating; messageHandlerOptout.test.ts
 *  cobre opt-out e o caminho feliz básico com autoread).
 *
 * Cobre:
 *  1. bot → ignorado
 *  2. !guild / !guildId → ignorado
 *  3. conteúdo vazio → ignorado
 *  4. cfg.enabled === false → ignorado
 *  5. sem trigger (não canal autoread, não menção, não reply) → ignorado
 *  6. reply ao bot → ativado
 *  7. menção ao bot → ativado (sem autoread)
 *  8. sem player ativo → não fala
 *  9. rate-limited (ratePerMin = 0) → não fala
 * 10. texto vazio após cleanText (só emoji) → não fala
 * 11. blocklist hit → não fala
 * 12. caminho feliz (autoread + tudo ok) → player.say chamado com texto correto
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { handleMessage } from '../src/commands/messageHandler';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';
import { addBlockword } from '../src/store/blocklist';

const GUILD = 'g-main';
const CHAN = 'chan-autoread';
const BOT_ID = 'bot-1';
const USER = 'user-1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(db: Database.Database, say: ReturnType<typeof vi.fn>): BotDeps {
  const players = new Map<string, unknown>();
  players.set(GUILD, { say });
  return {
    client: {
      user: { id: BOT_ID },
      users: { cache: { get: () => undefined } },
    },
    db,
    players,
    limiters: new Map(),
    availableModels: ['en_US-amy-medium'],
    config: { defaultVoice: 'en_US-amy-medium', defaultSpeed: 1.0 },
  } as unknown as BotDeps;
}

/** deps sem nenhum player registado */
function makeDepsNoPlayer(db: Database.Database): BotDeps {
  return {
    client: {
      user: { id: BOT_ID },
      users: { cache: { get: () => undefined } },
    },
    db,
    players: new Map(),
    limiters: new Map(),
    availableModels: ['en_US-amy-medium'],
    config: { defaultVoice: 'en_US-amy-medium', defaultSpeed: 1.0 },
  } as unknown as BotDeps;
}

/**
 * Mensagem base: autor humano, no canal CHAN, com conteúdo "ola mundo".
 * opts permitem sobrescrever qualquer campo.
 */
function makeMessage(opts: {
  bot?: boolean;
  guild?: unknown;
  guildId?: string | null;
  channelId?: string;
  content?: string;
  mention?: boolean;
  replyToBot?: boolean;
  attachments?: Array<{ contentType?: string | null; name?: string | null }>;
  displayName?: string;
} = {}): any {
  const mention = opts.mention ?? false;
  const replyToBot = opts.replyToBot ?? false;

  return {
    author: { bot: opts.bot ?? false, id: USER, username: opts.displayName },
    // attachments: Collection real tem .some(); um array serve para o mock.
    attachments: opts.attachments,
    guild:
      opts.guild !== undefined
        ? opts.guild
        : {
            members: { cache: { get: () => undefined } },
            channels: { cache: { get: () => undefined } },
          },
    guildId: opts.guildId !== undefined ? opts.guildId : GUILD,
    channelId: opts.channelId ?? CHAN,
    content: opts.content !== undefined ? opts.content : 'ola mundo',
    // sem role gating nos testes desta suite (ttsRoleId = null por defeito).
    // displayName (nick no servidor) alimenta o xsaid; omitido -> sem nome -> sem anúncio.
    member: { displayName: opts.displayName, roles: { cache: { has: () => true } } },
    mentions: {
      has: () => mention,
      repliedUser: replyToBot ? { id: BOT_ID } : null,
    },
    reference: replyToBot ? { messageId: 'msg-ref-1' } : null,
  };
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('handleMessage — ramos não cobertos pelos testes existentes', () => {
  let db: Database.Database;
  let say: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = initDb(':memory:');
    say = vi.fn().mockResolvedValue(undefined);
    // Configuração base: autoread ativo no canal CHAN, bot ligado
    setGuildConfig(db, GUILD, {
      autoread: true,
      ttsChannelId: CHAN,
      enabled: true,
    });
  });

  afterEach(() => {
    db.close();
  });

  // ── 1. Autor é bot ────────────────────────────────────────────────────────
  it('mensagem de bot → ignorada (sem say)', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ bot: true }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── 2. Sem guild ──────────────────────────────────────────────────────────
  it('message.guild é null → ignorada', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ guild: null }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  it('message.guildId é null → ignorada', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ guildId: null }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── 3. Conteúdo vazio ─────────────────────────────────────────────────────
  it('content vazio ("") → ignorada', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: '' }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── 4. Kill-switch da guild ───────────────────────────────────────────────
  it('cfg.enabled === false → ignorada (kill-switch)', async () => {
    setGuildConfig(db, GUILD, { enabled: false });
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage(), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── 5. Sem trigger (canal errado, sem menção, sem reply) ─────────────────
  it('canal diferente do autoread e sem menção/reply → ignorada', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ channelId: 'outro-canal' }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── 6. Reply ao bot como trigger ─────────────────────────────────────────
  it('reply ao bot no canal errado → ativado (reply é trigger explícito)', async () => {
    const deps = makeDeps(db, say);
    // Canal diferente do autoread, mas é reply ao bot → deve falar
    await handleMessage(makeMessage({ channelId: 'outro-canal', replyToBot: true }), deps);
    expect(say).toHaveBeenCalledTimes(1);
  });

  // ── 7. Menção ao bot como trigger (sem autoread) ──────────────────────────
  it('menção ao bot fora do canal autoread → ativado', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ channelId: 'outro-canal', mention: true }), deps);
    expect(say).toHaveBeenCalledTimes(1);
  });

  // ── 8. Sem player ativo na guild ──────────────────────────────────────────
  it('sem player ativo → não tenta falar', async () => {
    const deps = makeDepsNoPlayer(db);
    await handleMessage(makeMessage(), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── 9. Rate-limited ───────────────────────────────────────────────────────
  it('rate-limited (ratePerMin = 0) → não fala', async () => {
    setGuildConfig(db, GUILD, { ratePerMin: 0 });
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage(), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── 10. Texto vazio após cleanText ────────────────────────────────────────
  it('conteúdo só com emoji (vazio após cleanText) → não fala', async () => {
    const deps = makeDeps(db, say);
    // 🎉 é Extended_Pictographic → cleanText remove-o e fica ''
    await handleMessage(makeMessage({ content: '🎉' }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── 10b. Emoji com componentes zero-width / bandeiras → não fala ──────────
  // Antes do fix, ❤️ (U+2764 U+FE0F) e as bandeiras deixavam resíduo zero-width
  // truthy que passava o guard `if (!cleaned)` → Piper sintetizava clipe vazio.
  it('conteúdo só com ❤️ (VS16) → não fala', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: '❤️' }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  it('conteúdo só com bandeira 🇦🇩 → não fala', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: '🇦🇩' }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── 10c. Só pontuação → não fala (guard exige letra/número) ───────────────
  // Isola a mudança do guard: cleanText('!!!') = '!!!' (truthy), logo o antigo
  // guard `if (!cleaned)` deixava passar. O novo guard exige \p{L}\p{N}.
  it('conteúdo só com pontuação ("!!!") → não fala', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: '!!!' }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── 10d. Texto com dígitos ("$100") → fala (contém \p{N}) ─────────────────
  it('conteúdo com dígitos ("$100") → fala (passa o guard)', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: '$100' }), deps);
    expect(say).toHaveBeenCalledTimes(1);
  });

  // ── 11. Blocklist hit ─────────────────────────────────────────────────────
  it('texto contém palavra da blocklist → não fala', async () => {
    addBlockword(db, GUILD, 'spam');
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'isto é spam aqui' }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── 12. Caminho feliz ─────────────────────────────────────────────────────
  it('caminho feliz (autoread + tudo ok) → player.say chamado com texto limpo', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olá mundo' }), deps);
    expect(say).toHaveBeenCalledTimes(1);
    // O SynthRequest deve conter o texto limpo (sem emojis, etc.)
    const req = say.mock.calls[0][0];
    expect(req).toMatchObject({
      text: 'olá mundo',
      model: expect.any(String),
      speed: expect.any(Number),
    });
  });

  // ── GIF anexado (sem texto) → "a gif" ─────────────────────────────────────
  it('anexo .gif sem texto → player.say com "a gif"', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(
      makeMessage({ content: '', attachments: [{ contentType: 'image/gif', name: 'cat.gif' }] }),
      deps,
    );
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('a gif');
  });

  it('anexo detetado por .gif no nome (contentType null) → "a gif"', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(
      makeMessage({ content: '', attachments: [{ contentType: null, name: 'boom.GIF' }] }),
      deps,
    );
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('a gif');
  });

  it('texto + anexo .gif → texto seguido de "a gif"', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(
      makeMessage({ content: 'olha', attachments: [{ contentType: 'image/gif', name: 'x.gif' }] }),
      deps,
    );
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('olha a gif');
  });

  it('anexo png sem texto → anuncia "an image" (por tipo)', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(
      makeMessage({ content: '', attachments: [{ contentType: 'image/png', name: 'foto.png' }] }),
      deps,
    );
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('an image');
  });

  it('vários anexos sem texto → "multiple files"', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(
      makeMessage({
        content: '',
        attachments: [
          { contentType: 'image/png', name: 'a.png' },
          { contentType: 'video/mp4', name: 'b.mp4' },
        ],
      }),
      deps,
    );
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('multiple files');
  });

  it('link no texto → corpo + "a link"', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olha https://exemplo.com' }), deps);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('olha a link');
  });

  it('mensagem só com um link → "a link" (corpo vazio)', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'https://exemplo.com' }), deps);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('a link');
  });

  // ── xsaid (LIGADO por defeito): "{nome} said {mensagem}" ──────────────────
  it('xsaid ON (default) + nome → "{nome} said {corpo}"', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olá mundo', displayName: 'Alex' }), deps);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('Alex said olá mundo');
  });

  it('xsaid ON + media → "{nome} said {corpo} {media}"', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(
      makeMessage({
        content: 'olha',
        displayName: 'Alex',
        attachments: [{ contentType: 'image/gif', name: 'x.gif' }],
      }),
      deps,
    );
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('Alex said olha a gif');
  });

  it('xsaid ON + só um gif (sem corpo) → "{nome} said a gif"', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(
      makeMessage({
        content: '',
        displayName: 'Alex',
        attachments: [{ contentType: 'image/gif', name: 'x.gif' }],
      }),
      deps,
    );
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('Alex said a gif');
  });

  it('xsaid OFF → sem prefixo de nome (lê só a mensagem)', async () => {
    setGuildConfig(db, GUILD, { xsaid: false });
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olá mundo', displayName: 'Alex' }), deps);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('olá mundo');
  });

  it('spoiler → conteúdo NÃO é lido, anuncia "spoiler" (xsaid OFF)', async () => {
    setGuildConfig(db, GUILD, { xsaid: false });
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olha ||o segredo|| aqui' }), deps);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('olha aqui spoiler');
  });
});
