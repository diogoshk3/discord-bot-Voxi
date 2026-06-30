import type { SynthRequest } from '../tts/engine';

export interface QueueItem {
  req: SynthRequest;
}

export class PlayQueue {
  private items: QueueItem[] = [];

  constructor(private readonly cap: number) {}

  enqueue(item: QueueItem): boolean {
    if (this.items.length >= this.cap) {
      return false;
    }
    this.items.push(item);
    return true;
  }

  dequeue(): QueueItem | undefined {
    return this.items.shift();
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}
