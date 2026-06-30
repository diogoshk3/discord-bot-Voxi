// src/tts/cache.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SynthRequest } from './engine';

export function cacheKey(req: SynthRequest): string {
  // Hash estavel e sensivel a fronteiras: separador \u0000 que nao aparece em texto normal.
  const payload = `${req.text}\u0000${req.model}\u0000${req.speed}`;
  return createHash('sha1').update(payload, 'utf8').digest('hex');
}

export class AudioCache {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Devolve uma nova instância de AudioCache com o diretório raiz em
   * `<dir>/<namespace>/`. Usado para isolar caches por motor (ex. 'piper'
   * vs 'neural'), evitando que um motor sirva áudio produzido pelo outro.
   */
  withNamespace(namespace: string): AudioCache {
    return new AudioCache(join(this.dir, namespace));
  }

  private pathFor(key: string): string {
    return join(this.dir, `${key}.wav`);
  }

  get(key: string): string | null {
    const p = this.pathFor(key);
    return existsSync(p) ? p : null;
  }

  put(key: string, srcPath: string): string {
    const dest = this.pathFor(key);
    copyFileSync(srcPath, dest);
    return dest;
  }
}
