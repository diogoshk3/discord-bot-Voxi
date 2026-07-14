// tests/logRotation.test.ts — rotação de logs do supervisor A MEIO-do-run (plano 028).
// Antes desta mudança a rotação só corria no arranque do start-prod.mjs; um child em
// crash-loop inundava logs/vozen.log sem limite até encher o disco. Cobre: rotação ao
// ultrapassar maxBytes numa escrita a meio, seed do contador a partir do ficheiro já
// existente (rotação também no arranque), e que write() NUNCA lança mesmo com a pasta
// removida a meio (degrada em silêncio).
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRotatingWriter } from '../scripts/logRotation.mjs';

const dirs: string[] = [];
function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'logrotation-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('makeRotatingWriter — rotação a meio-do-run', () => {
  it('roda para .1 quando os bytes escritos ultrapassam maxBytes, mantendo 1 geração', () => {
    const dir = makeTmpDir();
    const writer = makeRotatingWriter(dir, 'vozen.log', 50);

    // 6 chunks de 10 bytes = 60 bytes, ultrapassa o limite de 50 a meio da sequência.
    for (let i = 0; i < 6; i++) writer.write('0123456789');

    expect(existsSync(writer.rotatedFile)).toBe(true);
    expect(statSync(writer.currentFile).size).toBeLessThan(50);
  });

  it('mantém só 1 geração — rotações sucessivas não acumulam .2, .3, …', () => {
    const dir = makeTmpDir();
    const writer = makeRotatingWriter(dir, 'vozen.log', 20);

    for (let i = 0; i < 3; i++) writer.write('12345678901234567890123456789012345');

    expect(existsSync(writer.rotatedFile)).toBe(true);
    expect(existsSync(`${writer.rotatedFile}.1`)).toBe(false);
    expect(existsSync(`${writer.currentFile}.2`)).toBe(false);
  });

  it('semeia o contador a partir do tamanho do ficheiro existente (rotação também no arranque)', () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'vozen.log');
    // Ficheiro de uma sessão anterior já acima do limite.
    writeFileSync(filePath, 'x'.repeat(100));

    const writer = makeRotatingWriter(dir, 'vozen.log', 50);

    // O construtor já deve ter rodado — sem esperar por nenhuma escrita.
    expect(existsSync(writer.rotatedFile)).toBe(true);
    expect(readFileSync(writer.rotatedFile, 'utf8')).toBe('x'.repeat(100));
  });

  it('write() NUNCA lança mesmo com a pasta removida a meio (degrada em silêncio)', () => {
    const dir = makeTmpDir();
    const writer = makeRotatingWriter(dir, 'vozen.log', 50);

    writer.write('linha inicial\n');
    rmSync(dir, { recursive: true, force: true });

    expect(() => writer.write('linha depois da pasta desaparecer\n')).not.toThrow();
    expect(() => writer.write('mais uma para garantir\n')).not.toThrow();
  });

  it('construtor NUNCA lança mesmo quando a pasta não pode ser criada', () => {
    const dir = makeTmpDir();
    // Cria um FICHEIRO onde o writer vai tentar criar uma PASTA — mkdirSync falha.
    const blockedDirPath = join(dir, 'bloqueado');
    writeFileSync(blockedDirPath, 'sou um ficheiro, não uma pasta');

    expect(() => {
      const writer = makeRotatingWriter(blockedDirPath, 'vozen.log', 50);
      writer.write('nunca deve lançar\n');
    }).not.toThrow();
  });
});
