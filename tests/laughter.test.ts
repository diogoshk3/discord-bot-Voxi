import { describe, it, expect } from 'vitest';
import { laughterFor } from '../src/content/laughter';

// Ranges Unicode por script — usados para PROVAR que o riso sai no script CORRETO
// (nao transliterado). Um "хахаха" transliterado para "hahaha" passaria despercebido
// numa igualdade de string; a asserção de range apanha exatamente isso.
const CYRILLIC = /[Ѐ-ӿ]/;
const ARABIC = /[؀-ۿ]/;
const HAN = /[一-鿿]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const GEORGIAN = /[Ⴀ-ჿ]/;

describe('laughterFor', () => {
  it('devolve "hahaha" para inglês', () => {
    expect(laughterFor('en_')).toBe('hahaha');
  });

  it('devolve "hahaha" para português', () => {
    expect(laughterFor('pt_')).toBe('hahaha');
  });

  it('fallback "hahaha" para prefixo desconhecido', () => {
    expect(laughterFor('xx_')).toBe('hahaha');
  });

  it('fallback "hahaha" para prefixo vazio (modelo sem "_")', () => {
    expect(laughterFor('')).toBe('hahaha');
  });

  it('é puro/determinístico (mesma entrada -> mesma saída)', () => {
    expect(laughterFor('ru_')).toBe(laughterFor('ru_'));
    expect(laughterFor('ar_')).toBe(laughterFor('ar_'));
  });

  // Non-Latin: o riso TEM de estar no script nativo, nunca transliterado.
  it('russo (ru_) sai em Cirílico', () => {
    expect(laughterFor('ru_')).toMatch(CYRILLIC);
  });

  it('ucraniano (uk_) sai em Cirílico', () => {
    expect(laughterFor('uk_')).toMatch(CYRILLIC);
  });

  it('cazaque (kk_) sai em Cirílico', () => {
    expect(laughterFor('kk_')).toMatch(CYRILLIC);
  });

  it('sérvio (sr_) sai em Cirílico', () => {
    expect(laughterFor('sr_')).toMatch(CYRILLIC);
  });

  it('árabe (ar_) sai em escrita Árabe', () => {
    expect(laughterFor('ar_')).toMatch(ARABIC);
  });

  it('persa (fa_) sai em escrita Árabe', () => {
    expect(laughterFor('fa_')).toMatch(ARABIC);
  });

  it('georgiano (ka_) sai em escrita Georgiana', () => {
    expect(laughterFor('ka_')).toMatch(GEORGIAN);
  });

  it('nepali (ne_) sai em Devanagari', () => {
    expect(laughterFor('ne_')).toMatch(DEVANAGARI);
  });

  it('chinês (zh_) sai em Han', () => {
    expect(laughterFor('zh_')).toMatch(HAN);
  });
});
