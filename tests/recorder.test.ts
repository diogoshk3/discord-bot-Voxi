import { describe, it, expect } from 'vitest';
import { Readable, Transform } from 'node:stream';
import { VoicedCollector, recordUserSample } from '../src/voice/recorder';
import type { VoiceConnection } from '@discordjs/voice';

// 48kHz estéreo 16-bit => 192 bytes/ms (mesma conta de BYTES_PER_MS em recorder.ts).
const BYTES_PER_MS = 192;

/** Bloco de PCM "falado" (amplitude bem acima do chão de ruído, RMS >= 500). */
function voicedChunk(ms: number): Buffer {
  const buf = Buffer.alloc(ms * BYTES_PER_MS);
  for (let i = 0; i + 1 < buf.length; i += 2) buf.writeInt16LE(12000, i);
  return buf;
}

/** Bloco de PCM "silencioso" (amplitude zero, RMS < 500). */
function silentChunk(ms: number): Buffer {
  return Buffer.alloc(ms * BYTES_PER_MS);
}

describe('VoicedCollector', () => {
  it('só conta bytes VOZEADOS (RMS >= threshold) para o alvo', () => {
    const c = new VoicedCollector(100); // alvo: 100ms de fala
    expect(c.push(silentChunk(500))).toBe(false); // silêncio nunca enche o alvo
    expect(c.voicedMs).toBe(0);
    expect(c.push(voicedChunk(50))).toBe(false);
    expect(c.voicedMs).toBe(50);
    expect(c.push(voicedChunk(50))).toBe(true); // atingiu o alvo agora
    expect(c.done).toBe(true);
  });

  it('pcm() concatena só os pedaços vozeados (o silêncio fica de fora)', () => {
    const c = new VoicedCollector(1000);
    const v = voicedChunk(10);
    c.push(silentChunk(10));
    c.push(v);
    expect(c.pcm()).toEqual(v);
  });

  // Diagnóstico do gate de RMS: com o chão em 350, áudio de nível ~300 (fala fraca / mic com
  // ganho baixo) é VISTO mas REJEITADO — é exatamente o cenário "gravei 15s, saiu 2s". O teste
  // prova que framesSeen/framesVoiced/rmsStats distinguem "gate comeu" de "user falou pouco".
  it('framesSeen conta tudo, framesVoiced só o que passa o gate; rmsStats reporta a distribuição', () => {
    const amp = (level: number, ms: number): Buffer => {
      const buf = Buffer.alloc(ms * BYTES_PER_MS);
      for (let i = 0; i + 1 < buf.length; i += 2) buf.writeInt16LE(level, i);
      return buf;
    };
    const c = new VoicedCollector(10_000, 350); // chão explícito = 350
    c.push(amp(300, 20)); // abaixo do gate — visto mas não conta (fala fraca)
    c.push(amp(300, 20));
    c.push(amp(12000, 20)); // bem acima — conta
    expect(c.framesSeen).toBe(3);
    expect(c.framesVoiced).toBe(1);
    const s = c.rmsStats();
    expect(s.min).toBe(300);
    expect(s.max).toBe(12000);
    expect(s.median).toBeGreaterThanOrEqual(300);
  });
});

// Fake "subscribe": devolve um Readable puro (sem _destroy próprio, como o
// AudioReceiveStream real) que o teste alimenta manualmente com push().
function fakeSubscribe(): Readable {
  return new Readable({ read() {} });
}

// Fake "decoder": um Transform passthrough puro (sem _destroy próprio, como o
// prism.opus.Decoder real) — reproduz EXATAMENTE a mesma superfície de stream do
// código de produção, incluindo a caraterística que causa o bug: destruir a fonte
// (opus) NÃO propaga para o destino (decoder) via stream.pipe().
function fakePassthroughDecoder(): Transform {
  return new Transform({
    transform(chunk, _enc, cb) {
      cb(null, chunk);
    },
  });
}

const FAKE_CONNECTION = {} as VoiceConnection;

