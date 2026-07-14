// tests/transcribeHandler.test.ts
//
// Caracteriza o CICLO DE VIDA da sessão /transcribe (plano 019): fecha a corrida do
// arranque (dois `start` quase simultâneos), a inversão do selfMute (silenciava o TTS
// da guild toda), e o teardown EXTERNO (stopTranscriptionForGuild) chamado pelo funil
// removePlayer quando o bot sai da call — sem ele, o sidecar Whisper, o listener de
// speaking e o intervalo de auto-stop ficavam órfãos (guild presa até reiniciar).
//
// Plano 029 (ABUSE-01/DISCORD-02) acrescenta: o cap GLOBAL de sessões STT concorrentes
// (`globalSttSemaphore`, mockado aqui por uma versão FAKE mas com a mesma forma —
// `available`/`tryAcquire` — controlável via `h.sttSemaphore.reset(cap)`) e o teardown de
// erro quando o `channel.send` do anúncio falha DEPOIS de des-ensurdecer.
//
// Mocka @discordjs/voice (getVoiceConnection controlável + EndBehaviorType, usado só
// como valor em transcriptionSession.ts/recorder.ts), o sidecar Whisper (resolveWhisperCmd
// sempre disponível) e o WhisperTranscriber (spies prewarm/transcribe/dispose) — a
// CAPTURA real de áudio nunca corre nestes testes (não simulamos fala), só o
// arranque/paragem da sessão.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { grantGuildPremium } from '../src/store/premium';
import { t, DEFAULT_LOCALE } from '../src/i18n/index';
import type { BotDeps } from '../src/bot/deps';

const h = vi.hoisted(() => {
  // Fake do Semaphore GLOBAL de STT: mesma forma que src/tts/semaphore.ts (available,
  // tryAcquire síncrono devolvendo um release IDEMPOTENTE), mas com `reset(cap)` para os
  // testes controlarem a capacidade sem depender de estado deixado por testes anteriores.
  const sttSemaphore = {
    permits: 5,
    get available(): number {
      return this.permits;
    },
    tryAcquire(): (() => void) | null {
      if (this.permits <= 0) return null;
      this.permits--;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.permits++;
      };
    },
    reset(cap: number) {
      this.permits = cap;
    },
  };
  return {
    getVoiceConnection: vi.fn(),
    resolveWhisperCmd: vi.fn(),
    transcriberInstances: [] as Array<{
      prewarm: ReturnType<typeof vi.fn>;
      transcribe: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }>,
    sttSemaphore,
  };
});

// Só o que transcribe.ts/transcriptionSession.ts/recorder.ts tocam em runtime.
vi.mock('@discordjs/voice', () => ({
  getVoiceConnection: (...args: unknown[]) => h.getVoiceConnection(...args),
  EndBehaviorType: { AfterSilence: 'afterSilence' },
}));

vi.mock('../src/voice/whisperSidecar', () => ({
  resolveWhisperCmd: (...args: unknown[]) => h.resolveWhisperCmd(...args),
  DEFAULT_WHISPER_MODEL: 'base',
}));

vi.mock('../src/voice/whisperTranscriber', () => ({
  WhisperTranscriber: class {
    prewarm = vi.fn();
    transcribe = vi.fn(async () => ({ text: '', lang: 'en' }));
    dispose = vi.fn();
    constructor() {
      h.transcriberInstances.push(this as unknown as (typeof h.transcriberInstances)[number]);
    }
  },
  MAX_CONCURRENT_STT: 1,
  globalSttSemaphore: h.sttSemaphore,
}));

import { handleTranscribe, stopTranscriptionForGuild } from '../src/commands/handlers/transcribe';

// ── fakes ──────────────────────────────────────────────────────────────────────────

function makeVoiceChannel(memberIds: string[]) {
  const members = new Map(memberIds.map((id) => [id, { id, user: { bot: false } }]));
  return { isVoiceBased: () => true, members };
}

function makeConnection() {
  return {
    joinConfig: { channelId: 'VC' },
    rejoin: vi.fn(),
    receiver: { speaking: { on: vi.fn(), off: vi.fn() } },
  };
}

function makeAnnounceMsg(channel: unknown) {
  return {
    edit: vi.fn(async () => {}),
    channel,
    createMessageComponentCollector: () => ({ on: vi.fn(), stop: vi.fn() }),
  };
}

