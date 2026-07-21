// One-shot marker written by the DEPLOY workflow immediately before it restarts
// vozen.service. It lets normal calls resume after a planned update, without making
// crash/manual restarts silently rejoin old calls.

import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const DEPLOY_REJOIN_MARKER = '.vozen-rejoin-after-deploy';
const MAX_MARKER_AGE_MS = 10 * 60_000;

/**
 * Consumes a fresh deploy marker exactly once. Old markers are removed but do not
 * authorize a rejoin: a failed or abandoned deploy must not affect a later restart.
 */
export function consumeDeployRejoinMarker(
  dir: string = process.cwd(),
  now: number = Date.now(),
): boolean {
  const marker = join(dir, DEPLOY_REJOIN_MARKER);
  try {
    if (!existsSync(marker)) return false;
    const age = now - statSync(marker).mtimeMs;
    const fresh = age >= 0 && age <= MAX_MARKER_AGE_MS;
    rmSync(marker, { force: true });
    return fresh;
  } catch {
    // A marker is only an availability convenience. Never block bot startup for it.
    return false;
  }
}
