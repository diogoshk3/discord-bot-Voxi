import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WhisperTranscriber } from '../src/voice/whisperTranscriber';

// Sidecar Whisper FALSO: imprime {ready} SOZINHO ao arrancar (sem warmup prompt, como o
// tools/whisper_sidecar.py real), depois responde a cada linha (=caminho WAV) com
// {text,lang} — ou {error} — em 'fail'. 'never-ready' nunca emite {ready}.
function fakeSidecar(behavior: 'ok' | 'fail' | 'never-ready' = 'ok', counter?: { spawns: number }) {
  return (() => {
    if (counter) counter.spawns++;
    const child = new EventEmitter() as EventEmitter & {
      stdin: { write: (s: string) => void };
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = {
      write: (s: string) => {
        const path = s.trim();
        queueMicrotask(() => {
          if (behavior === 'ok') {
            child.stdout.emit(
              'data',
              Buffer.from(JSON.stringify({ text: `t:${path}`, lang: 'en' }) + '\n'),
            );
          } else {
            child.stdout.emit('data', Buffer.from(JSON.stringify({ error: 'boom' }) + '\n'));
          }
        });
      },
    };
    // Emite {ready} logo a seguir ao spawn (o sidecar real fá-lo após carregar o modelo).
    if (behavior !== 'never-ready') {
      queueMicrotask(() =>
        child.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ ready: true, model: 'base' }) + '\n'),
        ),
      );
    }
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
}

describe('WhisperTranscriber', () => {
  let t: WhisperTranscriber | null = null;
  afterEach(() => {
    t?.dispose();
    t = null;
  });

  it('available=false sem comando (sidecar não instalado)', () => {
    t = new WhisperTranscriber(null);
    expect(t.available).toBe(false);
  });

  it('transcreve um WAV -> {text,lang} depois do {ready}', async () => {
    t = new WhisperTranscriber({ exe: 'py', args: ['w.py'] }, fakeSidecar('ok'));
    const r = await t.transcribe('/tmp/a.wav');
    expect(r).toEqual({ text: 't:/tmp/a.wav', lang: 'en' });
  });

  it('serializa os pedidos (cap=1): responde na ordem', async () => {
    t = new WhisperTranscriber({ exe: 'py', args: ['w.py'] }, fakeSidecar('ok'));
    const [a, b] = await Promise.all([t.transcribe('/tmp/1.wav'), t.transcribe('/tmp/2.wav')]);
    expect(a.text).toBe('t:/tmp/1.wav');
    expect(b.text).toBe('t:/tmp/2.wav');
  });

  it('erro do sidecar -> rejeita', async () => {
    t = new WhisperTranscriber({ exe: 'py', args: ['w.py'] }, fakeSidecar('fail'));
    await expect(t.transcribe('/tmp/a.wav')).rejects.toThrow(/boom/);
  });

  it('reusa o MESMO processo entre pedidos (persistente)', async () => {
    const counter = { spawns: 0 };
    t = new WhisperTranscriber({ exe: 'py', args: ['w.py'] }, fakeSidecar('ok', counter));
    await t.transcribe('/tmp/1.wav');
    await t.transcribe('/tmp/2.wav');
    expect(counter.spawns).toBe(1);
  });
});
