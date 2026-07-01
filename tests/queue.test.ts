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

  it('cap=0 rejeita sempre o enqueue', () => {
    const q = new PlayQueue(0);
    expect(q.enqueue(item('a'))).toBe(false);
    expect(q.enqueue(item('b'))).toBe(false);
    expect(q.size()).toBe(0);
    // Continua a rejeitar mesmo depois de tentativas repetidas
    expect(q.enqueue(item('c'))).toBe(false);
    expect(q.size()).toBe(0);
  });

  it('cap=1 aceita o 1o, rejeita o 2o e volta a aceitar apos dequeue', () => {
    const q = new PlayQueue(1);
    expect(q.enqueue(item('a'))).toBe(true);
    expect(q.enqueue(item('b'))).toBe(false);
    expect(q.size()).toBe(1);
    // Liberta a unica vaga
    expect(q.dequeue()).toEqual(item('a'));
    expect(q.size()).toBe(0);
    // Ha espaco de novo
    expect(q.enqueue(item('b'))).toBe(true);
    expect(q.size()).toBe(1);
  });

  it('dequeue numa fila vazia devolve undefined', () => {
    const q = new PlayQueue(3);
    expect(q.dequeue()).toBeUndefined();
    // Continua undefined em chamadas repetidas
    expect(q.dequeue()).toBeUndefined();
    expect(q.size()).toBe(0);
  });

  it('clear a meio esvazia e a fila aceita de novo', () => {
    const q = new PlayQueue(3);
    q.enqueue(item('a'));
    q.enqueue(item('b'));
    expect(q.size()).toBe(2);
    q.clear();
    expect(q.size()).toBe(0);
    // Depois do clear volta a aceitar itens normalmente
    expect(q.enqueue(item('c'))).toBe(true);
    expect(q.size()).toBe(1);
    expect(q.dequeue()).toEqual(item('c'));
  });
});
