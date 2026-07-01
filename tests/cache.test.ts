// tests/cache.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKey, AudioCache } from '../src/tts/cache';
import type { SynthRequest } from '../src/tts/engine';

// Guarda as implementacoes REAIS de statSync/readdirSync para as poder repor no
// afterEach (mockReset limpa tambem a impl default). `vi.hoisted` corre antes do
// factory de vi.mock, por isso as refs estao disponiveis dentro dele.
const realFs = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actual = require('node:fs') as typeof import('node:fs');
  return { statSync: actual.statSync, readdirSync: actual.readdirSync };
});

// Mock de node:fs que MANTEM as implementacoes reais (spread `...actual`) e apenas
// envolve `statSync`/`readdirSync` em spies. Assim os restantes testes com fs REAL
// deste ficheiro continuam verdes; so os testes de ramos defensivos abaixo forcam
// (via mockImplementationOnce, scoped a UMA chamada) essas duas funcoes a lancar.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    statSync: vi.fn(actual.statSync),
    readdirSync: vi.fn(actual.readdirSync),
  };
});

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

  // ── leadSilenceMs: PREPEND de silencio afeta o audio -> tem de afetar a chave ──
  it('muda quando leadSilenceMs muda', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, leadSilenceMs: 2000 }));
  });

  it('back-compat: leadSilenceMs undefined vs 0 -> MESMA chave (e igual a sem silencio)', () => {
    const noField = cacheKey(base); // leadSilenceMs undefined
    const zero = cacheKey({ ...base, leadSilenceMs: 0 });
    expect(zero).toBe(noField);
  });

  it('valores distintos de leadSilenceMs -> chaves distintas', () => {
    expect(cacheKey({ ...base, leadSilenceMs: 1000 })).not.toBe(
      cacheKey({ ...base, leadSilenceMs: 2000 }),
    );
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

  it('withNamespace herda o maxFiles do pai', () => {
    const base = new AudioCache(dir, 2);
    const ns = base.withNamespace('eng');
    // Escreve 3 ficheiros; o mais antigo deve ser removido
    const t0 = new Date(Date.now() - 3000);
    const t1 = new Date(Date.now() - 2000);
    const t2 = new Date(Date.now() - 1000);

    const makeWav = (name: string) => {
      const p = join(srcDir, name);
      writeFileSync(p, Buffer.from('x'));
      return p;
    };

    const s0 = makeWav('a.wav');
    const s1 = makeWav('b.wav');
    const s2 = makeWav('c.wav');

    const p0 = ns.put('key0', s0);
    utimesSync(p0, t0, t0);
    const p1 = ns.put('key1', s1);
    utimesSync(p1, t1, t1);
    // Terceiro put deve desencadear eviction de key0
    ns.put('key2', s2);
    utimesSync(join(ns['dir'], 'key2.wav'), t2, t2);

    const remaining = readdirSync(ns['dir']).filter((f) => f.endsWith('.wav'));
    expect(remaining.length).toBeLessThanOrEqual(2);
    // key0 (mais antigo) foi removido
    expect(existsSync(p0)).toBe(false);
  });
});

