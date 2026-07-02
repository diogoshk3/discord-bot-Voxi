import { describe, it, expect } from 'vitest';
import { prepareSpeech } from '../src/commands/prepareSpeech';

// Catalogo: EN + PT + ES (mesmo dos testes de resolveSynth).
const AVAILABLE = ['en_US-amy-medium', 'pt_PT-tugao-medium', 'es_ES-davefx-medium'];

const BASE = {
  pronunciations: [],
  userVoice: null,
  available: AVAILABLE,
  defaultVoice: 'en_US-amy-medium',
  defaultSpeed: 1,
  autoDetect: true,
} as const;

describe('prepareSpeech — texto sem girias (single voice)', () => {
  it('frase PT longa -> req sem `segments`, model pt_', () => {
    const { req } = prepareSpeech({
      ...BASE,
      personal: 'isto e uma frase em portugues bem comprida para deteccao de lingua correta e fiavel',
    });
    expect(req.model.startsWith('pt_')).toBe(true);
    expect(req.segments).toBeUndefined();
    expect(req.singleVoice).toBeUndefined();
  });
});

describe('prepareSpeech — so girias (single voice EN)', () => {
  it('"brb omg" -> req sem `segments`, model en_', () => {
    const { req, spoken } = prepareSpeech({ ...BASE, personal: 'brb omg' });
    expect(req.model.startsWith('en_')).toBe(true);
    expect(req.segments).toBeUndefined();
    // As girias foram expandidas no texto falado.
    expect(spoken).toBe('be right back oh my god');
  });
});

describe('prepareSpeech — MISTURADO (voz por-segmento)', () => {
  it('"isto esta a funcionar muito bem hoje btw" -> segments length 2, base pt_, giria en_', () => {
    const { req, spoken } = prepareSpeech({
      ...BASE,
      personal: 'isto esta a funcionar muito bem hoje btw',
    });
    expect(req.segments).toBeDefined();
    expect(req.segments).toHaveLength(2);
    // 1.o segmento = base PT (frase longa deteta 'por').
    expect(req.segments![0].text).toBe('isto esta a funcionar muito bem hoje');
    expect(req.segments![0].model.startsWith('pt_')).toBe(true);
    // 2.o segmento = giria expandida em voz EN.
    expect(req.segments![1].text).toBe('by the way');
    expect(req.segments![1].model.startsWith('en_')).toBe(true);
    // Voz-base/fallback do req = pt_.
    expect(req.model.startsWith('pt_')).toBe(true);
    expect(req.singleVoice).toBeUndefined();
    expect(spoken).toBe('isto esta a funcionar muito bem hoje by the way');
  });
});

describe('prepareSpeech — autoDetect OFF (voz fixa)', () => {
  it('autoDetect:false -> singleVoice:true, model = preferida, sem segments', () => {
    const { req } = prepareSpeech({
      ...BASE,
      personal: 'isto e uma frase em portugues bem comprida para deteccao de lingua',
      userVoice: { model: 'en_US-amy-medium', speed: 1.3 },
      autoDetect: false,
    });
    expect(req.singleVoice).toBe(true);
    expect(req.model).toBe('en_US-amy-medium');
    expect(req.speed).toBe(1.3);
    expect(req.segments).toBeUndefined();
  });
});
