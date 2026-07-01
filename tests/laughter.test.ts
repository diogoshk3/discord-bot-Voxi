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

// Todos os prefixos suportados (para provar o mínimo de sílabas em TODAS as línguas).
const ALL_PREFIXES = [
  'en_', 'pt_', 'fr_', 'de_', 'nl_', 'pl_', 'tr_', 'cs_', 'sv_', 'fi_', 'da_',
  'ro_', 'hu_', 'cy_', 'is_', 'lb_', 'lv_', 'sk_', 'sl_', 'sw_', 'vi_', 'es_',
  'ca_', 'it_', 'el_', 'ru_', 'uk_', 'kk_', 'sr_', 'ar_', 'fa_', 'ka_', 'ne_', 'zh_',
];

describe('laughterFor', () => {
  it('devolve um riso longo (>=5 sílabas espaçadas) para inglês', () => {
    expect(laughterFor('en_')).toBe('ha ha ha ha ha ha');
  });

  it('português usa "rá" (o \'h\' é mudo em PT) com riso longo', () => {
    // 'h' mudo no phonemizer PT -> "ha" quase não soa; "rá" é vocalizado.
    expect(laughterFor('pt_')).toBe('rá rá rá rá rá rá rá rá rá');
  });

  it('fallback (riso longo) para prefixo desconhecido', () => {
    expect(laughterFor('xx_')).toBe('ha ha ha ha ha ha');
  });

  it('fallback (riso longo) para prefixo vazio (modelo sem "_")', () => {
    expect(laughterFor('')).toBe('ha ha ha ha ha ha');
  });

  // Requisito do Diogo: o riso tem de ter pelo menos ~5 "ha" (>= ~1.5s no TTS).
  it('TODAS as línguas riem com pelo menos 5 sílabas', () => {
    for (const p of ALL_PREFIXES) {
      const units = laughterFor(p).split(' ').filter(Boolean);
      expect(units.length, `riso de ${p}`).toBeGreaterThanOrEqual(5);
    }
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
