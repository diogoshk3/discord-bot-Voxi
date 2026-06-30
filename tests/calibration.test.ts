// tests/calibration.test.ts
import { describe, it, expect } from 'vitest';
import { lengthScaleFor, VOICE_CALIBRATION } from '../src/tts/calibration';

describe('lengthScaleFor — calibração de velocidade por-voz', () => {
  it('voz sem calibração: length_scale = 1/speed (comportamento antigo preservado)', () => {
    expect(lengthScaleFor('en_US-amy-medium', 1)).toBe(1);
    expect(lengthScaleFor('en_US-amy-medium', 2)).toBe(0.5);
    expect(lengthScaleFor('en_US-amy-medium', 0.5)).toBe(2);
  });

  it('tugão (pt_PT) tem calibração 1.5 e aplica-a a velocidade normal', () => {
    expect(VOICE_CALIBRATION['pt_PT-tugao-medium']).toBe(1.5);
    expect(lengthScaleFor('pt_PT-tugao-medium', 1)).toBe(1.5);
  });

  it('a calibração compõe-se com a velocidade do utilizador (multiplicativa)', () => {
    expect(lengthScaleFor('pt_PT-tugao-medium', 0.5)).toBe(3);
    expect(lengthScaleFor('pt_PT-tugao-medium', 2)).toBe(0.75);
  });

  it('speed inválido (0 ou negativo) trata como 1', () => {
    expect(lengthScaleFor('en_US-amy-medium', 0)).toBe(1);
    expect(lengthScaleFor('pt_PT-tugao-medium', -3)).toBe(1.5);
  });
});
