import { describe, it, expect } from 'vitest';
import { isBlocked } from '../src/moderation/filter';

describe('isBlocked', () => {
  it('deteta uma palavra presente na blocklist', () => {
    expect(isBlocked('isto e um teste palavrao aqui', ['palavrao'])).toBe(true);
  });

  it('ignora maiusculas/minusculas no texto e na blocklist', () => {
    expect(isBlocked('Isto e um TESTE PalavrAO', ['palavrao'])).toBe(true);
    expect(isBlocked('isto e um palavrao', ['PALAVRAO'])).toBe(true);
  });

  it('faz match por palavra completa, nao por substring', () => {
    // "ass" nao deve disparar dentro de "passar"
    expect(isBlocked('vou passar por ali', ['ass'])).toBe(false);
  });

  it('deteta a palavra mesmo rodeada de pontuacao', () => {
    expect(isBlocked('para, palavrao!', ['palavrao'])).toBe(true);
    expect(isBlocked('(palavrao)', ['palavrao'])).toBe(true);
  });

  it('devolve false quando a blocklist esta vazia', () => {
    expect(isBlocked('qualquer texto', [])).toBe(false);
  });

  it('devolve false quando nenhuma palavra da blocklist aparece', () => {
    expect(isBlocked('texto perfeitamente limpo', ['palavrao', 'outra'])).toBe(false);
  });

  it('deteta qualquer uma de varias palavras na blocklist', () => {
    expect(isBlocked('aqui aparece outra coisa', ['palavrao', 'outra'])).toBe(true);
  });

  it('ignora entradas vazias na blocklist', () => {
    expect(isBlocked('texto normal', ['', '   '])).toBe(false);
  });

  it('faz match de blockword com varias palavras como frase', () => {
    expect(isBlocked('ele disse uma coisa ma agora', ['coisa ma'])).toBe(true);
    expect(isBlocked('isto e uma coisa boa', ['coisa ma'])).toBe(false);
  });
});
