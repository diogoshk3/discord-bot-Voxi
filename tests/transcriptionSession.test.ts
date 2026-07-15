import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  TranscriptionSession,
  type TranscriptionSessionDeps,
} from '../src/voice/transcriptionSession';

// Testa a ORQUESTRAÇÃO da sessão (gate de consentimento + utterance -> transcrição -> post),
// injetando o `capture` (o plumbing Opus real fica na impl default, como no recorder). Um
// `capture` falso emite utterances e resolve quando o locutor pára de falar.

function makeDeps(over: Partial<TranscriptionSessionDeps> = {}) {
  const posts: string[] = [];
  const captured: string[] = [];
  const deps = {
    hasConsent: (u: string) => u === 'yes',
    displayName: (u: string) => (u === 'yes' ? 'Rita' : u),
    transcribe: vi.fn(async (_wav: string) => ({ text: 'good game', lang: 'en' })),
    post: vi.fn(async (t: string) => {
      posts.push(t);
    }),
    toWav: vi.fn(async (_pcm: Buffer, out: string) => out),
    capture: vi.fn(async (userId: string, onUtterance: (pcm: Buffer) => void) => {
      captured.push(userId);
      onUtterance(Buffer.from('pcm'));
    }),
    ...over,
  };
  return { deps, posts, captured };
}

describe('TranscriptionSession', () => {
  it('locutor CONSENTIDO: capta, transcreve e posta "**Nome:** texto"', async () => {
    const { deps, posts } = makeDeps();
    const s = new TranscriptionSession(deps as unknown as TranscriptionSessionDeps);
    await s.onSpeakingStart('yes');
    expect(posts).toEqual(['**Rita:** good game']);
    expect(deps.transcribe).toHaveBeenCalledOnce();
  });

  it('locutor SEM consentimento: nunca é captado (gate consent-first)', async () => {
    const { deps, captured, posts } = makeDeps();
    const s = new TranscriptionSession(deps as unknown as TranscriptionSessionDeps);
    await s.onSpeakingStart('no');
    expect(captured).toEqual([]);
    expect(posts).toEqual([]);
    expect(deps.transcribe).not.toHaveBeenCalled();
  });

  it('não capta o mesmo locutor duas vezes em simultâneo', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const { deps } = makeDeps({
      capture: vi.fn(async (_u: string, _on: (p: Buffer) => void) => {
        calls++;
        await gate; // fica "a captar" até libertarmos
      }),
    });
    const s = new TranscriptionSession(deps as unknown as TranscriptionSessionDeps);
    const p1 = s.onSpeakingStart('yes');
    await s.onSpeakingStart('yes'); // 2.ª chamada enquanto a 1.ª ainda capta -> ignorada
    release();
    await p1;
    expect(calls).toBe(1); // só uma captura
  });

  it('utterance vazia (só ruído) não posta nada', async () => {
    const { deps, posts } = makeDeps({
      transcribe: vi.fn(async () => ({ text: '   ', lang: 'en' })),
    });
    const s = new TranscriptionSession(deps as unknown as TranscriptionSessionDeps);
    await s.onSpeakingStart('yes');
    expect(posts).toEqual([]);
  });

  it('stop() marca a sessão como parada: novos speaking-start são ignorados', async () => {
    const { deps, captured } = makeDeps();
    const s = new TranscriptionSession(deps as unknown as TranscriptionSessionDeps);
    s.stop();
    await s.onSpeakingStart('yes');
    expect(captured).toEqual([]);
  });

  it('transcribe() a falhar: engole o erro, não posta e não rebenta a sessão', async () => {
    const { deps, posts } = makeDeps({
      transcribe: vi.fn(async () => {
        throw new Error('sidecar morreu a meio');
      }),
    });
    const s = new TranscriptionSession(deps as unknown as TranscriptionSessionDeps);
    await expect(s.onSpeakingStart('yes')).resolves.toBeUndefined();
    expect(posts).toEqual([]);
  });

  it('o WAV temporário é apagado após a utterance MESMO quando a transcrição falha (PRIVACY §2.4)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vozen-stt-test-'));
    try {
      const written: string[] = [];
      const { deps } = makeDeps({
        tmpDir: dir,
        toWav: vi.fn(async (_pcm: Buffer, out: string) => {
          writeFileSync(out, 'wav'); // escreve mesmo o ficheiro (não é só o path)
          written.push(out);
          return out;
        }),
        transcribe: vi.fn(async () => {
          throw new Error('boom'); // caminho de falha: o finally tem de apagar na mesma
        }),
      });
      const s = new TranscriptionSession(deps as unknown as TranscriptionSessionDeps);
      await s.onSpeakingStart('yes');
      expect(written).toHaveLength(1);
      expect(existsSync(written[0])).toBe(false); // gravação consentida não persiste
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
