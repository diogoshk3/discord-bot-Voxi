import { describe, it, expect } from 'vitest';
import {
  t,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_DISPLAY_NAMES,
} from '../src/i18n/index';
import { locales } from '../src/i18n/locales/index';

describe('i18n — t(key, locale, params)', () => {
  it('DEFAULT_LOCALE e "en" e "en" e um locale suportado', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('pt');
  });

  it('devolve a string EN por defeito (locale="en")', () => {
    // help.title existe no catalogo com um valor EN conhecido.
    expect(t('help.title', 'en')).toContain('Vozen');
  });

  it('devolve a string PT quando locale="pt"', () => {
    // help.groupStarted tem traducoes distintas EN vs PT.
    const en = t('help.groupStarted', 'en');
    const pt = t('help.groupStarted', 'pt');
    expect(en).toBe('Getting started');
    expect(pt).toBe('Primeiros passos');
  });

  it('faz fallback para EN quando a chave falta no locale pedido', () => {
    // help.title so tem EN (pt parcial); pedir em pt devolve o valor EN.
    expect(t('help.title', 'pt')).toBe(t('help.title', 'en'));
  });

  it('chave inexistente devolve a propria key (nunca crasha)', () => {
    expect(t('nao.existe.esta.chave', 'en')).toBe('nao.existe.esta.chave');
    expect(t('nao.existe.esta.chave', 'pt')).toBe('nao.existe.esta.chave');
  });

  it('interpola parametros {param}', () => {
    // help.recommend usa {command}. Confirmamos que o placeholder e substituido.
    const out = t('help.footer', 'en', { command: '/setup' });
    expect(out).toContain('/setup');
    expect(out).not.toContain('{command}');
  });

  it('locale nao suportado cai no fallback EN', () => {
    expect(t('help.groupStarted', 'xx')).toBe('Getting started');
  });

  // Fase B: 'es' JA tem traducao (locales/es.ts) -> t() serve o espanhol, nao o EN.
  it('locale traduzido (es) serve a traducao, nao o fallback EN', () => {
    expect(t('help.groupStarted', 'es')).not.toBe('Getting started');
    expect(t('help.title', 'es')).not.toBe('');
  });

  // Prova a arquitetura da FASE B: quando existe um ficheiro locales/<code>.ts com a
  // chave, t() serve essa traducao (branch 1 da cadeia). Em Fase A o registry esta
  // vazio, por isso NENHUM outro teste exercita este ramo — sem isto, um bug em
  // `locales[locale]?.[key]` so aparecia em Fase B. Registamos/limpamos in-line.
  it('usa a traducao do registry por-locale quando presente (branch 1)', () => {
    locales['zz'] = { 'help.groupStarted': 'REG-WIN' };
    try {
      expect(t('help.groupStarted', 'zz')).toBe('REG-WIN');
    } finally {
      delete locales['zz'];
    }
  });

  it('o registry por-locale tem precedencia sobre o valor inline do catalogo (pt)', () => {
    // 'help.groupStarted' tem `pt` inline ("Primeiros passos"); um override no
    // registry para pt deve GANHAR a esse inline (branch 1 > branch 2).
    locales['pt'] = { 'help.groupStarted': 'OVERRIDE-PT' };
    try {
      expect(t('help.groupStarted', 'pt')).toBe('OVERRIDE-PT');
    } finally {
      delete locales['pt'];
    }
  });
});

describe('i18n — SUPPORTED_LOCALES + endonimos (35 linguas de voz)', () => {
  const EXPECTED = [
    'en', 'pt', 'es', 'fr', 'de', 'nl', 'pl', 'tr', 'cs', 'sv', 'fi', 'da',
    'ro', 'hu', 'cy', 'is', 'lb', 'lv', 'sk', 'sl', 'sw', 'vi', 'ca', 'it',
    'el', 'ru', 'uk', 'kk', 'sr', 'ar', 'fa', 'ka', 'ne', 'zh', 'ja',
  ];

  it('SUPPORTED_LOCALES tem exatamente as 35 linguas de voz', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(EXPECTED);
    expect(SUPPORTED_LOCALES.length).toBe(35);
  });

  it('LOCALE_DISPLAY_NAMES tem um endonimo (nome na propria lingua) para CADA locale', () => {
    for (const code of EXPECTED) {
      const name = (LOCALE_DISPLAY_NAMES as Record<string, string>)[code];
      expect(name, `falta endonimo para ${code}`).toBeTruthy();
      expect(typeof name).toBe('string');
    }
  });

  it('endonimos-chave estao na PROPRIA lingua (autonimo, nao em ingles)', () => {
    const N = LOCALE_DISPLAY_NAMES as Record<string, string>;
    expect(N.en).toBe('English');
    expect(N.pt).toBe('Português');
    expect(N.de).toBe('Deutsch');
    expect(N.zh).toBe('中文');
    expect(N.ru).toBe('Русский');
    expect(N.ar).toBe('العربية');
    expect(N.el).toBe('Ελληνικά');
    expect(N.uk).toBe('Українська');
  });
});
