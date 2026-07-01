// tests/playerIdle.test.ts
// Cobertura do TEMPORIZADOR DE INATIVIDADE (armIdleTimer -> onIdle) do
// GuildVoicePlayer — a promessa "o bot sai sozinho do canal quando fica parado".
//
// Porque um ficheiro separado: os outros testes de player nao exercem o CAMINHO
// NORMAL de inatividade. As unicas assercoes de onIdle vivem no playerReconnect
// (so o ramo "reconexao desistiu"). Aqui cobrimos o caminho puro:
//   1. fila vazia + avancar o tempo -> onIdle exatamente 1x (guard
//      !playing && queue.size()===0 verdadeiro; setTimeout, nao re-arma).
//   2. ocupado (a sintetizar) -> onIdle NAO e chamado (playNext ja limpou o
//      idle timer e esta parado no await da sintese).
//   3. destroy() antes -> o timer e limpo, avancar o tempo nunca dispara onIdle.
//
// Usamos fake timers (vi.useFakeTimers) porque o idle timer e um setTimeout de
// inactivityMs; avancamos o relogio em vez de esperar tempo real.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// Mesmo mock de @discordjs/voice dos outros testes de player. Nenhum dos 3 casos
// chega a play() (o caso 2 fica pendurado na sintese; 1 e 3 nunca enfileiram),
// por isso os detalhes de entersState / emissao de Idle sao irrelevantes aqui.
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

const IDLE_MS = 1_000;

describe('GuildVoicePlayer — idle timer (saida por inatividade)', () => {
  // Restaura timers reais: os fake timers deste ficheiro nao devem contaminar
  // outros ficheiros/testes que usem timers reais.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fila vazia -> avancar o tempo dispara onIdle exatamente 1x', () => {
    // useFakeTimers ANTES de construir: o construtor arma o idle timer, que tem de
    // ser falso para o podermos avancar.
    vi.useFakeTimers();
    const engine: TTSEngine = { synth: async (req: SynthRequest) => req.text };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = makeConnection() as any;
    const onIdle = vi.fn();

    // Nada enfileirado: playing=false e queue.size()===0, o guard e verdadeiro.
    const player = new GuildVoicePlayer(conn, engine, 20, IDLE_MS, onIdle);

    // Antes do tempo passar, ainda nada.
    expect(onIdle).not.toHaveBeenCalled();

    // Avancar o DOBRO do inactivityMs: prova que dispara UMA vez e nao volta a
    // disparar (armIdleTimer usa setTimeout, nao setInterval, e nao re-arma).
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(onIdle).toHaveBeenCalledTimes(1);

    player.destroy();
  });

  it('ocupado (a sintetizar) -> onIdle NAO e chamado', async () => {
    vi.useFakeTimers();
    // Engine cuja sintese NUNCA resolve: mantem o player genuinamente ocupado.
    // playNext corre sincronamente ate clearIdleTimer()+playing=true e depois
    // suspende no await synth. Assim, quando o say() resolve, o idle timer ja foi
    // limpo e playing=true. (Uma sintese que RESOLVESSE re-armaria o timer ao
    // drenar a fila vazia via Idle e falsificaria este teste.)
    const engine: TTSEngine = { synth: () => new Promise<string>(() => {}) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = makeConnection() as any;
    const onIdle = vi.fn();

    const player = new GuildVoicePlayer(conn, engine, 20, IDLE_MS, onIdle);

    // say() enfileira e arranca playNext (fire-and-forget). Resolve apos o enqueue
    // sincrono; nesse ponto playNext ja limpou o idle timer e marcou playing=true.
    await player.say({ text: 'ola', model: 'm', speed: 1 });

    // Avancar bem para la do inactivityMs: como o timer foi limpo, nada dispara.
    vi.advanceTimersByTime(IDLE_MS * 3);
    expect(onIdle).not.toHaveBeenCalled();

    player.destroy();
  });

  it('destroy() antes -> avancar o tempo nunca dispara onIdle', () => {
    vi.useFakeTimers();
    const engine: TTSEngine = { synth: async (req: SynthRequest) => req.text };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = makeConnection() as any;
    const onIdle = vi.fn();

    const player = new GuildVoicePlayer(conn, engine, 20, IDLE_MS, onIdle);

    // destroy() limpa o idle timer (clearIdleTimer) antes de o tempo passar.
    player.destroy();

    // Avancar o tempo: o timer ja nao existe -> onIdle nunca e chamado.
    vi.advanceTimersByTime(IDLE_MS * 3);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
