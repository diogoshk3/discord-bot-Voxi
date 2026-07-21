import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEPLOY_REJOIN_MARKER, consumeDeployRejoinMarker } from '../src/voice/deployRejoinMarker';

describe('deploy rejoin marker', () => {
  let dir: string;
  const now = 1_000_000;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vozen-deploy-rejoin-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts and consumes a fresh marker exactly once', () => {
    const marker = join(dir, DEPLOY_REJOIN_MARKER);
    writeFileSync(marker, '');
    utimesSync(marker, new Date(now), new Date(now));

    expect(consumeDeployRejoinMarker(dir, now + 1)).toBe(true);
    expect(consumeDeployRejoinMarker(dir, now + 2)).toBe(false);
  });

  it('removes a stale marker without authorizing a later restart', () => {
    const marker = join(dir, DEPLOY_REJOIN_MARKER);
    writeFileSync(marker, '');
    utimesSync(marker, new Date(now), new Date(now));

    expect(consumeDeployRejoinMarker(dir, now + 10 * 60_000 + 1)).toBe(false);
    expect(consumeDeployRejoinMarker(dir, now + 10 * 60_000 + 2)).toBe(false);
  });

  it('rejects a future marker instead of treating it as fresh', () => {
    const marker = join(dir, DEPLOY_REJOIN_MARKER);
    writeFileSync(marker, '');
    utimesSync(marker, new Date(now + 1), new Date(now + 1));

    expect(consumeDeployRejoinMarker(dir, now)).toBe(false);
  });
});
