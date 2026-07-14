import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { saveClone } from '../src/store/voiceClone';
import { findOrphanSamplePaths, sweepOrphanClones } from '../src/store/voiceCloneSweep';

describe('findOrphanSamplePaths (lógica PURA do diff — DATA-06)', () => {
  it('ficheiro sem sample_path correspondente é órfão', () => {
    const orphans = findOrphanSamplePaths(['/data/voice-clones/u1-1.wav'], []);
    expect(orphans).toEqual(['/data/voice-clones/u1-1.wav']);
  });

  it('ficheiro com sample_path correspondente NÃO é órfão', () => {
    const live = '/data/voice-clones/u1-1.wav';
    const orphans = findOrphanSamplePaths([live], [live]);
    expect(orphans).toEqual([]);
  });

  it('mistura: só os ficheiros SEM linha viva voltam', () => {
    const live = '/data/voice-clones/u1-live.wav';
    const orphan = '/data/voice-clones/u2-orphan.wav';
    const orphans = findOrphanSamplePaths([live, orphan], [live]);
    expect(orphans).toEqual([orphan]);
  });

  it('sem ficheiros no disco -> sem órfãos, mesmo com sample_path na BD', () => {
    expect(findOrphanSamplePaths([], ['/data/voice-clones/x.wav'])).toEqual([]);
  });

  it('sem NENHUMA linha viva -> TODOS os ficheiros no disco são órfãos', () => {
    const files = ['/a/1.wav', '/a/2.wav'];
    expect(findOrphanSamplePaths(files, [])).toEqual(files);
  });

  it('normaliza separadores/caixa (Windows é case-insensitive) antes de comparar', () => {
    // Mesmo caminho, formas de escrita diferentes (maiúsculas vs minúsculas) — NÃO deve
    // ser tratado como órfão só por causa da caixa (falso positivo apagaria uma amostra viva).
    const onDisk = 'C:\\bot\\voice-clones\\u1-1.wav';
    const inDb = 'C:\\bot\\voice-clones\\U1-1.WAV';
    const orphans = findOrphanSamplePaths([onDisk], [inDb]);
    if (process.platform === 'win32') {
      expect(orphans).toEqual([]); // mesmo ficheiro, só a caixa difere -> NÃO é órfão
    } else {
      // noutros SO's (case-sensitive) isto seriam mesmo ficheiros diferentes — sem risco
      // aqui porque o processo que escreve e o que varre correm no MESMO SO.
      expect(orphans).toEqual([onDisk]);
    }
  });

  it('caminho relativo vs absoluto do MESMO ficheiro resolve para o mesmo normalizado', () => {
    // path.resolve() usa o cwd atual — comparar um relativo com o seu equivalente absoluto
    // não pode gerar um falso órfão.
    const abs = join(process.cwd(), 'voice-clones', 'u1-1.wav');
    const orphans = findOrphanSamplePaths([abs], ['voice-clones/u1-1.wav']);
    expect(orphans).toEqual([]);
  });
});

describe('sweepOrphanClones (I/O — DATA-06)', () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voice-clones-sweep-'));
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('STOP-condition: apaga SÓ o órfão; a amostra viva (referenciada por sample_path) sobrevive', () => {
    const livePath = join(dir, 'u1-live.wav');
    const orphanPath = join(dir, 'u2-orphan.wav');
    writeFileSync(livePath, 'RIFFfake-live');
    writeFileSync(orphanPath, 'RIFFfake-orphan');
    // A linha viva referencia o caminho REAL (mesma forma que voice.ts grava: caminho
    // absoluto, join(dirname(dbPath), 'voice-clones', ficheiro)).
    saveClone(db, 'u1', livePath, Date.now());

    const result = sweepOrphanClones(db, dir);

    expect(result.removed).toEqual([orphanPath]);
    expect(existsSync(orphanPath)).toBe(false); // órfão apagado
    expect(existsSync(livePath)).toBe(true); // amostra viva intacta
  });

  it('sem órfãos -> nada é apagado', () => {
    const livePath = join(dir, 'u1-live.wav');
    writeFileSync(livePath, 'RIFFfake');
    saveClone(db, 'u1', livePath, Date.now());

    const result = sweepOrphanClones(db, dir);

    expect(result.removed).toEqual([]);
    expect(existsSync(livePath)).toBe(true);
  });

  it('diretório inexistente -> no-op (nunca lança)', () => {
    const result = sweepOrphanClones(db, join(dir, 'nao-existe'));
    expect(result).toEqual({ scanned: 0, removed: [], failed: [] });
  });

  it('ignora ficheiros que não sejam .wav (nunca toca noutra coisa que viva na pasta)', () => {
    const readme = join(dir, 'README.txt');
    writeFileSync(readme, 'nao e um wav');
    const result = sweepOrphanClones(db, dir);
    expect(result.removed).toEqual([]);
    expect(existsSync(readme)).toBe(true);
  });

  it('user_clone SEM NENHUMA linha -> todos os .wav no disco são órfãos e apagados', () => {
    const a = join(dir, 'a.wav');
    const b = join(dir, 'b.wav');
    writeFileSync(a, 'RIFFa');
    writeFileSync(b, 'RIFFb');
    const result = sweepOrphanClones(db, dir);
    expect(result.removed.sort()).toEqual([a, b].sort());
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);
  });

  it('múltiplos donos com clones vivos -> nenhum é tocado', () => {
    const p1 = join(dir, 'u1.wav');
    const p2 = join(dir, 'u2.wav');
    writeFileSync(p1, 'RIFF1');
    writeFileSync(p2, 'RIFF2');
    saveClone(db, 'u1', p1, Date.now());
    saveClone(db, 'u2', p2, Date.now());
    const result = sweepOrphanClones(db, dir);
    expect(result.removed).toEqual([]);
    expect(existsSync(p1)).toBe(true);
    expect(existsSync(p2)).toBe(true);
  });
});
