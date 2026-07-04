import { describe, it, expect, vi } from 'vitest';
import { PerUserEngineRouter } from '../src/tts/perUserRouter';
import { cacheKey } from '../src/tts/cache';
import type { SynthRequest, TTSEngine } from '../src/tts/engine';

function fake(name: string): TTSEngine {
  return { synth: vi.fn(async () => `/wav/${name}.wav`) };
}
const req = (engine?: 'google' | 'piper'): SynthRequest => ({
  text: 'olá',
  model: 'pt_BR-cadu-medium',
  speed: 1,
  engine,
});

describe('PerUserEngineRouter — despacha por req.engine', () => {
  it("engine='piper' -> Piper", async () => {
    const g = fake('gtts');
    const p = fake('piper');
    const r = new PerUserEngineRouter(g, p);
    expect(await r.synth(req('piper'))).toBe('/wav/piper.wav');
    expect(p.synth).toHaveBeenCalledTimes(1);
    expect(g.synth).not.toHaveBeenCalled();
  });

  it("engine='google' -> gTTS", async () => {
    const g = fake('gtts');
    const p = fake('piper');
    const r = new PerUserEngineRouter(g, p);
    expect(await r.synth(req('google'))).toBe('/wav/gtts.wav');
    expect(g.synth).toHaveBeenCalledTimes(1);
  });

  it('engine ausente -> gTTS (default)', async () => {
    const g = fake('gtts');
    const p = fake('piper');
    const r = new PerUserEngineRouter(g, p);
    expect(await r.synth(req(undefined))).toBe('/wav/gtts.wav');
    expect(g.synth).toHaveBeenCalledTimes(1);
    expect(p.synth).not.toHaveBeenCalled();
  });
});

describe('cacheKey — separa motores sem invalidar a cache existente', () => {
  it('google e undefined dão a MESMA chave (cache antiga intacta)', () => {
    expect(cacheKey(req('google'))).toBe(cacheKey(req(undefined)));
  });

  it('piper dá chave DIFERENTE (não cruza áudio entre motores)', () => {
    expect(cacheKey(req('piper'))).not.toBe(cacheKey(req('google')));
  });
});
