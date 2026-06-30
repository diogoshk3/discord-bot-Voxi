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

  // ------------------------------------------------------------------
  // P7.3 — linguas em falta (PT/europeu). Provas de contrato: confirmam
  // que o prefixo 'por' -> 'pt_' cobre tanto pt_PT como pt_BR (ambos
  // comecam por 'pt_'), e que outros europeus resolvem quando ha modelo.
  // ------------------------------------------------------------------

  // (a) Com pt_PT E pt_BR disponiveis, "por" resolve para um modelo pt_
  //     (qualquer um serve — o contrato e "devolve um modelo pt_", nao um
  //     ficheiro especifico; a ordem ja e coberta pelo teste de determinismo).
  it('"por" resolve para um modelo pt_ quando ha pt_PT e pt_BR', () => {
    const models = ['pt_PT-tugao-medium', 'pt_BR-faber-medium', 'en_US-amy-medium'];
    const chosen = pickVoice('por', models, fallback);
    expect(chosen.startsWith('pt_')).toBe(true);
    expect(models).toContain(chosen);
  });

  // (b) So pt_BR disponivel → resolve para pt_BR (prova que 'pt_' apanha BR,
  //     nao apenas PT).
  it('"por" resolve para pt_BR quando so ha pt_BR', () => {
    expect(pickVoice('por', ['pt_BR-faber-medium', 'en_US-amy-medium'], fallback)).toBe(
      'pt_BR-faber-medium',
    );
  });

  // (c) Sem qualquer modelo pt_ → fallback.
  it('"por" cai no fallback quando nao ha nenhum modelo pt_', () => {
    expect(pickVoice('por', ['en_US-amy-medium', 'es_ES-davefx-medium'], fallback)).toBe(fallback);
  });

  // (d) Outros europeus ocidentais resolvem quando ha modelo do locale.
  it('"deu" resolve para de_DE quando ha modelo alemao', () => {
    expect(pickVoice('deu', ['de_DE-thorsten-medium', 'en_US-amy-medium'], fallback)).toBe(
      'de_DE-thorsten-medium',
    );
  });

  it('"spa" resolve para es_ES quando ha modelo espanhol', () => {
    expect(pickVoice('spa', ['es_ES-davefx-medium', 'en_US-amy-medium'], fallback)).toBe(
      'es_ES-davefx-medium',
    );
  });
});
