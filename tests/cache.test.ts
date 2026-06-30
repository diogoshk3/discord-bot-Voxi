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

describe('AudioCache.withNamespace', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-ns-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-ns-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  it('namespaces diferentes resolvem para subdiretorios distintos', () => {
    const base = new AudioCache(dir);
    const piper = base.withNamespace('piper');
    const neural = base.withNamespace('neural');

    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('audio'));

    const piperPath = piper.put('chave', src);
    const neuralPath = neural.put('chave', src);

    expect(piperPath).toContain('piper');
    expect(neuralPath).toContain('neural');
    expect(piperPath).not.toBe(neuralPath);
  });

  it('hit num namespace nao e visivel no outro (sem cross-contamination)', () => {
    const base = new AudioCache(dir);
    const piper = base.withNamespace('piper');
    const neural = base.withNamespace('neural');

    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('audio'));

    piper.put('chave', src);

    // 'neural' nao tem a chave — nao deve encontrar o ficheiro do 'piper'
    expect(neural.get('chave')).toBeNull();
  });

  it('mesma chave em namespaces diferentes nao colide — cada um le o seu proprio ficheiro', () => {
    // cacheKey seria identico para a mesma SynthRequest, mas o dir e diferente
    const base = new AudioCache(dir);
    const piper = base.withNamespace('piper');
    const neural = base.withNamespace('neural');

    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('audio-piper'));

    const src2 = join(srcDir, 'out2.wav');
    writeFileSync(src2, Buffer.from('audio-neural'));

    piper.put('abc123', src);
    neural.put('abc123', src2);

    // Cada namespace le o seu proprio ficheiro
    expect(piper.get('abc123')).toBeTruthy();
    expect(neural.get('abc123')).toBeTruthy();
    expect(piper.get('abc123')).not.toBe(neural.get('abc123'));
  });

  it('withNamespace cria o subdiretorio automaticamente', () => {
    const base = new AudioCache(dir);
    const ns = base.withNamespace('someengine');
    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('x'));
    const stored = ns.put('k', src);
    expect(existsSync(stored)).toBe(true);
  });
});