describe('recordUserSample — ronda nunca fica presa (regressão da propagação de destroy())', () => {
  // Nestes testes, stream.pipe() NÃO propaga destroy() da fonte para o destino (é o
  // comportamento real do Node — confirmado experimentalmente). Se o código voltar a
  // destruir só `opus` (sem também destruir `decoder`) em qualquer um dos 3 pontos de
  // paragem antecipada, estes testes ficam pendurados até ao timeout do teste.

  it('o botão "Parar" (shouldStop) termina a gravação rapidamente, mesmo a meio da fala', async () => {
    let stopped = false;
    const opus = fakeSubscribe();
    const promise = recordUserSample(
      FAKE_CONNECTION,
      'user1',
      { targetVoicedMs: 10_000, maxWallMs: 20_000, shouldStop: () => stopped },
      { subscribe: () => opus, makeDecoder: fakePassthroughDecoder },
    );
    // Fala um pouco (bem longe do alvo de 10s) e só depois pede para parar.
    opus.push(voicedChunk(50));
    await new Promise((r) => setTimeout(r, 250));
    stopped = true; // simula o clique no botão "Parar"

    const start = Date.now();
    const result = await promise;
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1500); // o poll interno é 200ms — nunca deveria demorar segundos
    expect(result.voicedMs).toBeGreaterThan(0);
    expect(result.voicedMs).toBeLessThan(10_000); // não atingiu o alvo — parou por causa do Stop
  }, 5_000);

  it('atingir o alvo A MEIO de fala contínua (sem pausa natural) termina de imediato', async () => {
    const opus = fakeSubscribe();
    const promise = recordUserSample(
      FAKE_CONNECTION,
      'user2',
      { targetVoicedMs: 100, maxWallMs: 10_000 }, // alvo pequeno para o teste ser rápido
      { subscribe: () => opus, makeDecoder: fakePassthroughDecoder },
    );
    // Uma única rajada de fala contínua, sem qualquer silêncio a seguir — a fonte
    // NUNCA chega a um fim natural; só o "alvo atingido -> destroy()" pode terminar isto.
    opus.push(voicedChunk(200));

    const result = await promise;
    expect(result.voicedMs).toBeGreaterThanOrEqual(100);
  }, 5_000);

  it('onProgress é notificado com os ms de fala acumulados enquanto grava', async () => {
    const opus = fakeSubscribe();
    const seen: number[] = [];
    const promise = recordUserSample(
      FAKE_CONNECTION,
      'userP',
      { targetVoicedMs: 200, maxWallMs: 10_000, onProgress: (ms) => seen.push(ms) },
      { subscribe: () => opus, makeDecoder: fakePassthroughDecoder },
    );
    opus.push(voicedChunk(120));
    opus.push(voicedChunk(120)); // passa o alvo de 200ms -> termina
    const result = await promise;
    expect(result.voicedMs).toBeGreaterThanOrEqual(200);
    // Reportou progresso pelo menos uma vez e o último valor bate certo com o total.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(result.voicedMs);
  }, 5_000);

  it('ronda totalmente silenciosa não fica presa — o guarda-tempo de ronda corta e tenta de novo', async () => {
    const opus = fakeSubscribe(); // nunca recebe push() nenhum — silêncio absoluto
    const start = Date.now();
    const result = await recordUserSample(
      FAKE_CONNECTION,
      'user3',
      { targetVoicedMs: 10_000, maxWallMs: 300, roundSilenceMs: 60 },
      { subscribe: () => opus, makeDecoder: fakePassthroughDecoder },
    );
    const elapsed = Date.now() - start;

    expect(result.voicedMs).toBe(0);
    // maxWallMs=300 é o teto; se o guarda-tempo de ronda (60ms) não cortasse a ronda
    // presa, isto só resolveria quando o vitest desistisse (bem acima de 1s).
    expect(elapsed).toBeLessThan(1500);
  }, 5_000);
});
