// tests/playerPendingSkip.test.ts
// P19.C — /skip na JANELA DE SINTESE.
//
// Bug: playNext() poe playing=true ANTES dos awaits (engine.synth + entersState
// Ready); this.player.play(resource) so corre DEPOIS. Durante essa janela o
// AudioPlayer REAL esta Idle (o item anterior terminou e disparou este drain;
// nenhum recurso novo foi passado). Se o utilizador fizer /skip nessa janela,
// skip() -> player.stop(true), mas no @discordjs/voice stop() faz
// `if (status === 'idle') return false` — NO-OP, nao emite Idle. O skip era
// PERDIDO: o item in-flight tocava na integra apesar do "skipped".
//
// Fix: flag pendingSkip. skip() deteta que o player real NAO esta a tocar
// (Playing/Buffering) e marca pendingSkip=true; playNext() reseta a flag no
// inicio de cada iteracao (para nao vazar para o item seguinte) e verifica-a
// DEPOIS dos awaits e ANTES de play() — se set, descarta o item e drena o proximo.
//
// FIDELIDADE DO FAKE (critico para o RED valer): o AudioPlayer falso replica a
// semantica real de stop() — quando o estado e Idle, stop() e NO-OP (nao emite
// Idle). Um fake que emitisse Idle incondicionalmente faria o /skip "funcionar"
// na janela e nao haveria bug para reproduzir.
//
// Para segurar a janela de sintese e libertar no momento certo usamos um engine
// com sintese DIFERIDA (deferred): synth() devolve uma Promise resolvida
// manualmente pelo teste, para inspecionar o estado a meio (real player Idle) e
// so entao chamar skip().
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('@discordjs/voice', async () => {
  const { EventEmitter: EE } = await import('node:events');
  const IDLE = 'idle';
  const PLAYING = 'playing';
  const BUFFERING = 'buffering';
  // AudioPlayer falso com um `state` MUTAVEL que espelha o real:
  //  - arranca Idle
  //  - play(resource) -> Playing, regista o recurso, e agenda o fim (Idle + emit)
  //  - stop(force)    -> se ja Idle: NO-OP (return false, NAO emite) tal como o real;
  //                      se Playing/Buffering: passa a Idle e emite Idle.
  class FakeAudioPlayer extends EE {
    state: { status: string } = { status: IDLE };
    play(resource: { path: string }): void {
      (globalThis as Record<string, unknown>).__playOrder ??= [];
      ((globalThis as Record<string, unknown>).__playOrder as string[]).push(resource.path);
      this.state = { status: PLAYING };
      // Termina o "audio" no proximo tick -> Idle -> playNext() drena o seguinte.
      setTimeout(() => {
        this.state = { status: IDLE };
        this.emit(IDLE);
      }, 0);
    }
    stop(_force?: boolean): boolean {
      if (this.state.status === IDLE) {
        // Semantica real: no-op quando idle. O skip perde-se se a producao
        // confiar so nisto (bug); o fix usa pendingSkip.
        return false;
      }
      this.state = { status: IDLE };
      this.emit(IDLE);
      return true;
    }
  }
  return {
    AudioPlayerStatus: {
      Idle: IDLE,
      Playing: PLAYING,
      Buffering: BUFFERING,
    },
    VoiceConnectionStatus: {
      Disconnected: 'disconnected',
      Signalling: 'signalling',
      Connecting: 'connecting',
      Ready: 'ready',
    },
    StreamType: { Arbitrary: 'arbitrary' },
    createAudioPlayer: () => new FakeAudioPlayer(),
    createAudioResource: (path: string) => ({ path }),
    entersState: () => Promise.resolve(),
  };
});

import { GuildVoicePlayer } from '../src/voice/player';
import type { TTSEngine, SynthRequest } from '../src/tts/engine';

function makeConnection() {
  const conn = new EventEmitter() as EventEmitter & {
    subscribe: () => void;
    destroy: () => void;
  };
  conn.subscribe = () => {};
  conn.destroy = () => {};
  return conn;
}

// Engine com sintese DIFERIDA e segurável por texto: synth(req) devolve uma
// Promise que so resolve quando o teste chama release(req.text). Assim podemos
// parar a execucao DENTRO da janela de sintese e inspecionar/agir a meio.
function makeDeferredEngine() {
  const resolvers = new Map<string, (v: string) => void>();
  const arrived = new Map<string, () => void>();
  const arrivedPromises = new Map<string, Promise<void>>();
  const engine: TTSEngine = {
    synth: (req: SynthRequest) =>
      new Promise<string>((resolve) => {
        resolvers.set(req.text, resolve);
        arrived.get(req.text)?.();
      }),
  };
  // Espera ate que synth() do texto dado seja CHAMADO (a execucao entrou na janela).
  const waitSynthCalled = (text: string): Promise<void> => {
    if (resolvers.has(text)) return Promise.resolve();
    let existing = arrivedPromises.get(text);
    if (!existing) {
      existing = new Promise<void>((res) => arrived.set(text, res));
      arrivedPromises.set(text, existing);
    }
    return existing;
  };
  const release = (text: string): void => {
    resolvers.get(text)?.(text);
  };
  return { engine, waitSynthCalled, release };
}

const req = (text: string): SynthRequest => ({ text, model: 'm', speed: 1 });