function makeChannel() {
  const channel: {
    isTextBased: () => boolean;
    isDMBased: () => boolean;
    send: ReturnType<typeof vi.fn>;
  } = {
    isTextBased: () => true,
    isDMBased: () => false,
    send: vi.fn(async () => makeAnnounceMsg(channel)),
  };
  return channel;
}

/** Canal cujo `send` (o anúncio de arranque) FALHA sempre — simula SendMessages perdido,
 * rate-limit ou falha de rede (plano 029, parte B/DISCORD-02). */
function makeFailingChannel(error: Error = new Error('SendMessages perdido')) {
  const channel: {
    isTextBased: () => boolean;
    isDMBased: () => boolean;
    send: ReturnType<typeof vi.fn>;
  } = {
    isTextBased: () => true,
    isDMBased: () => false,
    send: vi.fn(async () => {
      throw error;
    }),
  };
  return channel;
}

function makeInteraction(opts: {
  guildId: string;
  sub: 'start' | 'stop' | 'revoke';
  channel: ReturnType<typeof makeChannel>;
  voiceMembers?: string[];
}) {
  const replies: string[] = [];
  const voiceChannel = makeVoiceChannel(opts.voiceMembers ?? ['human1']);
  return {
    guildId: opts.guildId,
    user: { id: 'U1' },
    memberPermissions: { has: () => true },
    options: {
      getSubcommand: () => opts.sub,
      getString: () => null,
    },
    reply: vi.fn(async (o: { content: string }) => {
      replies.push(o.content);
    }),
    deferReply: vi.fn(async () => {}),
    editReply: vi.fn(async (o: string | { content: string }) => {
      replies.push(typeof o === 'string' ? o : o.content);
      return {};
    }),
    replies,
    channel: opts.channel,
    guild: {
      channels: { cache: { get: (id: string) => (id === 'VC' ? voiceChannel : undefined) } },
      members: { cache: { get: () => undefined } },
    },
  };
}

let db: Database.Database;

beforeEach(() => {
  h.getVoiceConnection.mockReset();
  h.resolveWhisperCmd.mockReset();
  h.resolveWhisperCmd.mockReturnValue({ exe: 'py', args: ['whisper_sidecar.py'] });
  h.transcriberInstances.length = 0;
  // Reset GENEROSO por omissão: a maioria dos testes não testa o cap em si e nem sempre
  // liberta a sessão que arrancou — sem isto, permits ficariam presos entre testes.
  // Os testes do cap (abaixo) chamam h.sttSemaphore.reset(1) explicitamente.
  h.sttSemaphore.reset(5);
  db = initDb(':memory:');
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
});

function makeDeps(guildId: string): BotDeps {
  grantGuildPremium(db, guildId, 30, 'manual', Date.now());
  return { db } as unknown as BotDeps;
}

// ── testes ─────────────────────────────────────────────────────────────────────────

