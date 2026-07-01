// tests/playerErrorIdle.test.ts
// Regressao P19.A: no @discordjs/voice REAL, um erro na stream do recurso a tocar
// dispara onStreamError, que emite 'error' E DEPOIS transiciona o estado para idle
// (o setter emite Idle) — SINCRONO, para o MESMO recurso (ver dist/index.js
// onStreamError, ~linhas 481-490). O construtor do GuildVoicePlayer registava
// playNext() nos DOIS handlers ('error' e Idle), portanto 1 erro de recurso corria
// DOIS playNext() back-to-back: o 1o (do 'error') dequeue-ava B e comecava a
// sintese; o 2o (do Idle) via a fila vazia -> punha playing=false e armava o
// idle-timer a meio da sintese de B. Isto colapsa a flag `playing` (quebra o
// single-worker/FIFO) e pode disparar onIdle() (sair do canal) a meio da fala.
//
// Os fakes dos outros testes auto-emitem Idle no play() (setTimeout(emit(IDLE),0)),
// o que NUNCA exercita o caminho 'error'. Aqui usamos um fake que NAO auto-emite
// Idle e expoe simulateStreamError() para disparar 'error'+'idle' sincronos, mais
// uma sintese DIFERIDA para B (segurada pendente) para observar o estado do player
// EXATAMENTE a meio da sintese de B.
//
// NOTA (porque __playOrder nao serve de prova): com A a tocar e B na fila, tanto o
// codigo com bug como o corrigido tocam B UMA vez (o 1o playNext dequeue B; o 2o ve
// a fila vazia). O double-fire corrompe ESTADO, nao a ordem de reproducao. Por isso
// a prova RED->GREEN e (a) isActive() a meio da sintese de B e (b) onIdle NAO
// chamado a meio da sintese de B.
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('@discordjs/voice', async () => {
  const { EventEmitter: EE } = await import('node:events');
  const IDLE = 'idle';
  class FakeAudioPlayer extends EE {
    // NAO auto-emite Idle: o teste controla o ciclo (evita corrida com a injecao
    // manual do erro). Guarda a instancia num global para o teste a manipular.
    constructor() {
      super();
      (globalThis as Record<string, unknown>).__fakePlayer = this;
    }
    play(resource: { path: string }): void {
      (globalThis as Record<string, unknown>).__playOrder ??= [];
      ((globalThis as Record<string, unknown>).__playOrder as string[]).push(resource.path);
    }
    stop(): void {
      this.emit(IDLE);
    }
    // Imita onStreamError do recurso a tocar: 'error' SINCRONO seguido de Idle
    // SINCRONO, para o mesmo recurso.
    simulateStreamError(): void {
      this.emit('error', new Error('stream boom'));
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

describe('GuildVoicePlayer — error+idle sincronos nao fazem double-drain (P19.A)', () => {
  it('apos error+idle de A, corre exatamente UM playNext: B drena uma vez, playing fica consistente, onIdle nao dispara a meio da sintese de B', async () => {
    (globalThis as Record<string, unknown>).__playOrder = [];
    (globalThis as Record<string, unknown>).__fakePlayer = undefined;

    // Sintese de B DIFERIDA: seguramos a promise pendente para inspecionar o estado
    // do player exatamente a meio da sintese de B. A de A resolve logo.
    let resolveB!: (v: string) => void;
    const bPending = new Promise<string>((res) => {
      resolveB = res;
    });
    const engine: TTSEngine = {
      synth: (req: SynthRequest) =>
        req.text === 'B' ? bPending : Promise.resolve(req.text),
    };

    // Silencia (e observa) o log.error do handler 'error' — prova que o caminho de
    // erro correu de facto.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let onIdleCalls = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = makeConnection() as any;
    // inactivityMs pequeno: se o Idle-handler drenar a fila vazia e armar o
    // idle-timer a meio da sintese de B (bug), onIdle dispara. No codigo corrigido
    // playing fica true e o timer nunca e armado.
    const player = new GuildVoicePlayer(conn, engine, 20, 20, () => {
      onIdleCalls++;
    });

    // A entra e comeca a "tocar" (o fake nao auto-emite Idle). Esperamos que A seja
    // efetivamente reproduzido antes de injetar o erro.
    await player.say({ text: 'A', model: 'm', speed: 1 });
    await vi.waitFor(
      () => {
        const order = (globalThis as Record<string, unknown>).__playOrder as string[];
        expect(order).toEqual(['A']);
      },
      { timeout: 1000 },
    );

    // B entra na fila enquanto A "toca".
    await player.say({ text: 'B', model: 'm', speed: 1 });

    // O recurso de A erra: 'error' + 'idle' sincronos (imita onStreamError real).
    const fake = (globalThis as Record<string, unknown>).__fakePlayer as {
      simulateStreamError: () => void;
    };
    fake.simulateStreamError();

    // Neste ponto B esta a ser sintetizado (bPending ainda pendente). Deixar o
    // event-loop escoar os microtasks do(s) playNext() disparado(s) e dar tempo a
    // que um idle-timer errante (inactivityMs=20) dispare, se o bug estiver ativo.
    await new Promise((r) => setTimeout(r, 60));

    // --- Afirmacoes do comportamento CORRETO (falham com o codigo atual) --------
    // (a) A meio da sintese de B o player TEM de estar ativo. Com o bug, o
    //     Idle-handler drenou a fila vazia e colapsou playing->false.
    expect(player.isActive()).toBe(true);
    // (b) onIdle NAO pode ter sido chamado a meio da sintese de B. Com o bug, o
    //     drain espurio armou o idle-timer que disparou (inactivityMs=20).
    expect(onIdleCalls).toBe(0);
    // O caminho de erro correu (log.error).
    expect(errSpy).toHaveBeenCalled();

    // Concluir a sintese de B: deve tocar exatamente UMA vez (fila drenada 1x, nao
    // 2x). Prova adicional de que nao houve double-drain.
    resolveB('B');
    await vi.waitFor(
      () => {
        const order = (globalThis as Record<string, unknown>).__playOrder as string[];
        expect(order).toEqual(['A', 'B']);
      },
      { timeout: 1000 },
    );

    errSpy.mockRestore();
    player.destroy();
  });
});
