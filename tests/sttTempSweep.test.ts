import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sweepOrphanSttTemps } from '../src/voice/transcriptionSession';

describe('sweepOrphanSttTemps — reconciliação de WAV STT órfãos (PRIVACY §2.4)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vozen-stt-sweep-'));
    writeFileSync(join(dir, 'vozen-stt-1234-abcdef-0.wav'), 'x');
    writeFileSync(join(dir, 'vozen-stt-1234-abcdef-1.wav'), 'x');
    writeFileSync(join(dir, 'other-file.wav'), 'x'); // não é STT -> nunca tocar
    writeFileSync(join(dir, 'vozen-stt-note.txt'), 'x'); // não é .wav -> nunca tocar
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('apaga os temporários STT antigos e preserva ficheiros alheios', () => {
    // now no futuro -> os WAV recém-criados contam como > 5 min (órfãos de um crash).
    const removed = sweepOrphanSttTemps(dir, Date.now() + 10 * 60_000);
    expect(removed).toBe(2);
    expect(existsSync(join(dir, 'vozen-stt-1234-abcdef-0.wav'))).toBe(false);
    expect(existsSync(join(dir, 'vozen-stt-1234-abcdef-1.wav'))).toBe(false);
    expect(existsSync(join(dir, 'other-file.wav'))).toBe(true);
    expect(existsSync(join(dir, 'vozen-stt-note.txt'))).toBe(true);
  });

  it('guard de idade: não apaga um WAV recente (pode estar vivo noutro processo)', () => {
    const removed = sweepOrphanSttTemps(dir, Date.now()); // ficheiros acabados de criar
    expect(removed).toBe(0);
    expect(readdirSync(dir)).toHaveLength(4);
  });

  it('dir inexistente -> 0, sem lançar', () => {
    expect(() => sweepOrphanSttTemps(join(dir, 'nope'))).not.toThrow();
    expect(sweepOrphanSttTemps(join(dir, 'nope'))).toBe(0);
  });
});