describe('/transcribe — ciclo de vida da sessão (plano 019)', () => {
  it('start: des-ensurdece e NÃO fica self-muted (bug: silenciava o TTS da guild toda)', async () => {
    const guildId = 'g-selfmute';
    const conn = makeConnection();
    h.getVoiceConnection.mockReturnValue(conn);
    const channel = makeChannel();
    const i = makeInteraction({ guildId, sub: 'start', channel });
    const deps = makeDeps(guildId);

    await handleTranscribe(i as any, deps);

    expect(conn.rejoin).toHaveBeenCalledWith({
      channelId: 'VC',
      selfDeaf: false,
      selfMute: false,
    });
    expect(i.replies).toContain(t('stt.started', DEFAULT_LOCALE));
  });

  it('stop: reensurdece, remove o listener de speaking e faz dispose() do transcriber (invariante de privacidade)', async () => {
    const guildId = 'g-stop';
    const conn = makeConnection();
    h.getVoiceConnection.mockReturnValue(conn);
    const channel = makeChannel();
    const deps = makeDeps(guildId);

    await handleTranscribe(makeInteraction({ guildId, sub: 'start', channel }) as any, deps);
    const transcriber = h.transcriberInstances.at(-1)!;

    await handleTranscribe(makeInteraction({ guildId, sub: 'stop', channel }) as any, deps);

    expect(conn.rejoin).toHaveBeenLastCalledWith({
      channelId: 'VC',
      selfDeaf: true,
      selfMute: false,
    });
    expect(conn.receiver.speaking.off).toHaveBeenCalledWith('start', expect.any(Function));
    expect(transcriber.dispose).toHaveBeenCalledOnce();
  });

  it('stopTranscriptionForGuild (funil removePlayer): mesma limpeza, NÃO faz rejoin (ligação já morreu) e liberta a guild', async () => {
    const guildId = 'g-external-teardown';
    const conn = makeConnection();
    h.getVoiceConnection.mockReturnValue(conn);
    const channel = makeChannel();
    const deps = makeDeps(guildId);

    await handleTranscribe(makeInteraction({ guildId, sub: 'start', channel }) as any, deps);
    const transcriber = h.transcriberInstances.at(-1)!;
    conn.rejoin.mockClear();

    stopTranscriptionForGuild(guildId);

    // voice-left: a ligação já não existe — não deve tentar reensurdecer nela.
    expect(conn.rejoin).not.toHaveBeenCalled();
    expect(conn.receiver.speaking.off).toHaveBeenCalledWith('start', expect.any(Function));
    expect(transcriber.dispose).toHaveBeenCalledOnce();

    // a guild ficou livre: um novo start NÃO vê "already running".
    const i2 = makeInteraction({ guildId, sub: 'start', channel });
    await handleTranscribe(i2 as any, deps);
    expect(i2.replies).not.toContain(t('stt.alreadyRunning', DEFAULT_LOCALE));
    expect(i2.replies).toContain(t('stt.started', DEFAULT_LOCALE));
  });

  it('duas chamadas start em paralelo para a mesma guild só registam UM listener speaking.on (corrida do arranque)', async () => {
    const guildId = 'g-race';
    const conn = makeConnection();
    h.getVoiceConnection.mockReturnValue(conn);
    const deps = makeDeps(guildId);
    const i1 = makeInteraction({ guildId, sub: 'start', channel: makeChannel() });
    const i2 = makeInteraction({ guildId, sub: 'start', channel: makeChannel() });

    await Promise.all([handleTranscribe(i1 as any, deps), handleTranscribe(i2 as any, deps)]);

    const starts = (conn.receiver.speaking.on as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'start',
    );
    expect(starts).toHaveLength(1);
  });

  it('auto-stop: call sem humanos ao fim de 15s aciona a limpeza (mesmo sem ninguém carregar em stop)', async () => {
    vi.useFakeTimers();
    const guildId = 'g-autostop';
    const conn = makeConnection();
    h.getVoiceConnection.mockReturnValue(conn);
    const channel = makeChannel();
    const deps = makeDeps(guildId);

    await handleTranscribe(
      makeInteraction({ guildId, sub: 'start', channel, voiceMembers: [] }) as any,
      deps,
    );
    expect(conn.receiver.speaking.off).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);

    expect(conn.receiver.speaking.off).toHaveBeenCalledWith('start', expect.any(Function));
  });
});

