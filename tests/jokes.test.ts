import { describe, it, expect } from 'vitest';
import { JOKE_LANGUAGES, pickJoke, jokeLangByKey } from '../src/content/jokes';

// Ranges Unicode por script (iguais aos de laughter.test.ts).
const CYRILLIC = /[Ѐ-ӿ]/;
const ARABIC = /[؀-ۿ]/;
const HAN = /[一-鿿]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const GEORGIAN = /[Ⴀ-ჿ]/;

describe('JOKE_LANGUAGES (lista de linguas suportadas)', () => {
  it('cobre exatamente as 34 linguas distintas dos modelos Piper', () => {
    // Prefixos DISTINTOS de LANG_TO_PREFIX = 34 (no_/Norueguês nao entra: so existe
    // em LOCALE_NAMES, nao em LANG_TO_PREFIX). Este numero e o contrato.
    expect(JOKE_LANGUAGES.length).toBe(34);
  });

  it('cada lingua tem key, prefix (xx_) e display name em INGLES nao-vazios', () => {
    for (const lang of JOKE_LANGUAGES) {
      expect(lang.key.length).toBeGreaterThan(0);
      expect(lang.prefix).toMatch(/^[a-z]{2}_$/);
      expect(lang.display.length).toBeGreaterThan(0);
      // Display names em ingles (ASCII), para o autocomplete filtrar por substring
      // que um utilizador anglofono escreve ("russ", "arab"...).
      expect(lang.display).toMatch(/^[A-Za-z() ]+$/);
    }
  });

  it('as keys sao unicas', () => {
    const keys = JOKE_LANGUAGES.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('os prefixos sao unicos (sem linguas duplicadas)', () => {
    const prefixes = JOKE_LANGUAGES.map((l) => l.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe('pickJoke', () => {
  it('TODA a lingua suportada devolve uma piada nao-vazia', () => {
    for (const lang of JOKE_LANGUAGES) {
      const joke = pickJoke(lang.key, 0);
      expect(joke, `lingua ${lang.key} sem piada`).toBeTruthy();
      expect(joke.trim().length).toBeGreaterThan(0);
    }
  });

  it('e PURO/DETERMINISTICO dado (langKey, seed)', () => {
    for (const lang of JOKE_LANGUAGES) {
      expect(pickJoke(lang.key, 7)).toBe(pickJoke(lang.key, 7));
      expect(pickJoke(lang.key, 42)).toBe(pickJoke(lang.key, 42));
    }
  });

  it('o seed indexa por modulo (seed % n) — deterministico e wrap-around', () => {
    // Para uma lingua com >=1 piada, seed e seed+len apontam para a MESMA piada.
    const en = jokeLangByKey('en');
    expect(en).toBeTruthy();
    // seed grande faz wrap; a igualdade prova o modulo (nao um clamp/overflow).
    const a = pickJoke('en', 3);
    const b = pickJoke('en', 3 + 1_000_000 * jokeCount('en'));
    expect(a).toBe(b);
  });

  it('langKey desconhecida faz fallback ao ingles', () => {
    expect(pickJoke('xx-nao-existe', 0)).toBe(pickJoke('en', 0));
  });

  // Scripts nao-latinos: as piadas TEM de estar no script nativo.
  it('russo (ru) em Cirilico', () => {
    expect(pickJoke('ru', 0)).toMatch(CYRILLIC);
  });
  it('ucraniano (uk) em Cirilico', () => {
    expect(pickJoke('uk', 0)).toMatch(CYRILLIC);
  });
  it('cazaque (kk) em Cirilico', () => {
    expect(pickJoke('kk', 0)).toMatch(CYRILLIC);
  });
  it('servio (sr) em Cirilico', () => {
    expect(pickJoke('sr', 0)).toMatch(CYRILLIC);
  });
  it('arabe (ar) em escrita Arabe', () => {
    expect(pickJoke('ar', 0)).toMatch(ARABIC);
  });
  it('persa (fa) em escrita Arabe', () => {
    expect(pickJoke('fa', 0)).toMatch(ARABIC);
  });
  it('georgiano (ka) em escrita Georgiana', () => {
    expect(pickJoke('ka', 0)).toMatch(GEORGIAN);
  });
  it('nepali (ne) em Devanagari', () => {
    expect(pickJoke('ne', 0)).toMatch(DEVANAGARI);
  });
  it('chines (zh) em Han', () => {
    expect(pickJoke('zh', 0)).toMatch(HAN);
  });
});

// Helper local: numero de piadas de uma lingua (via wrap-around de pickJoke seria
// circular; contamos direto pela lista exportada nao — usamos o length do banco).
function jokeCount(key: string): number {
  // pickJoke com seeds 0..N deve ciclar; determinamos N empiricamente ate repetir.
  const first = pickJoke(key, 0);
  let n = 1;
  while (n < 50 && pickJoke(key, n) !== first) n++;
  return n === 50 ? 1 : n;
}
