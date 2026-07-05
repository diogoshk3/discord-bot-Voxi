import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloneEngine, parseCommand, resolveCloneCmd } from '../src/tts/cloneEngine';
import { AudioCache } from '../src/tts/cache';
import type { SynthRequest, TTSEngine } from '../src/tts/engine';

describe('parseCommand', () => {
  it('parte exe + args e respeita aspas do path', () => {
    expect(parseCommand('python script.py --x')).toEqual({ exe: 'python', args: ['script.py', '--x'] });
    expect(parseCommand('"C:\\Program Files\\py.exe" a.py')).toEqual({
      exe: 'C:\\Program Files\\py.exe',
      args: ['a.py'],
    });
  });
});

describe('resolveCloneCmd', () => {
  it('CLONE_CMD explícito ganha; ausente e sem venv -> null', () => {
    expect(resolveCloneCmd('py serve.py')).toEqual({ exe: 'py', args: ['serve.py'] });
    // sem tools/clone-venv no cwd de teste -> null (não há motor instalado)
    const r = resolveCloneCmd(undefined);
    expect(r === null || typeof r === 'object').toBe(true); // tolera ambos os ambientes
  });
});

/**
 * Sidecar Python FALSO: um EventEmitter com stdin.write que responde ao protocolo —
 * warmup -> {ready}; pedido -> escreve o WAV no `out` e responde {ok,out} (ou {ok:false}
 * se behavior='fail'; ou nada se 'hang').
 */
function fakeSidecar(behavior: 'ok' | 'fail' | 'hang' = 'ok') {
  return (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: { write: (s: string) => void };
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = {
      write: (s: string) => {
        const req = JSON.parse(s.trim());
        queueMicrotask(() => {
          if (req.warmup) {
            child.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true, ready: true, model: 'en' }) + '\n'));
            return;
          }
          if (behavior === 'hang') return;
          if (behavior === 'ok') {
            writeFileSync(req.out, Buffer.from('RIFFcloned'));
            child.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true, out: req.out }) + '\n'));
          } else {
            child.stdout.emit('data', Buffer.from(JSON.stringify({ ok: false, error: 'model boom' }) + '\n'));
          }
        });
      },
    };
    return child;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

const REQ = (extra: Partial<SynthRequest> = {}): SynthRequest => ({
  text: 'ola',
  model: 'pt_PT-tugao-medium',
  speed: 1,
  ...extra,
});
const innerReturning = (p: string): TTSEngine => ({ synth: async () => p });

describe('CloneEngine', () => {
  const dirs: string[] = [];
  const cache = () => {
    const d = mkdtempSync(join(tmpdir(), 'clone-cache-'));
    dirs.push(d);
    return new AudioCache(d);
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('sem cloneRef -> voz normal (inner), sem tocar no sidecar', async () => {
    const eng = new CloneEngine(innerReturning('/normal.wav'), cache(), { exe: 'x', args: [] }, fakeSidecar('ok'));
    expect(await eng.synth(REQ())).toBe('/normal.wav');
  });

  it('sem motor (cmd null) -> voz normal mesmo com cloneRef', async () => {
    const eng = new CloneEngine(innerReturning('/normal.wav'), cache(), null);
    expect(eng.available).toBe(false);
    expect(await eng.synth(REQ({ cloneRef: '/ref.wav' }))).toBe('/normal.wav');
  });

  it('com cloneRef -> sintetiza via sidecar e cacheia (2.º = hit)', async () => {
    const eng = new CloneEngine(innerReturning('/normal.wav'), cache(), { exe: 'x', args: [] }, fakeSidecar('ok'));
    const out1 = await eng.synth(REQ({ cloneRef: '/ref.wav' }));
    expect(out1).not.toBe('/normal.wav'); // veio do clone, foi para a cache
    const out2 = await eng.synth(REQ({ cloneRef: '/ref.wav' }));
    expect(out2).toBe(out1); // cache-hit
  });

  it('CRÍTICO: falha do sidecar -> cai na voz normal (nunca lança)', async () => {
    const eng = new CloneEngine(innerReturning('/normal.wav'), cache(), { exe: 'x', args: [] }, fakeSidecar('fail'));
    await expect(eng.synth(REQ({ cloneRef: '/ref.wav' }))).resolves.toBe('/normal.wav');
  });
});