describe('AudioCache eviction (maxFiles)', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-evict-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-evict-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  function makeSrc(name: string, content = 'wav'): string {
    const p = join(srcDir, name);
    writeFileSync(p, Buffer.from(content));
    return p;
  }

  it('abaixo do cap: nenhum ficheiro e removido', () => {
    const cache = new AudioCache(dir, 5);
    for (let i = 0; i < 5; i++) {
      cache.put(`k${i}`, makeSrc(`f${i}.wav`));
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(files.length).toBe(5);
  });

  it('ao exceder o cap, os mais antigos sao removidos', () => {
    const cache = new AudioCache(dir, 3);
    const now = Date.now();

    // Escreve 3 ficheiros com mtimes determinísticos (antigos)
    const paths: string[] = [];
    for (let i = 0; i < 3; i++) {
      const dest = cache.put(`old${i}`, makeSrc(`old${i}.wav`));
      const t = new Date(now - (3 - i) * 1000); // old0 mais antigo
      utimesSync(dest, t, t);
      paths.push(dest);
    }

    // 4.º put excede o cap (cap=3): deve remover o mais antigo (old0)
    const newest = cache.put('new0', makeSrc('new0.wav'));

    const remaining = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(remaining.length).toBeLessThanOrEqual(3);
    expect(existsSync(paths[0])).toBe(false); // old0 removido
    expect(existsSync(newest)).toBe(true);     // recém-escrito nunca e removido
  });

  it('ao exceder por mais de 1, remove todos os excedentes mais antigos', () => {
    const cache = new AudioCache(dir, 2);
    const now = Date.now();

    // Escreve 4 ficheiros com mtimes espaçados
    const p: string[] = [];
    for (let i = 0; i < 4; i++) {
      const dest = cache.put(`k${i}`, makeSrc(`f${i}.wav`));
      utimesSync(dest, new Date(now - (4 - i) * 2000), new Date(now - (4 - i) * 2000));
      p.push(dest);
    }
    // Após 4 puts com cap=2, o diretório deve ter no máximo 2 ficheiros
    const remaining = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(remaining.length).toBeLessThanOrEqual(2);
    // O mais recente (k3) deve sobreviver
    expect(existsSync(p[3])).toBe(true);
  });

  it('o ficheiro recem-escrito nunca e evicted mesmo com cap=1', () => {
    const cache = new AudioCache(dir, 1);
    const now = Date.now();

    // Escreve ficheiro antigo
    const old = cache.put('old', makeSrc('old.wav'));
    utimesSync(old, new Date(now - 5000), new Date(now - 5000));

    // 2.º put excede cap: old deve ir, new deve ficar
    const newest = cache.put('new', makeSrc('new.wav'));
    expect(existsSync(newest)).toBe(true);
    expect(existsSync(old)).toBe(false);
  });

  it('maxFiles=0 desativa eviction (sem remocoes)', () => {
    const cache = new AudioCache(dir, 0);
    for (let i = 0; i < 10; i++) {
      cache.put(`k${i}`, makeSrc(`f${i}.wav`));
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(files.length).toBe(10);
  });
});

// ── ramos defensivos do evict ─────────────────────────────────────────────────
// Estes testes forcam `statSync`/`readdirSync` (mockados no topo) a lancar, para
// cobrir os catch de dentro/fora do map em `evict`. `mockImplementationOnce` limita
// o throw a UMA chamada; as restantes voltam a delegar na implementacao real.
describe('AudioCache.evict — ramos defensivos', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-def-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-def-'));
  });

  afterEach(() => {
    // Repoe as implementacoes REAIS (limpa qualquer mockImplementation/Once pendente)
    // para nao contaminar testes seguintes.
    vi.mocked(statSync).mockReset();
    vi.mocked(statSync).mockImplementation(realFs.statSync as never);
    vi.mocked(readdirSync).mockReset();
    vi.mocked(readdirSync).mockImplementation(realFs.readdirSync as never);
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  function makeSrc(name: string, content = 'wav'): string {
    const p = join(srcDir, name);
    writeFileSync(p, Buffer.from(content));
    return p;
  }

  it('statSync a falhar num ficheiro: entrada vira null, e filtrada, evict nao crasha', () => {
    // cap=1 para forcar eviccao no 2o put. No evict o statSync do ficheiro antigo
    // lanca -> essa entrada vira null e e removida do array (o map apanha o erro).
    const cache = new AudioCache(dir, 1);

    const old = cache.put('old', makeSrc('old.wav'));

    // No proximo evict, a PRIMEIRA chamada a statSync lanca (ficheiro "sumiu").
    vi.mocked(statSync).mockImplementationOnce(() => {
      throw new Error('ENOENT: statSync falhou');
    });

    // Nao deve crashar mesmo com uma entrada a falhar.
    expect(() => cache.put('new', makeSrc('new.wav'))).not.toThrow();

    // O recem-escrito continua la (nunca e alvo de eviccao).
    expect(existsSync(join(dir, 'new.wav'))).toBe(true);
    // `old` nao pode ser removido porque a sua entrada foi filtrada (statSync lancou),
    // por isso, apesar de exceder o cap, nao havia candidato valido para remover.
    expect(existsSync(old)).toBe(true);
  });

  it('readdirSync a lancar (dir sumiu): evict sai sem crashar e sem remover nada', () => {
    const cache = new AudioCache(dir, 1);

    const old = cache.put('old', makeSrc('old.wav'));

    // O readdirSync do proximo evict lanca (dir desapareceu entre o put e o evict).
    vi.mocked(readdirSync).mockImplementationOnce(() => {
      throw new Error('ENOENT: readdirSync falhou');
    });

    // O catch exterior apanha e faz `return` — sem crash.
    expect(() => cache.put('new', makeSrc('new.wav'))).not.toThrow();

    // Nada foi removido: o put copiou o ficheiro novo e o evict saiu cedo.
    expect(existsSync(join(dir, 'new.wav'))).toBe(true);
    expect(existsSync(old)).toBe(true);
  });

  it('mtime empatado: o recem-escrito NUNCA e removido (excluido antes do sort)', () => {
    // cap=1 e mtimes todos iguais. Como `justWritten` e filtrado ANTES do sort, o
    // recem-escrito nunca e candidato — mesmo com empate perfeito de mtime.
    const cache = new AudioCache(dir, 1);

    const old = cache.put('old', makeSrc('old.wav'));

    // Todos os ficheiros passam a ter EXATAMENTE o mesmo mtimeMs no proximo evict.
    vi.mocked(statSync).mockImplementation((() => ({ mtimeMs: 1000 })) as never);

    const newest = cache.put('new', makeSrc('new.wav'));

    // O recem-escrito sobrevive ao empate; o antigo (unico candidato) e removido.
    expect(existsSync(newest)).toBe(true);
    expect(existsSync(old)).toBe(false);
  });
});
