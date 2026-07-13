// tests/transcribeHandler.test.ts
//
// Caracteriza o CICLO DE VIDA da sessão /transcribe (plano 019): fecha a corrida do
// arranque (dois `start` quase simultâneos), a inversão do selfMute (silenciava o TTS
// da guild toda), e o teardown EXTERNO (stopTranscriptionForGuild) chamado pelo funil
// removePlayer quando o bot sai da call — sem ele, o sidecar Whisper, o listener de
// speaking e o intervalo de auto-stop ficavam órfãos (guild presa até reiniciar).
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

const h = vi.hoisted(() => ({
  getVoiceConnection: vi.fn(),
  resolveWhisperCmd: vi.fn(),
  transcriberInstances: [] as Array<{
    prewarm: ReturnType<typeof vi.fn>;
    transcribe: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));

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