describe('/transcribe start — cap global de concorrência STT (plano 029, ABUSE-01)', () => {
  it('cap atingido -> atCapacity para uma guild NOVA; a guild original não é afetada', async () => {
    h.sttSemaphore.reset(1); // só 1 sessão STT concorrente permitida no processo inteiro
    const connA = makeConnection();
    const connB = makeConnection();
    const deps = makeDeps('g-cap-a');
    grantGuildPremium(db, 'g-cap-b', 30, 'manual', Date.now());

    h.getVoiceConnection.mockReturnValueOnce(connA);
    const iA = makeInteraction({ guildId: 'g-cap-a', sub: 'start', channel: makeChannel() });
    await handleTranscribe(iA as any, deps);
    expect(iA.replies).toContain(t('stt.started', DEFAULT_LOCALE));

    // 2.ª guild, com o permit global esgotado pela 1.ª: tem de ser recusada, mesmo com
    // Premium+Manage-Guild+sidecar+voz todos verdes.
    h.getVoiceConnection.mockReturnValueOnce(connB);
    const iB = makeInteraction({ guildId: 'g-cap-b', sub: 'start', channel: makeChannel() });
    await handleTranscribe(iB as any, deps);

    expect(iB.replies).toContain(t('stt.atCapacity', DEFAULT_LOCALE));
    expect(connB.rejoin).not.toHaveBeenCalled(); // nunca chegou a des-ensurdecer
    expect(connB.receiver.speaking.on).not.toHaveBeenCalled();
  });

  it('parar a sessão liberta o permit -> a próxima guild já consegue arrancar', async () => {
    h.sttSemaphore.reset(1);
    const connA = makeConnection();
    const connB = makeConnection();
    const deps = makeDeps('g-cap-c');
    grantGuildPremium(db, 'g-cap-d', 30, 'manual', Date.now());

    h.getVoiceConnection.mockReturnValueOnce(connA);
    await handleTranscribe(
      makeInteraction({ guildId: 'g-cap-c', sub: 'start', channel: makeChannel() }) as any,
      deps,
    );

    // pára a 1.ª sessão -> liberta o permit global (stop() não chama getVoiceConnection —
    // usa a ligação guardada na sessão ativa).
    await handleTranscribe(
      makeInteraction({ guildId: 'g-cap-c', sub: 'stop', channel: makeChannel() }) as any,
      deps,
    );

    h.getVoiceConnection.mockReturnValueOnce(connB);
    const iD = makeInteraction({ guildId: 'g-cap-d', sub: 'start', channel: makeChannel() });
    await handleTranscribe(iD as any, deps);

    expect(iD.replies).not.toContain(t('stt.atCapacity', DEFAULT_LOCALE));
    expect(iD.replies).toContain(t('stt.started', DEFAULT_LOCALE));
  });
});

describe('/transcribe start — teardown de erro no anúncio (plano 029, DISCORD-02)', () => {
  it('channel.send do anúncio falha DEPOIS de des-ensurdecer -> reensurdece, remove listener, dispose e liberta o permit', async () => {
    h.sttSemaphore.reset(1);
    const guildId = 'g-announce-fail';
    const conn = makeConnection();
    h.getVoiceConnection.mockReturnValue(conn);
    const channel = makeFailingChannel();
    const i = makeInteraction({ guildId, sub: 'start', channel });
    const deps = makeDeps(guildId);

    await handleTranscribe(i as any, deps);

    // invariante do plano 029: se des-ensurdeceu, TEM de voltar a ensurdecer.
    expect(conn.rejoin).toHaveBeenCalledWith({
      channelId: 'VC',
      selfDeaf: false,
      selfMute: false,
    });
    expect(conn.rejoin).toHaveBeenLastCalledWith({
      channelId: 'VC',
      selfDeaf: true,
      selfMute: false,
    });
    // o listener de speaking foi removido (não fica preso a ouvir sem sessão registada).
    expect(conn.receiver.speaking.off).toHaveBeenCalledWith('start', expect.any(Function));
    // o transcriber (já arrancado/prewarm) foi descartado.
    const transcriber = h.transcriberInstances.at(-1)!;
    expect(transcriber.dispose).toHaveBeenCalledOnce();
    // a resposta ao utilizador reflete a falha, não "started".
    expect(i.replies).toContain(t('stt.startFailed', DEFAULT_LOCALE));
    expect(i.replies).not.toContain(t('stt.started', DEFAULT_LOCALE));

    // o permit global foi libertado: uma NOVA tentativa (mesma guild, canal que já não
    // falha) consegue arrancar em vez de ficar presa em atCapacity.
    const okChannel = makeChannel();
    const retry = makeInteraction({ guildId, sub: 'start', channel: okChannel });
    await handleTranscribe(retry as any, deps);
    expect(retry.replies).toContain(t('stt.started', DEFAULT_LOCALE));
  });

  it('sem sessão registada em activeSessions: stopTranscriptionForGuild fica no-op (não há dupla-libertação do permit)', async () => {
    h.sttSemaphore.reset(1);
    const guildId = 'g-announce-fail-2';
    const conn = makeConnection();
    h.getVoiceConnection.mockReturnValue(conn);
    const channel = makeFailingChannel();
    const deps = makeDeps(guildId);

    await handleTranscribe(makeInteraction({ guildId, sub: 'start', channel }) as any, deps);

    // a sessão nunca chegou a activeSessions -> stopTranscriptionForGuild é no-op (idempotente,
    // não deve rebentar nem sobre-libertar o permit).
    expect(() => stopTranscriptionForGuild(guildId)).not.toThrow();
    expect(h.sttSemaphore.available).toBe(1); // continua libertado, não foi a negativo
  });
});
