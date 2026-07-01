// tests/calibration.test.ts
import { describe, it, expect } from 'vitest';
import {
  lengthScaleFor,
  VOICE_CALIBRATION,
  VOICE_PARAM_OVERRIDES,
  synthParamsFor,
  type SynthParams,
} from '../src/tts/calibration';

describe('lengthScaleFor — calibração de velocidade por-voz (preset ORGÂNICO ×1.10)', () => {
  it('voz sem calibração: length_scale = 1.10/speed (fator orgânico global aplicado)', () => {
    // Preset orgânico: fala menos apressada => ×1.10 por cima da calibração (1).
    expect(lengthScaleFor('en_US-amy-medium', 1)).toBeCloseTo(1.1);
    expect(lengthScaleFor('en_US-amy-medium', 2)).toBeCloseTo(0.55);
    expect(lengthScaleFor('en_US-amy-medium', 0.5)).toBeCloseTo(2.2);
  });

  it('tugão (pt_PT) mantém calibração 1.5 mas resolve a 1.65 efetivo (×1.10 orgânico)', () => {
    // A VOICE_CALIBRATION NÃO muda (continua 1.5); o ×1.10 orgânico compõe-se por cima.
    expect(VOICE_CALIBRATION['pt_PT-tugao-medium']).toBe(1.5);
    expect(lengthScaleFor('pt_PT-tugao-medium', 1)).toBeCloseTo(1.65);
  });

  it('a calibração compõe-se com a velocidade do utilizador (multiplicativa) e o ×1.10', () => {
    // 1.5 × 1.10 / 0.5 = 3.3 ; 1.5 × 1.10 / 2 = 0.825
    expect(lengthScaleFor('pt_PT-tugao-medium', 0.5)).toBeCloseTo(3.3);
    expect(lengthScaleFor('pt_PT-tugao-medium', 2)).toBeCloseTo(0.825);
  });

  it('speed inválido (0 ou negativo) trata como 1', () => {
    expect(lengthScaleFor('en_US-amy-medium', 0)).toBeCloseTo(1.1);
    expect(lengthScaleFor('pt_PT-tugao-medium', -3)).toBeCloseTo(1.65);
  });
});

describe('synthParamsFor — merge de params de qualidade (global + override por-voz)', () => {
  const globals: SynthParams = { noiseScale: 0.667, noiseW: 0.8, sentenceSilence: 0.2 };

  it('VOICE_PARAM_OVERRIDES está VAZIO por defeito (nenhuma voz muda hoje)', () => {
    expect(Object.keys(VOICE_PARAM_OVERRIDES)).toHaveLength(0);
  });

  it('sem override: devolve os globais tal e qual (sem regressão audível)', () => {
    expect(synthParamsFor('en_US-amy-medium', globals)).toEqual(globals);
    expect(synthParamsFor('pt_PT-tugao-medium', globals)).toEqual(globals);
  });

  it('override por-voz ganha ao global; campos não-override caem no global', () => {
    // Injeta um override throwaway só para este teste e limpa a seguir.
    VOICE_PARAM_OVERRIDES['zz_fake-voice'] = { noiseScale: 0.3 };
    try {
      const resolved = synthParamsFor('zz_fake-voice', globals);
      expect(resolved.noiseScale).toBe(0.3); // override ganha
      expect(resolved.noiseW).toBe(0.8); // sem override -> global
      expect(resolved.sentenceSilence).toBe(0.2); // sem override -> global
    } finally {
      delete VOICE_PARAM_OVERRIDES['zz_fake-voice'];
    }
  });

  it('não muta o objeto de globais passado (devolve uma cópia)', () => {
    const snapshot = { ...globals };
    VOICE_PARAM_OVERRIDES['zz_fake-voice'] = { noiseW: 1.1 };
    try {
      synthParamsFor('zz_fake-voice', globals);
      expect(globals).toEqual(snapshot);
    } finally {
      delete VOICE_PARAM_OVERRIDES['zz_fake-voice'];
    }
  });
});
