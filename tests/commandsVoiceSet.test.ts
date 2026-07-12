import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock minimo de @discordjs/voice — nao e usado no /voice set|reset, mas o import
// de index.ts resolve-o (mesmo padrao do commandsVoiceList.test.ts).
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { getUserVoice } from '../src/store/userVoice';
import { grantUserPremium, grantGuildPremium } from '../src/store/premium';
import type Database from 'better-sqlite3';

const GUILD = 'g-vset';
const USER = 'u-vset';

function makeDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map<string, unknown>(),
    db,
    config: { defaultSpeed: 1.0, defaultVoice: '' },
    availableModels: ['en_US-amy-medium', 'pt_PT-tugao-medium'],
    limiters: new Map(),
  } as unknown as BotDeps;
}

function makeVoiceInteraction(opts: {
  sub: string;
  model?: string;
  speed?: number | null;
  engine?: 'google' | 'piper' | 'kokoro' | 'gcloud';
}) {
  const replies: string[] = [];
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
      getSubcommandGroup: (_required = false) => null,
      getSubcommand: () => opts.sub,
      // name-aware: 'engine' devolve a opção do motor; qualquer outra ('model') o modelo.
      getString: (name: string, _required = false) =>
        name === 'engine' ? (opts.engine ?? null) : (opts.model ?? null),
      getNumber: (_name: string) => (opts.speed === undefined ? null : opts.speed),
    },
  };
}

describe('/voice set — copy beginner-friendly', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('confirma com o NOME AMIGAVEL da voz e mantem o id cru copy-pasteavel', async () => {
    const i = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium' });
    await handleInteraction(i as any, makeDeps(db));

    expect(i.replies).toHaveLength(1);
    const out = i.replies[0];
    // Nome amigavel (lingua + voz) em vez do id cru como titulo.
    expect(out).toContain('English (US) — Amy');
    // O id cru continua presente (copy-pasteavel para reusar / partilhar).
    expect(out).toContain('en_US-amy-medium');
    // Comportamento inalterado: a voz foi mesmo gravada.
    expect(getUserVoice(db, GUILD, USER)?.model).toBe('en_US-amy-medium');
  });

  it('inclui o PROXIMO PASSO para o iniciante ouvir a voz (via /tts)', async () => {
    const i = makeVoiceInteraction({ sub: 'set', model: 'pt_PT-tugao-medium' });
    await handleInteraction(i as any, makeDeps(db));

    const out = i.replies[0];
    // Aponta para /tts (sempre funciona, sem depender de auto-read configurado).
    expect(out).toContain('/tts');
  });

  it('sem engine -> default Google', async () => {
    const i = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium' });
    await handleInteraction(i as any, makeDeps(db));
    expect(getUserVoice(db, GUILD, USER)?.engine).toBe('google');
    expect(i.replies[0]).toContain('Google');
  });

  it('engine:piper -> grava piper e confirma', async () => {
    const i = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium', engine: 'piper' });
    await handleInteraction(i as any, makeDeps(db));
    expect(getUserVoice(db, GUILD, USER)?.engine).toBe('piper');
    expect(i.replies[0]).toContain('Piper');
  });

  it('mudar só a voz PRESERVA o motor escolhido antes (não repõe google)', async () => {
    // 1) escolhe Piper.
    await handleInteraction(
      makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium', engine: 'piper' }) as any,
      makeDeps(db),
    );
    // 2) muda só a voz (sem engine) -> continua Piper.
    await handleInteraction(
      makeVoiceInteraction({ sub: 'set', model: 'pt_PT-tugao-medium' }) as any,
      makeDeps(db),
    );
    expect(getUserVoice(db, GUILD, USER)?.model).toBe('pt_PT-tugao-medium');
    expect(getUserVoice(db, GUILD, USER)?.engine).toBe('piper');
  });
});

