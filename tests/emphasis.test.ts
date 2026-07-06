import { describe, it, expect } from 'vitest';
import { emphasisGain } from '../src/tts/emphasis';

describe('emphasisGain — "mais alto quando ! ou MAIÚSCULAS"', () => {
  it('texto normal -> sem ganho (1.0)', () => {
    expect(emphasisGain('ola tudo bem contigo')).toBe(1);
    expect(emphasisGain('')).toBe(1);
  });

  it('um "!" -> ganho suave (>1, <forte)', () => {
    const g = emphasisGain('cuidado!');
    expect(g).toBeGreaterThan(1);
    expect(g).toBeLessThan(emphasisGain('cuidado!!'));
  });

  it('uma palavra em MAIÚSCULAS -> ganho suave', () => {
    expect(emphasisGain('PARA quieto')).toBeGreaterThan(1);
  });

  it('"!!" ou mais -> ganho forte', () => {
    expect(emphasisGain('vamos!!')).toBe(emphasisGain('boaaa!!!'));
    expect(emphasisGain('vamos!!')).toBeGreaterThan(emphasisGain('vamos!'));
  });

  it('MAIÚSCULAS + "!" -> ganho forte (combina os dois sinais)', () => {
    expect(emphasisGain('PARA!')).toBe(emphasisGain('vamos!!'));
  });

  it('ganho tem teto (nunca dispara acima do forte, evita clipping)', () => {
    expect(emphasisGain('SOCORRO!!!!!')).toBe(emphasisGain('vamos!!'));
  });

  it('é ESTÁVEL entre chamadas (regex de grito não é global/stateful)', () => {
    // Duas chamadas seguidas com o MESMO input têm de dar o MESMO resultado
    // (guard contra lastIndex partilhado se o regex fosse /g).
    expect(emphasisGain('GRITA')).toBe(emphasisGain('GRITA'));
    expect(emphasisGain('calmo')).toBe(1);
    expect(emphasisGain('GRITA')).toBeGreaterThan(1);
  });

  it('uma única maiúscula (início de frase) NÃO conta como grito', () => {
    expect(emphasisGain('Ola pessoal')).toBe(1);
  });
});
