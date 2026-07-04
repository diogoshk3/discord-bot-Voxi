/**
 * integration.pipeline.test.ts — teste de integracao END-TO-END (P10.2).
 *
 * Ao contrario das suites existentes (que exercitam modulos ISOLADOS ou ramos
 * especificos do messageHandler), este teste percorre o CAMINHO CENTRAL COMPLETO
 * de auto-leitura de ponta a ponta, com dependencias REAIS:
 *
 *   handleMessage (trigger/gating/rate-limit)
 *     -> cleanText        (limpeza real: URL, emoji, mencoes)
 *     -> applyPronunciation(dicionario real da guild, via store SQLite)
 *     -> isBlocked         (blocklist real da guild, via store SQLite)
 *     -> resolveSynth      (detectLang via franc + pickVoice)
 *     -> player.say(req)   (capturado por um spy observavel)
 *
 * O store e um SQLite :memory: real (initDb), configurado com guild_config,
 * blocklist, opt-out e pronuncia conforme cada caso. So o player (e portanto o
 * Piper/Discord reais) e que e falso: capturamos o SynthRequest passado a say()
 * — que carrega `text` E `model` — e e ai que afirmamos "fala o texto certo na
 * voz certa". Esse req e o FIM do pipeline central, por isso o spy NAO e hollow.
 *
 * Armadilhas evitadas (ver porque o teste e real e nao passa por engano):
 *  - franc precisa de texto LONGO: frases curtas devolvem '' e cairiam no
 *    fallback. As frases PT/EN sao longas e foram verificadas (por/eng).
 *  - contaminacao de fallback: o fallback global e uma TERCEIRA lingua
 *    (de_DE-...), e a guild nao define default_voice. Assim, se a deteccao
 *    falhasse silenciosamente, a voz cairia em `de_` — e as asercoes de prefixo
 *    pt_/en_ FALHAVAM em vez de passar por acidente.
 *  - cada `it()` usa db + deps frescos (limiters Map novo) para nao haver
 *    contaminacao de rate-limit ou estado entre casos.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { handleMessage } from '../src/commands/messageHandler';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';
import { addBlockword } from '../src/store/blocklist';
import { setOptOut } from '../src/store/optout';
import { addPronunciation } from '../src/store/pronunciation';
import { setDetection } from '../src/store/langDetect';

const GUILD = 'g-integration';
const CHAN = 'chan-autoread';
const BOT_ID = 'bot-1';
const USER = 'user-1';

// Modelos disponiveis no "Piper" falso: PT europeu + EN. Inclui pt_ e en_ para
// que pickVoice consiga escolher por prefixo quando a deteccao acerta.
const AVAILABLE = ['pt_PT-tugao-medium', 'en_US-amy-medium'];
// Fallback GLOBAL deliberadamente numa TERCEIRA lingua (alemao). A guild NAO
// define default_voice (fica ''), por isso uma deteccao falhada cairia em de_ —
// nunca em pt_/en_ — tornando as asercoes de voz significativas.
const GLOBAL_FALLBACK = 'de_DE-thorsten-medium';

// ---------------------------------------------------------------------------
// Helpers (mesmos padroes das suites messageHandler*.test.ts)
// ---------------------------------------------------------------------------

/** deps com um player FALSO observavel (say spy) e store/config reais. */
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
    availableModels: AVAILABLE,
    config: { defaultVoice: GLOBAL_FALLBACK, defaultSpeed: 1.0 },
  } as unknown as BotDeps;
}

/**
 * Mensagem de auto-leitura no canal CHAN. `resolveUser`/`resolveChannel` do
 * handler leem destas caches reais da "guild", por isso uma mencao numerica
 * `<@123>` resolve para o displayName aqui definido — provando a integracao
 * cleanText <-> caches da guild.
 */
function makeMessage(opts: {
  content: string;
  channelId?: string;
  mention?: boolean;
  replyToBot?: boolean;
}): any {
  const mention = opts.mention ?? false;
  const replyToBot = opts.replyToBot ?? false;
  return {
    author: { bot: false, id: USER },
    guild: {
      members: {
        cache: {
          get: (id: string) => (id === '123' ? { displayName: 'Diogo' } : undefined),
        },
      },
      channels: {
        cache: {
          get: (id: string) => (id === '456' ? { name: 'geral' } : undefined),
        },
      },
    },
    guildId: GUILD,
    channelId: opts.channelId ?? CHAN,
    content: opts.content,
    member: { roles: { cache: { has: () => true } } },
    mentions: {
      has: () => mention,
      repliedUser: replyToBot ? { id: BOT_ID } : null,
    },
    reference: replyToBot ? { messageId: 'msg-ref-1' } : null,
  };
}

// ---------------------------------------------------------------------------

