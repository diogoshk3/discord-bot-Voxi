import { describe, it, expect } from 'vitest';
import { lookupShortLang } from '../src/language/greetings';
import { detectLang } from '../src/language/detect';

describe('lookupShortLang — lexico de saudacoes/palavras curtas', () => {
  it('token PT unico (com e sem acento) -> por', () => {
    expect(lookupShortLang('ola')).toBe('por');
    expect(lookupShortLang('olá')).toBe('por');
    expect(lookupShortLang('oi')).toBe('por');
    expect(lookupShortLang('obrigado')).toBe('por');
    expect(lookupShortLang('sim')).toBe('por');
    expect(lookupShortLang('não')).toBe('por');
    expect(lookupShortLang('nao')).toBe('por');
  });

  it('normaliza pontuacao e maiusculas antes de procurar', () => {
    expect(lookupShortLang('Olá!')).toBe('por');
    expect(lookupShortLang('  OLA  ')).toBe('por');
    expect(lookupShortLang('oi???')).toBe('por');
  });

  it('frase inteira conhecida -> lingua da frase', () => {
    expect(lookupShortLang('bom dia')).toBe('por');
    expect(lookupShortLang('boa noite')).toBe('por');
    expect(lookupShortLang('olá, tudo bem?')).toBe('por');
    expect(lookupShortLang('hola que tal')).toBe('spa');
  });

  it('frase curta iniciada por saudacao -> lingua da saudacao (franc erraria)', () => {
    expect(lookupShortLang('ola tudo bem')).toBe('por'); // franc dava 'tpi'
    expect(lookupShortLang('ciao come stai')).toBe('ita'); // franc dava 'por'
    expect(lookupShortLang('bonjour ca va')).toBe('fra'); // franc dava 'uzn'
    expect(lookupShortLang('hello there my friend')).toBe('eng'); // franc dava 'sco'
  });

  it('outras linguas com voz Piper', () => {
    expect(lookupShortLang('hola')).toBe('spa');
    expect(lookupShortLang('gracias')).toBe('spa');
    expect(lookupShortLang('merci')).toBe('fra');
    expect(lookupShortLang('bonjour')).toBe('fra');
    expect(lookupShortLang('danke')).toBe('deu');
    expect(lookupShortLang('hallo')).toBe('deu');
    expect(lookupShortLang('ciao')).toBe('ita');
    expect(lookupShortLang('grazie')).toBe('ita');
    expect(lookupShortLang('hi')).toBe('eng');
    expect(lookupShortLang('thanks')).toBe('eng');
  });

  it('nao reconhecido -> "" (deixa passar ao franc)', () => {
    expect(lookupShortLang('')).toBe('');
    expect(lookupShortLang('   ')).toBe('');
    expect(lookupShortLang('xyzzy')).toBe('');
    // frase longa nao-saudacao: cai no franc (nao no lexico).
    expect(lookupShortLang('isto e uma frase comprida sobre o tempo de hoje')).toBe('');
  });

  it('tokens ambiguos entre linguas NAO estao no lexico (evita falsos positivos)', () => {
    // "ok", "no", "si", "ja" sao usados em varias linguas -> deixados de fora.
    for (const t of ['ok', 'no', 'si', 'ja', 'a', 'o']) {
      expect(lookupShortLang(t)).toBe('');
    }
  });

  it('frase longa iniciada por saudacao (> 4 palavras) NAO dispara a regra inicial', () => {
    // Texto comprido decide-se pelo franc, nao pela 1.ª palavra.
    expect(lookupShortLang('hi everyone i need some help with the server config please')).toBe('');
  });
});

describe('detectLang — integra o lexico antes do franc', () => {
  it('o caso do dono: "ola" -> por (nao "" -> voz inglesa)', () => {
    expect(detectLang('ola')).toBe('por');
    expect(detectLang('olá')).toBe('por');
  });

  it('mantem a deteccao franc para frases longas', () => {
    expect(
      detectLang(
        'Ola a todos, hoje vamos falar sobre o tempo que esta a fazer aqui na nossa cidade durante esta semana.',
      ),
    ).toBe('por');
    expect(
      detectLang(
        'Hello everyone, today we are going to talk about the weather we are having here in our city during this week.',
      ),
    ).toBe('eng');
  });

  it('texto vazio/so espacos -> "" (inalterado)', () => {
    expect(detectLang('')).toBe('');
    expect(detectLang('   ')).toBe('');
  });
});
