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
});