describe('pipeline central — integracao end-to-end (store real + player falso)', () => {
  let db: Database.Database;
  let say: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = initDb(':memory:');
    say = vi.fn().mockResolvedValue(undefined);
    // Auto-leitura ligada no canal CHAN. default_voice fica '' (a guild nao
    // define voz) => a precedencia cai para config.defaultVoice (de_) quando a
    // deteccao de lingua nao mapeia.
    setGuildConfig(db, GUILD, {
      autoread: true,
      ttsChannelId: CHAN,
      enabled: true,
      defaultVoice: '',
    });
    // A deteccao de lingua->voz e agora OPT-IN (default OFF = voz unica fixa). Este
    // teste exercita DELIBERADAMENTE o caminho de deteccao ("voz certa" por lingua),
    // por isso ligamo-la explicitamente para o USER.
    setDetection(db, GUILD, USER, true);
  });

  afterEach(() => {
    db.close();
  });

  // ── 1. CAMINHO FELIZ PT ───────────────────────────────────────────────────
  it('mensagem em portugues -> texto limpo + voz pt_', async () => {
    const deps = makeDeps(db, say);
    const content =
      'bom dia a todos os membros deste servidor espero que estejam todos bem e com muita saude';

    await handleMessage(makeMessage({ content }), deps);

    expect(say).toHaveBeenCalledTimes(1);
    const req = say.mock.calls[0][0];
    // TEXTO: sem alteracoes de limpeza/pronuncia neste caso => identico.
    expect(req.text).toBe(content);
    // VOZ: deteta PT e escolhe o modelo pt_ disponivel (nao o fallback de_).
    expect(req.model).toBe('pt_PT-tugao-medium');
    expect(req.model.startsWith('pt_')).toBe(true);
    expect(req.speed).toBe(1.0);
  });

  // ── 2. CAMINHO FELIZ EN ───────────────────────────────────────────────────
  it('mensagem em ingles -> texto limpo + voz en_', async () => {
    const deps = makeDeps(db, say);
    const content =
      'good morning to all the members of this server i hope you are all doing well and feeling great';

    await handleMessage(makeMessage({ content }), deps);

    expect(say).toHaveBeenCalledTimes(1);
    const req = say.mock.calls[0][0];
    expect(req.text).toBe(content);
    // VOZ: deteta EN e escolhe en_ — distinto do fallback de_, logo significativo.
    expect(req.model).toBe('en_US-amy-medium');
    expect(req.model.startsWith('en_')).toBe(true);
    expect(req.speed).toBe(1.0);
  });

  // ── 3. BLOCKLIST corta ────────────────────────────────────────────────────
  it('mensagem que bate na blocklist -> player NAO recebe say()', async () => {
    addBlockword(db, GUILD, 'spam');
    const deps = makeDeps(db, say);
    const content =
      'isto aqui e claramente spam e nao deve ser lido pelo bot em circunstancia nenhuma hoje';

    await handleMessage(makeMessage({ content }), deps);

    expect(say).not.toHaveBeenCalled();
  });

  // ── 4. OPT-OUT corta a leitura passiva ────────────────────────────────────
  it('utilizador opted-out -> leitura passiva do canal NAO fala', async () => {
    setOptOut(db, GUILD, USER);
    const deps = makeDeps(db, say);
    const content =
      'bom dia a todos os membros deste servidor espero que estejam todos bem e com muita saude';

    await handleMessage(makeMessage({ content }), deps);

    expect(say).not.toHaveBeenCalled();
  });

  it('opted-out MAS com mencao explicita ao bot -> ainda fala (accao explicita)', async () => {
    setOptOut(db, GUILD, USER);
    const deps = makeDeps(db, say);
    const content =
      'bom dia a todos os membros deste servidor espero que estejam todos bem e com muita saude';

    await handleMessage(makeMessage({ content, mention: true }), deps);

    expect(say).toHaveBeenCalledTimes(1);
    const req = say.mock.calls[0][0];
    expect(req.text).toBe(content);
    expect(req.model.startsWith('pt_')).toBe(true);
  });

  // ── 5. LIMPEZA real (URL/emoji/mencoes) chega limpa ao player ─────────────
  it('URL + emoji + mencao de user/canal -> player recebe o TEXTO LIMPO', async () => {
    const deps = makeDeps(db, say);
    // <@123> resolve para "Diogo" e <#456> para "geral" via caches da guild.
    const content = 'olha este link https://exemplo.pt/artigo 🎉 que o <@123> mandou no <#456>';

    await handleMessage(makeMessage({ content }), deps);

    expect(say).toHaveBeenCalledTimes(1);
    const req = say.mock.calls[0][0];
    // URL removida do corpo; emoji removido; <@123> -> Diogo; <#456> -> geral. O
    // anúncio do link é ACRESCENTADO no fim e LOCALIZADO na voz (texto PT -> voz pt_
    // -> "um link"). Prova o pipeline end-to-end da media localizada.
    expect(req.text).toBe('olha este link que o Diogo mandou no geral um link');
    expect(req.model.startsWith('pt_')).toBe(true);
  });

  // ── 6. PRONUNCIA real aplicada antes do synth ─────────────────────────────
  it('dicionario de pronuncia da guild -> termo substituido no texto falado', async () => {
    addPronunciation(db, GUILD, 'JS', 'JavaScript');
    const deps = makeDeps(db, say);
    const content =
      'eu adoro programar em JS todos os dias da semana porque e muito divertido e produtivo sempre';

    await handleMessage(makeMessage({ content }), deps);

    expect(say).toHaveBeenCalledTimes(1);
    const req = say.mock.calls[0][0];
    // "JS" -> "JavaScript" (pronuncia aplicada DEPOIS do cleanText, ANTES do synth).
    expect(req.text).toBe(
      'eu adoro programar em JavaScript todos os dias da semana porque e muito divertido e produtivo sempre',
    );
    // Continua a detetar PT apos a substituicao.
    expect(req.model.startsWith('pt_')).toBe(true);
  });

  // ── 7. PRECEDENCIA: /pronunciation da guild > giria embutida ──────────────
  it('pronuncia da guild SOMBREIA uma giria EN embutida (config vence)', async () => {
    // 'brb' e giria embutida ("be right back"), mas a guild redefine-a via /pronunciation.
    addPronunciation(db, GUILD, 'brb', 'bora rapaz');
    const deps = makeDeps(db, say);
    const content = 'brb';

    await handleMessage(makeMessage({ content }), deps);

    expect(say).toHaveBeenCalledTimes(1);
    const req = say.mock.calls[0][0];
    // Pronuncia aplicada ANTES do embutido: sai o texto da guild, NAO "be right back".
    expect(req.text).toBe('bora rapaz');
    expect(req.text).not.toContain('be right back');
  });
});
