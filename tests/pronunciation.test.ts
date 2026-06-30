import { describe, it, expect } from 'vitest';
import { applyPronunciation } from '../src/textCleaning/pronunciation';
import type { PronunciationEntry } from '../src/textCleaning/pronunciation';

describe('applyPronunciation', () => {
  it('dict vazio = no-op', () => {
    expect(applyPronunciation('ola mundo', [])).toBe('ola mundo');
  });

  it('substitui um termo por palavra completa', () => {
    const dict: PronunciationEntry[] = [{ term: 'gg', replacement: 'good game' }];
    expect(applyPronunciation('gg a todos', dict)).toBe('good game a todos');
  });

  it('substituicao e case-insensitive', () => {
    const dict: PronunciationEntry[] = [{ term: 'gg', replacement: 'good game' }];
    expect(applyPronunciation('GG malta', dict)).toBe('good game malta');
    expect(applyPronunciation('Gg malta', dict)).toBe('good game malta');
  });

  it('nao afeta substrings (so palavra completa)', () => {
    const dict: PronunciationEntry[] = [{ term: 'gg', replacement: 'good game' }];
    // "eggs" contem "gg" mas nao deve ser tocado
    expect(applyPronunciation('eggs e ovos', dict)).toBe('eggs e ovos');
  });

  it('substitui multiplos termos diferentes', () => {
    const dict: PronunciationEntry[] = [
      { term: 'gg', replacement: 'good game' },
      { term: 'btw', replacement: 'by the way' },
    ];
    expect(applyPronunciation('gg e btw acabou', dict)).toBe('good game e by the way acabou');
  });

  it('substitui ocorrencias repetidas do mesmo termo', () => {
    const dict: PronunciationEntry[] = [{ term: 'gg', replacement: 'good game' }];
    expect(applyPronunciation('gg gg gg', dict)).toBe('good game good game good game');
  });

  it('substitui dois termos diferentes adjacentes (fronteira zero-width)', () => {
    // Boundary chars sao zero-width: ambos os termos adjacentes sao substituidos.
    const dict: PronunciationEntry[] = [
      { term: 'aa', replacement: 'X' },
      { term: 'bb', replacement: 'Y' },
    ];
    expect(applyPronunciation('aa bb', dict)).toBe('X Y');
  });

  it('respeita fronteiras unicode (acentos contam como letra)', () => {
    const dict: PronunciationEntry[] = [{ term: 'ca', replacement: 'KA' }];
    // "café" nao deve ser tocado: o "é" faz parte da palavra (fronteira unicode)
    expect(applyPronunciation('café quente', dict)).toBe('café quente');
  });

  it('substitui um termo acentuado', () => {
    const dict: PronunciationEntry[] = [{ term: 'salázar', replacement: 'ditador' }];
    expect(applyPronunciation('o salázar fez', dict)).toBe('o ditador fez');
  });

  it('escapa metacaracteres de regex no termo', () => {
    const dict: PronunciationEntry[] = [{ term: 'c++', replacement: 'cplusplus' }];
    expect(applyPronunciation('amo c++', dict)).toBe('amo cplusplus');
  });

  it('replacement vazio remove o termo (deixa a fronteira)', () => {
    const dict: PronunciationEntry[] = [{ term: 'lol', replacement: '' }];
    // O termo e removido; a substituicao acontece DEPOIS do cleanText, por isso
    // o whitespace residual nao e re-colapsado (comportamento fixado).
    expect(applyPronunciation('isto lol acabou', dict)).toBe('isto  acabou');
  });

  it('e deterministico para o mesmo input', () => {
    const dict: PronunciationEntry[] = [
      { term: 'gg', replacement: 'good game' },
      { term: 'wp', replacement: 'well played' },
    ];
    const out1 = applyPronunciation('gg wp gg', dict);
    const out2 = applyPronunciation('gg wp gg', dict);
    expect(out1).toBe(out2);
    expect(out1).toBe('good game well played good game');
  });

  it('substitui um termo multi-palavra (nick com espaco)', () => {
    const dict: PronunciationEntry[] = [{ term: 'xX Sniper Xx', replacement: 'o jogador' }];
    expect(applyPronunciation('boa xX Sniper Xx', dict)).toBe('boa o jogador');
  });
});
