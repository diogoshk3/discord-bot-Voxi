// tests/playerReconnect.test.ts
// Cobertura do caminho de REJOIN MANUAL (ciclo de backoff) das metricas de voz.
//
// Porque um ficheiro separado: o mock partilhado dos outros testes faz
// entersState() resolver sempre, pelo que a recuperacao "soft" no
// handleDisconnect tem sempre sucesso e nunca se chega ao loop tryRejoin().
// Aqui forcamos o oposto: a recuperacao "soft" REJEITA (-> entra no catch) e o
// rejoin manual so volta a Ready a partir da 2a tentativa. Isso obriga o loop de
// backoff a correr MAIS do que uma vez, provando que voiceReconnects conta UMA
// vez (no resultado do loop) e nao por tentativa — a garantia que o item P7.4
// pede ("um ciclo de backoff nao conta a dobrar").
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// Controlo partilhado com a factory do mock (vi.hoisted corre antes do vi.mock).
const ctrl = vi.hoisted(() => ({ readyCalls: 0 }));

vi.mock('@discordjs/voice', async () => {
  const { EventEmitter: EE } = await import('node:events');
  const IDLE = 'idle';
  class FakeAudioPlayer extends EE {
    play(): void {
      setTimeout(() => this.emit(IDLE), 0);
    }
    stop(): void {
      this.emit(IDLE);
    }
  }
  return {
    AudioPlayerStatus: { Idle: IDLE },
    VoiceConnectionStatus: {
      Disconnected: 'disconnected',
      Signalling: 'signalling',
      Connecting: 'connecting',
      Ready: 'ready',
    },
    StreamType: { Arbitrary: 'arbitrary' },
    createAudioPlayer: () => new FakeAudioPlayer(),
    createAudioResource: (path: string) => ({ path }),
    // - Signalling/Connecting (recuperacao soft): rejeita sempre -> forca o catch.
    // - Ready: rejeita na 1a chamada do rejoin e resolve na 2a -> o loop tryRejoin
    //   corre 2 tentativas (uma espera de backoff pelo meio) antes de recuperar.
    entersState: (_conn: unknown, status: string) =>
      status === 'ready'
        ? ++ctrl.readyCalls >= 2
          ? Promise.resolve()
          : Promise.reject(new Error('not ready yet'))
        : Promise.reject(new Error('soft recovery falhou')),
  };
});

import { metrics } from '../src/metrics';
import { GuildVoicePlayer } from '../src/voice/player';
import type { TTSEngine, SynthRequest } from '../src/tts/engine';

function makeConnection() {
  const conn = new EventEmitter() as EventEmitter & {
    subscribe: () => void;
    destroy: () => void;
    rejoin: () => void;
  };
  conn.subscribe = () => {};
  conn.destroy = () => {};
  conn.rejoin = () => {};
  return conn;
}

describe('GuildVoicePlayer — rejoin manual (ciclo de backoff) e metricas', () => {
  beforeEach(() => {
    ctrl.readyCalls = 0;
    metrics.reset();
  });

  it('recupera via rejoin apos varias tentativas e conta voiceReconnects UMA so vez', async () => {
    const engine: TTSEngine = { synth: async (req: SynthRequest) => req.text };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = makeConnection() as any;
    const player = new GuildVoicePlayer(conn, engine, 20, 60_000, () => {});

    // Uma queda: soft falha -> catch -> tryRejoin corre 2 tentativas (1a falha,
    // 2a recupera). A 1a falha agenda um backoff real (~1s), por isso o waitFor
    // tem timeout folgado.
    conn.emit('disconnected');

    await vi.waitFor(
      () => expect(metrics.snapshot().voiceReconnects).toBe(1),
      { timeout: 3000 },
    );

    // Drop conta 1 vez; reconnect conta 1 vez apesar das multiplas tentativas de
    // rejoin no loop de backoff (o sucesso e contado no RESULTADO do loop).
    expect(metrics.snapshot().voiceDrops).toBe(1);
    expect(metrics.snapshot().voiceReconnects).toBe(1);
    // Confirma que o loop correu mesmo mais do que uma tentativa (>= 2 chamadas a
    // entersState(Ready)) — senao isto nao testava o ciclo de backoff.
    expect(ctrl.readyCalls).toBeGreaterThanOrEqual(2);

    player.destroy();
  });
});