// Gap fechado (P: erros amigaveis): o builder do `speed` NAO tem min/max, por isso
// o Discord NAO rejeita client-side um valor fora de 0.5–2.0. Antes o handler fazia
// silent-clamp (5.0 -> 2.0) e respondia "sucesso" a 2× — uma surpresa silenciosa. O
// principiante deve receber um erro amigavel com o intervalo permitido e NADA e
// gravado (nao clamp-com-aviso: rejeicao). Boundaries 0.5 e 2.0 continuam validos.
// Gate Premium do motor Google HD (gcloud): só quem tem Vozen Plus (user) ou Vozen
// Premium (servidor) o pode ESCOLHER. Sem Premium -> mensagem locked + NADA gravado
// (a voz não fica presa num motor pago). Mesmo padrão dos efeitos premium.
describe('/voice set — gate do motor Google HD (gcloud)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('gcloud SEM Premium -> mensagem locked e NÃO grava a voz', async () => {
    const i = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium', engine: 'gcloud' });
    await handleInteraction(i as any, makeDeps(db));
    expect(i.replies).toHaveLength(1);
    expect(i.replies[0]).toContain('Google HD');
    expect(i.replies[0]).toMatch(/🔒|Premium/);
    // Nada gravado: a escolha paga foi recusada.
    expect(getUserVoice(db, GUILD, USER)).toBeNull();
  });

  it('gcloud COM Vozen Plus (user) -> grava gcloud e confirma "Google HD"', async () => {
    grantUserPremium(db, USER, 30, 'test', Date.now());
    const i = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium', engine: 'gcloud' });
    await handleInteraction(i as any, makeDeps(db));
    expect(getUserVoice(db, GUILD, USER)?.engine).toBe('gcloud');
    expect(i.replies[0]).toContain('Google HD');
  });

  it('gcloud COM Premium do servidor (guild) -> grava gcloud', async () => {
    grantGuildPremium(db, GUILD, 30, 'test', Date.now());
    const i = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium', engine: 'gcloud' });
    await handleInteraction(i as any, makeDeps(db));
    expect(getUserVoice(db, GUILD, USER)?.engine).toBe('gcloud');
  });
});

describe('/voice set — speed fora do intervalo (0.5–2.0)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('speed acima de 2.0 responde erro com o intervalo e NAO grava a voz', async () => {
    const i = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium', speed: 5 });
    await handleInteraction(i as any, makeDeps(db));

    expect(i.replies).toHaveLength(1);
    const out = i.replies[0];
    // Mensagem amigavel indica o intervalo permitido.
    expect(out).toContain('0.5');
    expect(out).toContain('2.0');
    // Nenhum estado invalido gravado (nao clamp-com-aviso: rejeicao).
    expect(getUserVoice(db, GUILD, USER)).toBeNull();
  });

  it('speed abaixo de 0.5 responde erro e NAO grava a voz', async () => {
    const i = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium', speed: 0.1 });
    await handleInteraction(i as any, makeDeps(db));

    expect(i.replies).toHaveLength(1);
    expect(getUserVoice(db, GUILD, USER)).toBeNull();
  });

  it('boundaries 0.5 e 2.0 continuam validos (gravam a voz)', async () => {
    const lo = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium', speed: 0.5 });
    await handleInteraction(lo as any, makeDeps(db));
    expect(getUserVoice(db, GUILD, USER)?.speed).toBe(0.5);

    const hi = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium', speed: 2.0 });
    await handleInteraction(hi as any, makeDeps(db));
    expect(getUserVoice(db, GUILD, USER)?.speed).toBe(2.0);
  });

  it('sem speed (omitido) grava com o defaultSpeed — caminho valido inalterado', async () => {
    const i = makeVoiceInteraction({ sub: 'set', model: 'en_US-amy-medium', speed: null });
    await handleInteraction(i as any, makeDeps(db));

    expect(getUserVoice(db, GUILD, USER)?.speed).toBe(1.0);
  });
});

describe('/voice reset — copy beginner-friendly', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('confirma o reset e aponta para /voice set / /voice list para escolher outra', async () => {
    const i = makeVoiceInteraction({ sub: 'reset' });
    await handleInteraction(i as any, makeDeps(db));

    expect(i.replies).toHaveLength(1);
    const out = i.replies[0];
    expect(out).toContain('/voice set');
    expect(out).toContain('/voice list');
  });
});
