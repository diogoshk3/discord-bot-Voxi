// tests/cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKey, AudioCache } from '../src/tts/cache';
import type { SynthRequest } from '../src/tts/engine';

describe('cacheKey', () => {
  const base: SynthRequest = { text: 'ola mundo', model: 'pt_PT', speed: 1 };

  it('e estavel: mesma request -> mesma chave', () => {
    expect(cacheKey(base)).toBe(cacheKey({ ...base }));
  });

  it('e um hash sha1 hex (40 chars)', () => {
    expect(cacheKey(base)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('muda quando o texto muda', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, text: 'outro texto' }));
  });

  it('muda quando o model muda', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, model: 'en_US' }));
  });

  it('muda quando a speed muda', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, speed: 1.5 }));
  });

  it('nao confunde fronteiras de campos (text vs model)', () => {
    // 'ab' + 'c' nao deve colidir com 'a' + 'bc'
    const a: SynthRequest = { text: 'ab', model: 'c', speed: 1 };
    const b: SynthRequest = { text: 'a', model: 'bc', speed: 1 };
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it('does not collide on field boundaries', () => {
    const a = cacheKey({ text: 'a b', model: 'c', speed: 1 });
    const b = cacheKey({ text: 'a', model: 'b c', speed: 1 });
    expect(a).not.toBe(b);
  });
});

describe('AudioCache', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  it('get devolve null para chave inexistente', () => {
    const cache = new AudioCache(dir);
    expect(cache.get('naoexiste')).toBeNull();
  });

  it('put copia o ficheiro para o dir e devolve o caminho; get devolve-o depois', () => {
    const cache = new AudioCache(dir);
    const src = join(srcDir, 'gerado.wav');
    writeFileSync(src, Buffer.from('RIFFfakewav'));

    const stored = cache.put('chave1', src);

    expect(existsSync(stored)).toBe(true);
    expect(stored).toBe(join(dir, 'chave1.wav'));
    expect(readFileSync(stored).toString()).toBe('RIFFfakewav');
    expect(cache.get('chave1')).toBe(stored);
  });

  it('put nao apaga o ficheiro de origem (copia, nao move)', () => {
    const cache = new AudioCache(dir);
    const src = join(srcDir, 'gerado.wav');
    writeFileSync(src, Buffer.from('dados'));

    cache.put('chave2', src);

    expect(existsSync(src)).toBe(true);
  });

  it('cria o dir se nao existir', () => {
    const nested = join(dir, 'sub', 'cache');
    const cache = new AudioCache(nested);
    const src = join(srcDir, 'g.wav');
    writeFileSync(src, Buffer.from('x'));
    const stored = cache.put('k', src);
    expect(existsSync(stored)).toBe(true);
  });
});
