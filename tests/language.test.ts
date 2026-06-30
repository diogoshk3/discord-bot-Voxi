import { describe, it, expect } from 'vitest';
import { detectLang } from '../src/language/detect';
import { pickVoice } from '../src/language/voiceMap';

describe('detectLang', () => {
  it('deteta portugues numa frase longa', () => {
    const lang = detectLang(
      'Ola a todos, hoje vamos falar sobre o tempo que esta a fazer aqui na nossa cidade durante esta semana.'
    );
    expect(lang).toBe('por');
  });

  it('deteta ingles numa frase longa', () => {
    const lang = detectLang(
      'Hello everyone, today we are going to talk about the weather we are having here in our city during this week.'
    );
    expect(lang).toBe('eng');
  });

  it('devolve "" para texto vazio', () => {
    expect(detectLang('')).toBe('');
  });

  it('devolve "" para texto so com espacos', () => {
    expect(detectLang('   ')).toBe('');
  });

  it('devolve "" ou um codigo para texto muito curto (nunca rebenta)', () => {
    const lang = detectLang('oi');
    expect(typeof lang).toBe('string');
  });
});

describe('pickVoice', () => {
  const available = ['pt_PT-tugao-medium', 'en_US-amy-medium', 'es_ES-davefx-medium'];
  const fallback = 'en_US-amy-medium';

  it('escolhe voz portuguesa para "por"', () => {
    expect(pickVoice('por', available, fallback)).toBe('pt_PT-tugao-medium');
  });

  it('escolhe voz inglesa para "eng"', () => {
    expect(pickVoice('eng', available, fallback)).toBe('en_US-amy-medium');
  });

  it('escolhe voz espanhola para "spa"', () => {
    expect(pickVoice('spa', available, fallback)).toBe('es_ES-davefx-medium');
  });

  it('cai no fallback quando a lingua nao tem modelo', () => {
    expect(pickVoice('deu', available, fallback)).toBe(fallback);
  });

  it('cai no fallback quando lang e ""', () => {
    expect(pickVoice('', available, fallback)).toBe(fallback);
  });

  it('cai no fallback quando lang e desconhecida no mapa', () => {
    expect(pickVoice('xyz', available, fallback)).toBe(fallback);
  });

  // Linguas novas (P3.3)
  it('escolhe voz polaca para "pol"', () => {
    expect(pickVoice('pol', ['pl_PL-mls-medium'], fallback)).toBe('pl_PL-mls-medium');
  });

  it('escolhe voz ucraniana para "ukr"', () => {
    expect(pickVoice('ukr', ['uk_UA-lada-x_low'], fallback)).toBe('uk_UA-lada-x_low');
  });

  it('escolhe voz turca para "tur"', () => {
    expect(pickVoice('tur', ['tr_TR-dfki-medium'], fallback)).toBe('tr_TR-dfki-medium');
  });

  it('escolhe voz checa para "ces"', () => {
    expect(pickVoice('ces', ['cs_CZ-jirka-medium'], fallback)).toBe('cs_CZ-jirka-medium');
  });

  it('escolhe voz catalã para "cat"', () => {
    expect(pickVoice('cat', ['ca_ES-upc_ona-x_low'], fallback)).toBe('ca_ES-upc_ona-x_low');
  });

  it('escolhe voz sueca para "swe"', () => {
    expect(pickVoice('swe', ['sv_SE-nst-medium'], fallback)).toBe('sv_SE-nst-medium');
  });

  it('escolhe voz finlandesa para "fin"', () => {
    expect(pickVoice('fin', ['fi_FI-harri-medium'], fallback)).toBe('fi_FI-harri-medium');
  });

  it('escolhe voz dinamarquesa para "dan"', () => {
    expect(pickVoice('dan', ['da_DK-talesyntese-medium'], fallback)).toBe('da_DK-talesyntese-medium');
  });

  it('escolhe voz romena para "ron"', () => {
    expect(pickVoice('ron', ['ro_RO-mihai-medium'], fallback)).toBe('ro_RO-mihai-medium');
  });

  it('escolhe voz grega para "ell"', () => {
    expect(pickVoice('ell', ['el_GR-rapunzelina-low'], fallback)).toBe('el_GR-rapunzelina-low');
  });

  it('escolhe voz hungara para "hun"', () => {
    expect(pickVoice('hun', ['hu_HU-anna-medium'], fallback)).toBe('hu_HU-anna-medium');
  });

  // Fallback: lingua mapeada mas sem modelo disponivel
  it('cai no fallback quando lingua tem prefixo mas nenhum modelo corresponde', () => {
    expect(pickVoice('pol', ['pt_PT-tugao-medium', 'en_US-amy-medium'], fallback)).toBe(fallback);
  });

  // Determinismo: multiplos modelos com o mesmo prefixo → escolhe o primeiro por ordem
  it('com multiplos modelos do mesmo prefixo escolhe o primeiro por ordem', () => {
    expect(pickVoice('eng', ['en_GB-alan-low', 'en_US-amy-medium'], fallback)).toBe('en_GB-alan-low');
  });
});