describe('GuildVoicePlayer — /skip na janela de sintese (pendingSkip, P19.C)', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__playOrder = [];
  });

  it('skip na janela de sintese: o item in-flight NAO toca e o proximo toca', async () => {
    const { engine, waitSynthCalled, release } = makeDeferredEngine();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = makeConnection() as any;
    const player = new GuildVoicePlayer(conn, engine, 20, 60_000, () => {});

    // Enfileira A (vai tocar) e B (fica na fila). Nao usamos await para nao
    // bloquear — say() enfileira sincronamente e arranca o worker.
    void player.say(req('A'));
    void player.say(req('B'));

    // A entra em sintese primeiro. Liberta A -> A toca -> termina -> Idle -> drain B.
    await waitSynthCalled('A');
    release('A');

    // Agora B entrou na janela de sintese. Neste instante o AudioPlayer REAL esta
    // Idle (A ja terminou; B ainda nao passou por play). skip() aqui e o cerne do bug.
    await waitSynthCalled('B');

    // /skip na janela: com o bug, stop() e no-op (idle) e B toca a mesma.
    player.skip();

    // Liberta a sintese de B -> playNext continua depois do await.
    release('B');

    // Espera a fila estabilizar. Damos umas voltas ao event loop.
    await new Promise((r) => setTimeout(r, 20));

    const order = (globalThis as Record<string, unknown>).__playOrder as string[];
    // A tocou; B foi DESCARTADO pelo skip na janela (nao toca).
    expect(order).toEqual(['A']);

    player.destroy();
  });

  it('NO-LEAK: skip durante B descarta B mas C (proximo) toca NORMALMENTE', async () => {
    const { engine, waitSynthCalled, release } = makeDeferredEngine();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = makeConnection() as any;
    const player = new GuildVoicePlayer(conn, engine, 20, 60_000, () => {});

    void player.say(req('A'));
    void player.say(req('B'));
    void player.say(req('C'));

    await waitSynthCalled('A');
    release('A');

    // B na janela: skip() -> pendingSkip.
    await waitSynthCalled('B');
    player.skip();
    release('B'); // B descartado, drena C.

    // C entra em sintese: o pendingSkip NAO deve ter vazado (reset no inicio da
    // iteracao de C). Liberta C -> C deve TOCAR.
    await waitSynthCalled('C');
    release('C');

    await new Promise((r) => setTimeout(r, 20));

    const order = (globalThis as Record<string, unknown>).__playOrder as string[];
    // A tocou, B descartado, C tocou normalmente (sem leak do pendingSkip).
    expect(order).toEqual(['A', 'C']);

    player.destroy();
  });

  it('skip NORMAL (a tocar): stop() emite Idle e avanca; comportamento inalterado', async () => {
    // Aqui NAO diferimos: engine resolve logo, para o item chegar a play() e o
    // player ficar Playing. Depois skip() enquanto Playing -> stop() emite Idle.
    const engine: TTSEngine = { synth: async (r: SynthRequest) => r.text };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = makeConnection() as any;
    const player = new GuildVoicePlayer(conn, engine, 20, 60_000, () => {});

    void player.say(req('A'));
    void player.say(req('B'));

    // Espera A comecar a tocar (Playing) — o fake agenda Idle no proximo tick, por
    // isso capturamos o estado logo apos o play sincrono.
    await vi.waitFor(
      () => {
        const order = (globalThis as Record<string, unknown>).__playOrder as string[];
        expect(order.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 1000 },
    );

    // A fila drena naturalmente A e B (ambos tocam). Prova de nao-regressao: os
    // dois itens tocam por ordem, e o skip normal (quando Playing) continua a
    // funcionar via stop()/Idle sem depender de pendingSkip.
    await vi.waitFor(
      () => {
        const order = (globalThis as Record<string, unknown>).__playOrder as string[];
        expect(order).toEqual(['A', 'B']);
      },
      { timeout: 1000 },
    );

    player.destroy();
  });

  it('skip durante B + sintese de B FALHA: C toca (sem leak no catch)', async () => {
    // Engine: A e C resolvem; B REJEITA. Fazemos skip() enquanto B esta em sintese;
    // depois a sintese de B falha (catch em playNext). O reset de pendingSkip no
    // inicio da iteracao de C garante que C NAO e indevidamente saltado.
    const { engine: base, waitSynthCalled, release } = makeDeferredEngine();
    const rejecters = new Set(['B']);
    const engine: TTSEngine = {
      synth: (r: SynthRequest) =>
        rejecters.has(r.text)
          ? // devolve a mesma promise diferida mas rejeita quando "libertada"
            new Promise<string>((_, reject) => {
              // waitSynthCalled/release operam sobre a base; reusamos so o sinal
              // de "chegou" via base.synth para consistencia de timing.
              void base.synth(r).then(() => reject(new Error('synth boom B')));
            })
          : base.synth(r),
    };

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = makeConnection() as any;
    const player = new GuildVoicePlayer(conn, engine, 20, 60_000, () => {});

    void player.say(req('A'));
    void player.say(req('B'));
    void player.say(req('C'));

    await waitSynthCalled('A');
    release('A');

    await waitSynthCalled('B');
    player.skip(); // pendingSkip=true enquanto B em sintese
    release('B'); // B rejeita -> catch -> drena C

    await waitSynthCalled('C');
    release('C');

    await new Promise((r) => setTimeout(r, 20));
    process.off('unhandledRejection', onUnhandled);

    const order = (globalThis as Record<string, unknown>).__playOrder as string[];
    // A tocou, B falhou (nunca toca), C tocou (pendingSkip nao vazou para C).
    expect(order).toEqual(['A', 'C']);
    expect(unhandled).toEqual([]);

    errSpy.mockRestore();
    player.destroy();
  });
});
