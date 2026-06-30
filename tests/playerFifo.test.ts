import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// --- Mock de @discordjs/voice -------------------------------------------------
// Um AudioPlayer falso (EventEmitter) cujo play() regista o recurso tocado e
// agenda a emissao de Idle para drenar o proximo item da fila, imitando o ciclo
// real (tocar -> acabar -> Idle -> playNext). createAudioResource devolve o
// proprio path para podermos ler a identidade/ordem de reproducao.
// NOTA: vi.mock e hoisted para o topo do ficheiro, por isso a factory NAO pode
// referenciar variaveis de nivel-superior — tudo o que precisa vive aqui dentro.
vi.mock('@discordjs/voice', async () => {
  const { EventEmitter: EE } = await import('node:events');
  const IDLE = 'idle';
  class FakeAudioPlayer extends EE {
    play(resource: { path: string }): void {
      // Regista a ordem de reproducao real.
      (globalThis as Record<string, unknown>).__playOrder ??= [];
      ((globalThis as Record<string, unknown>).__playOrder as string[]).push(resource.path);
      // Termina o "audio" no proximo tick -> dispara o handler de Idle do player,
      // que chama playNext() para drenar o item seguinte.
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

describe('GuildVoicePlayer FIFO (synth no worker)', () => {
  it('reproduz por ordem de chegada de say(), nao por ordem de conclusao da sintese', async () => {
    (globalThis as Record<string, unknown>).__playOrder = [];

    // Engine falso: o PRIMEIRO pedido demora MAIS a sintetizar que o segundo.
    // Se a sintese acontecesse antes do enqueue (bug), 'segundo' enfileiraria
    // primeiro e tocaria a frente. Com synth-no-worker, a ordem mantem-se.
    const delays: Record<string, number> = { primeiro: 40, segundo: 5, terceiro: 5 };
    const engine: TTSEngine = {
      synth: (req: SynthRequest) =>
        new Promise((resolve) => setTimeout(() => resolve(req.text), delays[req.text] ?? 0)),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = makeConnection() as any;
    const player = new GuildVoicePlayer(conn, engine, 20, 60_000, () => {});

    // Tres say() CONCORRENTES, por ordem de chamada: primeiro, segundo, terceiro.
    // NAO se faz await individual — disparam-se quase em simultaneo, como mensagens
    // concorrentes reais. No bug antigo (synth ANTES do enqueue) o pedido com
    // sintese mais rapida ('segundo') enfileiraria a frente do 'primeiro' (mais
    // lento) e tocaria fora de ordem. Com synth-no-worker, o enqueue e sincrono
    // por ordem de chamada e a ordem mantem-se.
    const pending = [
      player.say({ text: 'primeiro', model: 'm', speed: 1 }),
      player.say({ text: 'segundo', model: 'm', speed: 1 }),
      player.say({ text: 'terceiro', model: 'm', speed: 1 }),
    ];
    await Promise.all(pending);

    // Esperar que a fila drene completamente.
    await vi.waitFor(
      () => {
        const order = (globalThis as Record<string, unknown>).__playOrder as string[];
        expect(order).toHaveLength(3);
      },
      { timeout: 1000 },
    );

    const order = (globalThis as Record<string, unknown>).__playOrder as string[];
    // A prova: ordem de reproducao == ordem de say(), apesar de 'primeiro' ter a
    // sintese mais lenta.
    expect(order).toEqual(['primeiro', 'segundo', 'terceiro']);

    player.destroy();
  });
});
