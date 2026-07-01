import { describe, it, expect } from 'vitest';
import { t, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../src/i18n/index';

describe('i18n — t(key, locale, params)', () => {
  it('DEFAULT_LOCALE e "en" e "en" e um locale suportado', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('pt');
  });

  it('devolve a string EN por defeito (locale="en")', () => {
    // help.title existe no catalogo com um valor EN conhecido.
    expect(t('help.title', 'en')).toContain('Voxi');
  });

  it('devolve a string PT quando locale="pt"', () => {
    // help.groupGeneral tem traducoes distintas EN vs PT.
    const en = t('help.groupGeneral', 'en');
    const pt = t('help.groupGeneral', 'pt');
    expect(en).toBe('General');
    expect(pt).toBe('Geral');
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
    expect(t('help.groupGeneral', 'xx')).toBe('General');
  });
});
