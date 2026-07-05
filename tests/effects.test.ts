import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FREE_EFFECTS,
  VOICE_EFFECTS,
  isVoiceEffect,
  isPremiumEffect,
  ffmpegFilterFor,
  EFFECT_CHOICES,
  applyEffect,
  EffectEngine,
} from '../src/tts/effects';
import { AudioCache } from '../src/tts/cache';
import type { SynthRequest, TTSEngine } from '../src/tts/engine';

describe('effects — metadados', () => {
  it('none/robot/echo são grátis; os restantes premium', () => {
    expect(isPremiumEffect('none')).toBe(false);
    expect(isPremiumEffect('robot')).toBe(false);
    expect(isPremiumEffect('echo')).toBe(false);
    expect(isPremiumEffect('deep')).toBe(true);
    expect(isPremiumEffect('demon')).toBe(true);
    expect(FREE_EFFECTS).toContain('robot');
  });

  it('isVoiceEffect valida', () => {
    expect(isVoiceEffect('robot')).toBe(true);
    expect(isVoiceEffect('banana')).toBe(false);
  });

  it("ffmpegFilterFor: 'none'/desconhecido -> null; efeito real -> filtro", () => {
    expect(ffmpegFilterFor('none')).toBeNull();
    expect(ffmpegFilterFor('banana')).toBeNull();
    expect(ffmpegFilterFor('robot')).toContain('tremolo');
    expect(ffmpegFilterFor('deep')).toContain('asetrate');
  });

  it('choices: premium levam 💎, uma por efeito', () => {
    expect(EFFECT_CHOICES).toHaveLength(VOICE_EFFECTS.length);
    for (const c of EFFECT_CHOICES) {
      expect(VOICE_EFFECTS).toContain(c.value);
      if (isPremiumEffect(c.value)) expect(c.name.startsWith('💎')).toBe(true);
    }
  });
});

// Fake do `spawn` do ffmpeg: 'ok' escreve o out.wav e sai 0; 'fail' sai 1; 'error' emite erro.
function fakeFfmpeg(behavior: 'ok' | 'fail' | 'error') {
  return ((_ff: string, args: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (behavior === 'error') {
        child.emit('error', new Error('ENOENT'));
        return;
      }
      if (behavior === 'ok') {
        const outPath = args[args.length - 2]; // [..., outPath, '-y']
        writeFileSync(outPath, Buffer.from('RIFFfake-wav'));
        child.emit('close', 0);
      } else {
        child.stderr.emit('data', Buffer.from('bad filter'));
        child.emit('close', 1);
      }
    });
    return child;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

describe('applyEffect — passo ffmpeg (spawn injetado)', () => {
  let base: string;
  afterEach(() => {
    if (base && existsSync(base)) rmSync(base, { force: true });
  });

  it('sucesso (code 0) -> resolve com um caminho de WAV existente', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fx-base-'));
    base = join(dir, 'base.wav');
    writeFileSync(base, Buffer.from('RIFFbase'));
    const out = await applyEffect(base, 'aecho=0.8:0.9:500:0.4', {
      ffmpegPath: '/fake/ffmpeg',
      spawnImpl: fakeFfmpeg('ok'),
    });
    expect(existsSync(out)).toBe(true);
    rmSync(join(out, '..'), { recursive: true, force: true });
  });

  it('falha (code 1) -> rejeita', async () => {
    await expect(
      applyEffect('/x/base.wav', 'badfilter', { ffmpegPath: '/fake/ffmpeg', spawnImpl: fakeFfmpeg('fail') }),
    ).rejects.toThrow(/saiu com 1/);
  });

  it('erro a arrancar o ffmpeg -> rejeita', async () => {
    await expect(
      applyEffect('/x/base.wav', 'aecho', { ffmpegPath: '/fake/ffmpeg', spawnImpl: fakeFfmpeg('error') }),
    ).rejects.toThrow(/falha ao iniciar/);
  });
});

const REQ: SynthRequest = { text: 'ola', model: 'en_US-amy-medium', speed: 1 };
const innerReturning = (p: string): TTSEngine => ({ synth: async () => p });

describe('EffectEngine — decorador', () => {
  const dirs: string[] = [];
  const cache = () => {
    const d = mkdtempSync(join(tmpdir(), 'fx-cache-'));
    dirs.push(d);
    return new AudioCache(d);
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("efeito 'none'/ausente -> devolve o WAV base tal e qual (não chama ffmpeg)", async () => {
    const eng = new EffectEngine(innerReturning('/base.wav'), cache(), { spawnImpl: fakeFfmpeg('fail') });
    expect(await eng.synth({ ...REQ })).toBe('/base.wav');
    expect(await eng.synth({ ...REQ, effect: 'none' })).toBe('/base.wav');
  });

  it('CRÍTICO: falha do ffmpeg -> cai na VOZ LIMPA (nunca lança)', async () => {
    const eng = new EffectEngine(innerReturning('/base.wav'), cache(), {
      ffmpegPath: '/fake/ffmpeg',
      spawnImpl: fakeFfmpeg('fail'),
    });
    // robot é um efeito real; o ffmpeg falso "falha" -> deve devolver o base, sem throw.
    await expect(eng.synth({ ...REQ, effect: 'robot' })).resolves.toBe('/base.wav');
  });

  it('sucesso -> devolve um caminho na cache fx (e faz cache-hit no 2.º)', async () => {
    // O base tem de existir para o applyEffect o receber; o fake ignora-o mas o EffectEngine
    // passa-o. O fake escreve o out.wav -> cache.put copia-o.
    const bdir = mkdtempSync(join(tmpdir(), 'fx-b-'));
    dirs.push(bdir);
    const basePath = join(bdir, 'base.wav');
    writeFileSync(basePath, Buffer.from('RIFFb'));
    const eng = new EffectEngine(innerReturning(basePath), cache(), {
      ffmpegPath: '/fake/ffmpeg',
      spawnImpl: fakeFfmpeg('ok'),
    });
    const out1 = await eng.synth({ ...REQ, effect: 'echo' });
    expect(out1).not.toBe(basePath);
    expect(existsSync(out1)).toBe(true);
    // 2.ª chamada idêntica -> cache-hit (mesmo caminho).
    const out2 = await eng.synth({ ...REQ, effect: 'echo' });
    expect(out2).toBe(out1);
  });
});
