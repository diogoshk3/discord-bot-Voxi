import { describe, it, expect } from 'vitest';
import { resolveSynth } from '../src/commands/resolveSynth';

describe('resolveSynth', () => {
  const available = ['en_US-amy', 'pt_PT-tugao', 'es_ES-davefx'];

  it('usa a voz guardada do user quando existe (prioridade)', () => {
    const r = resolveSynth({
      text: 'hello world this is a test of language detection',
      userVoice: { model: 'pt_PT-tugao', speed: 1.3 },
      available,
      defaultVoice: 'en_US-amy',
      defaultSpeed: 1.0,
    });
    expect(r).toEqual({ text: 'hello world this is a test of language detection', model: 'pt_PT-tugao', speed: 1.3 });
  });

  it('sem voz do user, deteta lingua e escolhe voz', () => {
    const r = resolveSynth({
      text: 'isto e uma frase em portugues para deteccao de lingua correta',
      userVoice: null,
      available,
      defaultVoice: 'en_US-amy',
      defaultSpeed: 1.0,
    });
    expect(r.speed).toBe(1.0);
    expect(available).toContain(r.model);
  });

  it('cai no fallback quando a lingua e desconhecida', () => {
    const r = resolveSynth({
      text: '',
      userVoice: null,
      available,
      defaultVoice: 'en_US-amy',
      defaultSpeed: 1.0,
    });
    expect(r.model).toBe('en_US-amy');
    expect(r.speed).toBe(1.0);
  });

  describe('precedencia de voz default (sem voz de user, lingua desconhecida)', () => {
    // Texto vazio => detectLang nao mapeia => usa-se o fallback derivado da
    // precedencia (guildDefaultVoice || defaultVoice || 'en_US-amy-medium').
    it('voz do user vence sempre, mesmo com guild default definido', () => {
      const r = resolveSynth({
        text: '',
        userVoice: { model: 'es_ES-davefx', speed: 0.9 },
        available,
        guildDefaultVoice: 'pt_PT-tugao',
        defaultVoice: 'en_US-amy',
        defaultSpeed: 1.0,
      });
      expect(r).toEqual({ text: '', model: 'es_ES-davefx', speed: 0.9 });
    });

    it('sem voz de user mas guild default definido => usa guild default', () => {
      const r = resolveSynth({
        text: '',
        userVoice: null,
        available,
        guildDefaultVoice: 'pt_PT-tugao',
        defaultVoice: 'en_US-amy',
        defaultSpeed: 1.0,
      });
      expect(r.model).toBe('pt_PT-tugao'); // guild default vence o .env
    });

    it('guild default vazio => cai no .env defaultVoice', () => {
      const r = resolveSynth({
        text: '',
        userVoice: null,
        available,
        guildDefaultVoice: '',
        defaultVoice: 'en_US-amy',
        defaultSpeed: 1.0,
      });
      expect(r.model).toBe('en_US-amy'); // .env continua a funcionar como fallback
    });

    it('guild default ausente (undefined) => cai no .env defaultVoice', () => {
      const r = resolveSynth({
        text: '',
        userVoice: null,
        available,
        defaultVoice: 'en_US-amy',
        defaultSpeed: 1.0,
      });
      expect(r.model).toBe('en_US-amy');
    });

    it('sem guild default e sem .env => fallback final en_US-amy-medium', () => {
      const r = resolveSynth({
        text: '',
        userVoice: null,
        available,
        guildDefaultVoice: '',
        defaultVoice: '',
        defaultSpeed: 1.0,
      });
      expect(r.model).toBe('en_US-amy-medium');
    });
  });
});
