import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  SOUNDS,
  SOUND_KEYS,
  SOUND_CHOICES,
  soundByKey,
  soundFilename,
} from '../src/content/sounds';

// Diretório dos WAV do soundboard (raiz do repo /assets/sfx). Os testes correm da raiz.
const SFX_DIR = join(__dirname, '..', 'assets', 'sfx');

describe('sounds — registo curado do soundboard', () => {
  it('chaves únicas, kebab-ascii, nome não-vazio', () => {
    const seen = new Set<string>();
    for (const s of SOUNDS) {
      expect(s.key).toMatch(/^[a-z0-9-]+$/); // seguro como nome de ficheiro e value de choice
      expect(s.name.length).toBeGreaterThan(0);
      expect(seen.has(s.key)).toBe(false); // sem duplicados
      seen.add(s.key);
    }
  });

  it('choices dentro do limite do Discord (<=25) e com name+value', () => {
    expect(SOUND_CHOICES.length).toBeLessThanOrEqual(25);
    expect(SOUND_CHOICES.length).toBe(SOUNDS.length);
    for (const c of SOUND_CHOICES) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(SOUND_KEYS).toContain(c.value);
    }
  });

  it('soundByKey encontra o clip e devolve undefined para desconhecido', () => {
    expect(soundByKey(SOUND_KEYS[0])?.key).toBe(SOUND_KEYS[0]);
    expect(soundByKey('nao-existe')).toBeUndefined();
  });

  it('soundFilename é o key + .wav', () => {
    expect(soundFilename('airhorn')).toBe('airhorn.wav');
  });

  // Integridade: cada clip registado TEM de ter o WAV no disco — senão o /sound
  // ofereceria uma choice que só produz silêncio (o player salta assets em falta).
  // Este teste falha se alguém adicionar uma entrada sem o ficheiro (ou vice-versa).
  it('cada clip registado tem o WAV correspondente em assets/sfx/', () => {
    expect(SOUND_KEYS.length).toBeGreaterThan(0);
    for (const key of SOUND_KEYS) {
      expect(existsSync(join(SFX_DIR, soundFilename(key)))).toBe(true);
    }
  });
});
