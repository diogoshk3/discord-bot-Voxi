import { describe, it, expect } from 'vitest';
import { applyUserAbbrev } from '../src/textCleaning/userAbbrev';

describe('applyUserAbbrev', () => {
  const entries = [
    { term: 'brb', replacement: 'bora rapaz' },
    { term: 'js', replacement: 'JavaScript' },
  ];

  it('substitui um termo por palavra completa', () => {
    expect(applyUserAbbrev('espera brb', entries)).toBe('espera bora rapaz');
    expect(applyUserAbbrev('eu adoro js', entries)).toBe('eu adoro JavaScript');
  });

  it('e case-insensitive no match', () => {
    expect(applyUserAbbrev('BRB agora', entries)).toBe('bora rapaz agora');
    expect(applyUserAbbrev('Js', entries)).toBe('JavaScript');
  });

  it('so em fronteira de palavra (nao dentro de palavras)', () => {
    expect(applyUserAbbrev('brbx', entries)).toBe('brbx');
    expect(applyUserAbbrev('xbrb', entries)).toBe('xbrb');
  });

  it('substitui termos adjacentes (fronteira zero-width)', () => {
    expect(applyUserAbbrev('brb brb', entries)).toBe('bora rapaz bora rapaz');
  });

  it('preserva pontuacao a volta do termo', () => {
    expect(applyUserAbbrev('(brb)', entries)).toBe('(bora rapaz)');
    expect(applyUserAbbrev('brb!', entries)).toBe('bora rapaz!');
  });

  it('lista vazia -> texto inalterado (no-op)', () => {
    expect(applyUserAbbrev('brb js', [])).toBe('brb js');
  });

  it('texto vazio -> vazio', () => {
    expect(applyUserAbbrev('', entries)).toBe('');
  });

  it('e deterministico', () => {
    const a = applyUserAbbrev('brb e js', entries);
    const b = applyUserAbbrev('brb e js', entries);
    expect(a).toBe(b);
    expect(a).toBe('bora rapaz e JavaScript');
  });
});
