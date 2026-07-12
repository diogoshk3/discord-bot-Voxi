// tests/multiSegmentExplicit.test.ts — caminho de segmentos EXPLICITOS (req.segments)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MultiSegmentEngine } from '../src/tts/multiSegment';
import { AudioCache } from '../src/tts/cache';
import type { TTSEngine, SynthRequest } from '../src/tts/engine';

const SAMPLE_RATE = 22050;
const BLOCK_ALIGN = 2;

function makeWav(data: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BLOCK_ALIGN, 28);
  header.writeUInt16LE(BLOCK_ALIGN, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const AVAILABLE = ['en_US-amy-medium', 'pt_PT-tugao-medium'];

describe('MultiSegmentEngine — segmentos EXPLICITOS (req.segments)', () => {
  let dir: string;
  let cache: AudioCache;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'multiseg-explicit-'));
    cache = new AudioCache(dir);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeBase(): { engine: TTSEngine; calls: SynthRequest[] } {
    const calls: SynthRequest[] = [];
    let n = 0;
    const engine: TTSEngine = {
      synth: vi.fn(async (req: SynthRequest) => {
        calls.push({ ...req });
        n += 1;
        const p = join(dir, `seg-${n}.wav`);
        writeFileSync(p, makeWav(Buffer.from([n, n, n, n])));
        return p;
      }),
    };
    return { engine, calls };
  }

  it('req.segments length 2 -> base.synth uma vez por segmento com o {text,model} certo + concatena', async () => {
    const { engine: base, calls } = makeBase();
    const eng = new MultiSegmentEngine(base, AVAILABLE, cache);
    const req: SynthRequest = {
      text: 'isto ta a funcionar by the way',
      model: 'pt_PT-tugao-medium',
      speed: 1,
      segments: [
        { text: 'isto ta a funcionar', model: 'pt_PT-tugao-medium' },
        { text: 'by the way', model: 'en_US-amy-medium' },
      ],
    };

    const resolved = await eng.synth(req);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      text: 'isto ta a funcionar',
      model: 'pt_PT-tugao-medium',
      speed: 1,
    });
    expect(calls[1]).toMatchObject({ text: 'by the way', model: 'en_US-amy-medium', speed: 1 });

    const buf = readFileSync(resolved);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    const dataSize = buf.readUInt32LE(40);
    expect(dataSize).toBeGreaterThan(8); // 4 + silencio + 4
  });

  it('PROPAGA engine + gcloudBudget para CADA sub-pedido (senão o Google HD cai em gTTS)', async () => {
    // Regressão (review Fase 4): o motor gcloud é gated no chokepoint pelo req.gcloudBudget.
    // Se o caminho por-segmento não o herdasse, uma mensagem multilíngue de um user Premium
    // chegava ao GCloudEngine SEM orçamento -> fail-safe -> gTTS (Google HD só funcionava nos
    // comandos-novidade, não no chat normal). Cada segmento TEM de levar engine + gcloudBudget.
    const { engine: base, calls } = makeBase();
    const eng = new MultiSegmentEngine(base, AVAILABLE, cache);
    const budget = { scope: 'user', key: 'u1' } as const;
    const req: SynthRequest = {
      text: 'isto ta a funcionar by the way',
      model: 'pt_PT-tugao-medium',
      speed: 1,
      engine: 'gcloud',
      gcloudBudget: budget,
      segments: [
        { text: 'isto ta a funcionar', model: 'pt_PT-tugao-medium' },
        { text: 'by the way', model: 'en_US-amy-medium' },
      ],
    };

    await eng.synth(req);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.engine).toBe('gcloud');
      expect(c.gcloudBudget).toEqual(budget);
    }
  });

  it('req.segments length 1 -> UMA chamada ao base com o {text,model} do segmento', async () => {
    const { engine: base, calls } = makeBase();
    const eng = new MultiSegmentEngine(base, AVAILABLE, cache);
    const req: SynthRequest = {
      text: 'ola mundo',
      model: 'pt_PT-tugao-medium',
      speed: 1.2,
      segments: [{ text: 'ola mundo', model: 'pt_PT-tugao-medium' }],
    };

    await eng.synth(req);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ text: 'ola mundo', model: 'pt_PT-tugao-medium', speed: 1.2 });
  });

  it('a chave de cache dos segmentos explicitos NAO colide com um req simples do mesmo `text`', async () => {
    // T e MULTI-SCRIPT (EN + RU) para que o req SIMPLES tambem tome o caminho
    // combinado (script-based) e produza a sua propria chave 'multiseg'. Se as
    // duas chaves colidissem, o 2.o pedido devolveria o WAV do 1.o.
    const en = 'good morning to all the members of this server i hope you are doing well';
    const ru = 'привет всем участникам этого замечательного сервера сегодня прекрасный день друзья';
    const T = `${en}. ${ru}`;

    // 1.o motor: caminho por-segmento EXPLICITO.
    const base1 = makeBase();
    const eng1 = new MultiSegmentEngine(base1.engine, AVAILABLE, cache);
    const explicitReq: SynthRequest = {
      text: T,
      model: 'pt_PT-tugao-medium',
      speed: 1,
      segments: [
        { text: en, model: 'en_US-amy-medium' },
        { text: ru, model: 'ru_RU-denis-medium' },
      ],
    };
    const explicitPath = await eng1.synth(explicitReq);

    // 2.o motor: caminho por-SCRIPT (sem segments), MESMO `text`.
    const base2 = makeBase();
    const eng2 = new MultiSegmentEngine(base2.engine, AVAILABLE, cache);
    const plainReq: SynthRequest = { text: T, model: 'pt_PT-tugao-medium', speed: 1 };
    const plainPath = await eng2.synth(plainReq);

    // Chaves de cache distintas -> caminhos de ficheiro distintos (sem colisao).
    expect(explicitPath).not.toBe(plainPath);
  });
});
