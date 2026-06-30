// tests/piper.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PiperEngine } from '../src/tts/piper';
import { AudioCache } from '../src/tts/cache';
import type { SynthRequest } from '../src/tts/engine';

// Apenas o child_process e mockado; fs e real (precisamos do guard existsSync do
// modelo + do diretorio temporario da cache).
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

const spawnMock = vi.mocked(spawn);

/**
 * Child fake: EventEmitter real com stdin/stderr (tambem EventEmitters) e
 * stdin.write/end + kill como spies. Os listeners sao registados sincronamente
 * dentro do executor da Promise, por isso emitir logo a seguir a synth() funciona.
 */
function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  const stdin = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  stdin.write = vi.fn();
  stdin.end = vi.fn();
  child.stdin = stdin;
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe('PiperEngine.synth — spawn mockado (EPIPE / falhas)', () => {
  let dir: string;
  let modelsDir: string;
  let cache: AudioCache;
  let engine: PiperEngine;
  const req: SynthRequest = { text: 'ola', model: 'pt_PT-test', speed: 1 };

  beforeEach(() => {
    spawnMock.mockReset();
    dir = mkdtempSync(join(tmpdir(), 'pipercache-'));
    modelsDir = mkdtempSync(join(tmpdir(), 'pipermodels-'));
    // Dummy .onnx para o guard existsSync(modelPath) passar.
    writeFileSync(join(modelsDir, `${req.model}.onnx`), 'dummy');
    cache = new AudioCache(dir);
    engine = new PiperEngine('piper', modelsDir, cache);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(modelsDir, { recursive: true, force: true });
  });

  it('stdin emite EPIPE + child fecha com codigo != 0 -> rejeita limpo, sem crashar', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const p = engine.synth(req);
    // O EPIPE no stdin deve ser engolido (child morreu -> 'close' trata).
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    child.stderr.emit('data', Buffer.from('piper died'));
    child.emit('close', 1);

    await expect(p).rejects.toThrow(/saiu com codigo 1/);
  });

  it('stdin EPIPE seguido de close(0) -> nao gerou WAV (settla, nao crasha)', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const p = engine.synth(req);
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    child.emit('close', 0); // saiu 0 mas nada escrito no outPath (fs real)

    await expect(p).rejects.toThrow(/nao gerou WAV/);
  });

  it('erro de stdin NAO-EPIPE -> rejeita com "Falha ao escrever no stdin"', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const p = engine.synth(req);
    child.stdin.emit('error', Object.assign(new Error('boom'), { code: 'ERR_OTHER' }));

    await expect(p).rejects.toThrow(/Falha ao escrever no stdin do Piper/);
  });

  it('spawn falha (ENOENT) -> rejeita com "Falha ao iniciar Piper"', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const p = engine.synth(req);
    child.emit('error', Object.assign(new Error('spawn piper ENOENT'), { code: 'ENOENT' }));

    await expect(p).rejects.toThrow(/Falha ao iniciar Piper/);
  });

  it('write sincrono lanca -> rejeita limpo com "Falha ao escrever no stdin"', async () => {
    const child = makeFakeChild();
    child.stdin.write.mockImplementation(() => {
      throw new Error('stream destroyed');
    });
    spawnMock.mockReturnValue(child as never);

    await expect(engine.synth(req)).rejects.toThrow(/Falha ao escrever no stdin do Piper/);
  });

  it('exit code != 0 (sem EPIPE) -> rejeita com codigo e stderr', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const p = engine.synth(req);
    child.stderr.emit('data', Buffer.from('bad model'));
    child.emit('close', 2);

    await expect(p).rejects.toThrow(/saiu com codigo 2: bad model/);
  });

  it('calibração: spawn recebe --length_scale 1.5 para pt_PT-tugao-medium', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const calibReq: SynthRequest = { text: 'ola', model: 'pt_PT-tugao-medium', speed: 1 };
    writeFileSync(join(modelsDir, `${calibReq.model}.onnx`), 'dummy');

    const p = engine.synth(calibReq);
    const args = spawnMock.mock.calls[0][1] as string[];
    const idx = args.indexOf('--length_scale');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('1.5');

    // settle a promise para nao deixar rejeicao pendente
    child.emit('close', 1);
    await expect(p).rejects.toThrow();
  });
});
