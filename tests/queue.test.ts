import { describe, it, expect } from 'vitest';
import { PlayQueue } from '../src/voice/queue';

describe('PlayQueue', () => {
  it('arranca vazia', () => {
    const q = new PlayQueue(3);
    expect(q.size()).toBe(0);
    expect(q.dequeue()).toBeUndefined();
  });

  it('enqueue/dequeue respeita ordem FIFO', () => {
    const q = new PlayQueue(3);
    expect(q.enqueue({ audioPath: 'a.wav' })).toBe(true);
    expect(q.enqueue({ audioPath: 'b.wav' })).toBe(true);
    expect(q.size()).toBe(2);
    expect(q.dequeue()).toEqual({ audioPath: 'a.wav' });
    expect(q.dequeue()).toEqual({ audioPath: 'b.wav' });
    expect(q.dequeue()).toBeUndefined();
    expect(q.size()).toBe(0);
  });

  it('enqueue devolve false quando cheia e nao adiciona', () => {
    const q = new PlayQueue(2);
    expect(q.enqueue({ audioPath: 'a.wav' })).toBe(true);
    expect(q.enqueue({ audioPath: 'b.wav' })).toBe(true);
    expect(q.enqueue({ audioPath: 'c.wav' })).toBe(false);
    expect(q.size()).toBe(2);
    expect(q.dequeue()).toEqual({ audioPath: 'a.wav' });
  });

  it('depois de dequeue ha espaco para enqueue de novo', () => {
    const q = new PlayQueue(1);
    expect(q.enqueue({ audioPath: 'a.wav' })).toBe(true);
    expect(q.enqueue({ audioPath: 'b.wav' })).toBe(false);
    q.dequeue();
    expect(q.enqueue({ audioPath: 'b.wav' })).toBe(true);
    expect(q.size()).toBe(1);
  });

  it('clear esvazia a fila', () => {
    const q = new PlayQueue(3);
    q.enqueue({ audioPath: 'a.wav' });
    q.enqueue({ audioPath: 'b.wav' });
    q.clear();
    expect(q.size()).toBe(0);
    expect(q.dequeue()).toBeUndefined();
  });
});
