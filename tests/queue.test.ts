import { describe, it, expect } from 'vitest';
import { PlayQueue } from '../src/voice/queue';
import type { SynthRequest } from '../src/tts/engine';

const item = (text: string): { req: SynthRequest } => ({
  req: { text, model: 'm', speed: 1 },
});

describe('PlayQueue', () => {
  it('arranca vazia', () => {
    const q = new PlayQueue(3);
    expect(q.size()).toBe(0);
    expect(q.dequeue()).toBeUndefined();
  });

  it('enqueue/dequeue respeita ordem FIFO', () => {
    const q = new PlayQueue(3);
    expect(q.enqueue(item('a'))).toBe(true);
    expect(q.enqueue(item('b'))).toBe(true);
    expect(q.size()).toBe(2);
    expect(q.dequeue()).toEqual(item('a'));
    expect(q.dequeue()).toEqual(item('b'));
    expect(q.dequeue()).toBeUndefined();
    expect(q.size()).toBe(0);
  });

  it('enqueue devolve false quando cheia e nao adiciona', () => {
    const q = new PlayQueue(2);
    expect(q.enqueue(item('a'))).toBe(true);
    expect(q.enqueue(item('b'))).toBe(true);
    expect(q.enqueue(item('c'))).toBe(false);
    expect(q.size()).toBe(2);
    expect(q.dequeue()).toEqual(item('a'));
  });

  it('depois de dequeue ha espaco para enqueue de novo', () => {
    const q = new PlayQueue(1);
    expect(q.enqueue(item('a'))).toBe(true);
    expect(q.enqueue(item('b'))).toBe(false);
    q.dequeue();
    expect(q.enqueue(item('b'))).toBe(true);
    expect(q.size()).toBe(1);
  });

  it('clear esvazia a fila', () => {
    const q = new PlayQueue(3);
    q.enqueue(item('a'));
    q.enqueue(item('b'));
    q.clear();
    expect(q.size()).toBe(0);
    expect(q.dequeue()).toBeUndefined();
  });
});
