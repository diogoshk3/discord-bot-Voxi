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
import { metrics } from '../src/metrics';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';
import { addBlockword } from '../src/store/blocklist';
import { setNickname } from '../src/store/nickname';
import { setUserVoice } from '../src/store/userVoice';

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
    // xsaid: mapa do último locutor (partilhado entre chamadas do mesmo deps) — sem ele
    // não há supressão de consecutivos.
    lastSpeaker: new Map<string, string>(),
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
function makeMessage(
  opts: {
    bot?: boolean;
    guild?: unknown;
    guildId?: string | null;
    channelId?: string;
    content?: string;
    mention?: boolean;
    replyToBot?: boolean;
    attachments?: Array<{ contentType?: string | null; name?: string | null }>;
    displayName?: string;
    authorId?: string;
    botVoiceChannelId?: string;
  } = {},
): any {
  const mention = opts.mention ?? false;
  const replyToBot = opts.replyToBot ?? false;

  return {
    author: { bot: opts.bot ?? false, id: opts.authorId ?? USER, username: opts.displayName },
    // attachments: Collection real tem .some(); um array serve para o mock.
    attachments: opts.attachments,
    guild:
      opts.guild !== undefined
        ? opts.guild
        : {
            // members.me.voice.channelId = canal de voz onde o bot está (text-in-voice).
            members: {
              cache: { get: () => undefined },
              me: { voice: { channelId: opts.botVoiceChannelId ?? null } },
            },
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
    // react: usado pelo feedback de rate-limit (🐢). Sempre presente no mock (o código
    // real chama-o best-effort com optional-chaining); os testes que não o usam ignoram-no.
    react: vi.fn().mockResolvedValue(undefined),
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

  // ── cache dos stores (plano 010) ──────────────────────────────────────────
  it('cache write-through: a 2.ª mensagem NÃO re-consulta guild_config', async () => {
    const deps = makeDeps(db, say);
    // 1.ª mensagem: popula a cache de guild_config (e outras tabelas do hot-path).
    await handleMessage(makeMessage({ content: 'primeira' }), deps);
    // Espia o db a partir daqui: na 2.ª mensagem o guild_config vem da cache.
    const spy = vi.spyOn(db, 'prepare');
    await handleMessage(makeMessage({ content: 'segunda' }), deps);
    const guildConfigSelects = spy.mock.calls.filter((c) =>
      String(c[0]).includes('FROM guild_config'),
    );
    expect(guildConfigSelects).toHaveLength(0); // servido da cache, sem SQL
    expect(say).toHaveBeenCalledTimes(2); // ambas foram lidas
    spy.mockRestore();
  });

  // ── 1. Autor é bot ────────────────────────────────────────────────────────
  it('mensagem de bot → ignorada por defeito (read_bots OFF)', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ bot: true }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  it('read_bots ON → mensagem de outro bot é lida', async () => {
    setGuildConfig(db, GUILD, { readBots: true });
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ bot: true, content: 'sou um bot' }), deps);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('sou um bot');
  });

  it('read_bots ON → o PRÓPRIO Vozen continua a NÃO ser lido (anti-loop)', async () => {
    setGuildConfig(db, GUILD, { readBots: true });
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ bot: true, authorId: BOT_ID, content: 'eco' }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  // ── text-in-voice: ler o chat de texto dentro do canal de voz do bot ──────
  it('text-in-voice ON → mensagem no canal de voz do bot é lida (mesmo não sendo o canal TTS)', async () => {
    setGuildConfig(db, GUILD, { textInVoice: true });
    const deps = makeDeps(db, say);
    // Mensagem num canal (o chat-em-voz 'vc-9') != canal TTS (CHAN); o bot está em 'vc-9'.
    await handleMessage(
      makeMessage({ content: 'olá do chat de voz', channelId: 'vc-9', botVoiceChannelId: 'vc-9' }),
      deps,
    );
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('olá do chat de voz');
  });

  it('text-in-voice OFF → mensagem no canal de voz do bot é ignorada', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(
      makeMessage({ content: 'olá', channelId: 'vc-9', botVoiceChannelId: 'vc-9' }),
      deps,
    );
    expect(say).not.toHaveBeenCalled();
  });

  it('text-in-voice ON mas mensagem NOUTRO canal de voz → ignorada', async () => {
    setGuildConfig(db, GUILD, { textInVoice: true });
    const deps = makeDeps(db, say);
    // Bot em 'vc-9' mas a mensagem veio de 'vc-outro'.
    await handleMessage(
      makeMessage({ content: 'olá', channelId: 'vc-outro', botVoiceChannelId: 'vc-9' }),
      deps,
    );
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
  it('rate-limited (ratePerMin = 0) → não fala, MAS o drop é visível (🐢 + métrica)', async () => {
    metrics.reset();
    setGuildConfig(db, GUILD, { ratePerMin: 0 });
    const deps = makeDeps(db, say);
    const msg = makeMessage();
    await handleMessage(msg, deps);
    expect(say).not.toHaveBeenCalled();
    // O drop deixou de ser silencioso: reage com 🐢 e conta a métrica.
    expect(msg.react).toHaveBeenCalledWith('🐢');
    expect(metrics.snapshot().messagesRateLimited).toBe(1);
  });

  // ── 9c. ABUSE-02: feedback de rate-limit throttled por (guild,user) ───────
  // Author DEDICADO ('user-fb-1') para não colidir com o cooldown já consumido pelo
  // teste 9 (a instância de RateLimitFeedbackCooldown é module-singleton em
  // messageHandler.ts, partilhada por todas as chamadas de handleMessage do processo).
  it('flood rate-limited: só a 1.ª mensagem dropada reage com 🐢, as seguintes ficam silenciosas', async () => {
    metrics.reset();
    setGuildConfig(db, GUILD, { ratePerMin: 0 });
    const deps = makeDeps(db, say);
    const msg1 = makeMessage({ authorId: 'user-fb-1' });
    const msg2 = makeMessage({ authorId: 'user-fb-1' });
    const msg3 = makeMessage({ authorId: 'user-fb-1' });

    await handleMessage(msg1, deps);
    await handleMessage(msg2, deps);
    await handleMessage(msg3, deps);

    expect(say).not.toHaveBeenCalled();
    // A métrica conta TODOS os drops — não é afetada pelo throttle do feedback visível.
    expect(metrics.snapshot().messagesRateLimited).toBe(3);
    // Só a 1.ª mensagem reage; a 2.ª e a 3.ª (mesma janela) ficam silenciosas.
    expect(msg1.react).toHaveBeenCalledWith('🐢');
    expect(msg2.react).not.toHaveBeenCalled();
    expect(msg3.react).not.toHaveBeenCalled();
  });

  // ── 9b. Ordem dos filtros: mensagem NÃO-legível não consome token ─────────
  // BUG (Fable): o rate-limit corria ANTES do cleanText/guard-de-legível, por isso um
  // emoji/link (que nunca ia ser falado) queimava o orçamento e silenciava a mensagem
  // legível seguinte. Com 1 token: emoji-só + "ola" -> "ola" DEVE ser falado.
  it('mensagem só-emoji não gasta token do rate-limit (a legível seguinte fala)', async () => {
    setGuildConfig(db, GUILD, { ratePerMin: 1 });
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: '🎉' }), deps); // não-legível: não deve gastar token
    await handleMessage(makeMessage({ content: 'ola' }), deps); // legível: usa o token
    expect(say).toHaveBeenCalledTimes(1);
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

  // ── 11. Blocklist hit → redação (lê o resto sem a palavra) ────────────────
  it('palavra da blocklist é REDIGIDA → fala o resto sem essa palavra', async () => {
    addBlockword(db, GUILD, 'spam');
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'isto é spam aqui' }), deps);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('isto é aqui');
  });

  it('mensagem que é SÓ a palavra bloqueada → não fala (nada legível resta)', async () => {
    addBlockword(db, GUILD, 'spam');
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'spam' }), deps);
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

  it('xsaid ON + corpo é SÓ palavra bloqueada → não anuncia "{nome} said" vazio', async () => {
    addBlockword(db, GUILD, 'spam');
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'spam', displayName: 'Alex' }), deps);
    expect(say).not.toHaveBeenCalled();
  });

  it('xsaid ON + corpo com palavra bloqueada → anuncia só o resto', async () => {
    addBlockword(db, GUILD, 'spam');
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olá spam mundo', displayName: 'Alex' }), deps);
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

  // ── motor por-utilizador: req.engine segue a escolha do autor ─────────────
  it('user com motor Piper → a mensagem sai com req.engine="piper"', async () => {
    setUserVoice(db, GUILD, USER, 'en_US-amy-medium', 1, 'piper');
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olá' }), deps);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].engine).toBe('piper');
  });

  it('user sem voz definida → req.engine indefinido (default Google no router)', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olá' }), deps);
    expect(say.mock.calls[0][0].engine).toBeUndefined();
  });

  it('spoiler → conteúdo NÃO é lido, anuncia "spoiler" (xsaid OFF)', async () => {
    setGuildConfig(db, GUILD, { xsaid: false });
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olha ||o segredo|| aqui' }), deps);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toBe('olha aqui spoiler');
  });

  // ── xsaid: não repetir o nome em mensagens seguidas do mesmo autor ────────
  it('mesmo autor 2x seguidas → só a 1.ª leva "{nome} said"', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'primeira', displayName: 'Alex' }), deps);
    await handleMessage(makeMessage({ content: 'segunda', displayName: 'Alex' }), deps);
    expect(say).toHaveBeenCalledTimes(2);
    expect(say.mock.calls[0][0].text).toBe('Alex said primeira');
    expect(say.mock.calls[1][0].text).toBe('segunda'); // sem prefixo
  });

  it('autores alternados (A, B, A) → todos anunciam', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'um', displayName: 'Alex', authorId: 'A' }), deps);
    await handleMessage(makeMessage({ content: 'dois', displayName: 'Bea', authorId: 'B' }), deps);
    await handleMessage(makeMessage({ content: 'tres', displayName: 'Alex', authorId: 'A' }), deps);
    expect(say.mock.calls[0][0].text).toBe('Alex said um');
    expect(say.mock.calls[1][0].text).toBe('Bea said dois');
    expect(say.mock.calls[2][0].text).toBe('Alex said tres'); // A voltou depois de B
  });

  // ── xsaid: nome sanitizado + apelido (/voice nickname) ────────────────────
  it('nome com emojis/símbolos é sanitizado no anúncio', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olá', displayName: '🔥xX_Alex_Xx🔥' }), deps);
    expect(say.mock.calls[0][0].text).toBe('xX Alex Xx said olá');
  });

  it('apelido (/voice nickname) tem prioridade sobre o displayName', async () => {
    setNickname(db, GUILD, USER, 'Zé');
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olá', displayName: 'ComplicatedName123' }), deps);
    expect(say.mock.calls[0][0].text).toBe('Zé said olá');
  });

  it('nome 100% emojis (sem apelido) → sem prefixo (nada legível)', async () => {
    const deps = makeDeps(db, say);
    await handleMessage(makeMessage({ content: 'olá', displayName: '🔥💯✨' }), deps);
    expect(say.mock.calls[0][0].text).toBe('olá');
  });
});
