import { describe, it, expect } from 'vitest';
import {
  funLocaleOf,
  pickEightball,
  pickFortune,
  pickFact,
  pickWyr,
} from '../src/content/microfun';

describe('funLocaleOf — normaliza o locale da UI para en|pt', () => {
  it("'pt' e 'pt-BR' -> pt; tudo o resto -> en", () => {
    expect(funLocaleOf('pt')).toBe('pt');
    expect(funLocaleOf('pt-BR')).toBe('pt');
    expect(funLocaleOf('en')).toBe('en');
    expect(funLocaleOf('en-US')).toBe('en');
    expect(funLocaleOf('de')).toBe('en'); // línguas sem banco caem no inglês
    expect(funLocaleOf('')).toBe('en');
  });
});

const pickers = [
  { name: '8ball', fn: pickEightball },
  { name: 'fortune', fn: pickFortune },
  { name: 'fact', fn: pickFact },
  { name: 'wyr', fn: pickWyr },
] as const;

describe('pick* — puros, determinísticos e sempre devolvem uma frase não-vazia', () => {
  for (const { name, fn } of pickers) {
    it(`${name}: mesmo seed -> mesma frase (determinístico)`, () => {
      expect(fn('en', 42)).toBe(fn('en', 42));
      expect(fn('pt', 7)).toBe(fn('pt', 7));
    });

    it(`${name}: devolve string não-vazia para en e pt, em qualquer seed`, () => {
      for (const seed of [0, 1, 5, 13, 99, 1000]) {
        expect(fn('en', seed).length).toBeGreaterThan(0);
        expect(fn('pt', seed).length).toBeGreaterThan(0);
      }
    });

    it(`${name}: índice dá a volta (seed grande não rebenta)`, () => {
      expect(() => fn('en', Number.MAX_SAFE_INTEGER)).not.toThrow();
      expect(fn('en', 0)).toBe(fn('en', 0));
    });
  }
});
