import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), { encoding: 'utf8' });

describe('operational security configuration', () => {
  it('keeps the Cloudflare CSP aligned with the self-hosted-font privacy promise', () => {
    const script = source('tools/cf-security-headers.mjs');
    expect(script).not.toContain('fonts.googleapis.com');
    expect(script).not.toContain('fonts.gstatic.com');
    expect(script).toContain("style-src 'self' 'unsafe-inline'");
    expect(script).toContain("font-src 'self'");
  });

  it('verifies both downloaded Kokoro model assets against pinned SHA-256 hashes', () => {
    const script = source('tools/setup-kokoro.ps1');
    expect(script).toContain('7D5DF8ECF7D4B1878015A32686053FD0EEBE2BC377234608764CC0EF3636A6C5');
    expect(script).toContain('BCA610B8308E8D99F32E6FE4197E7EC01679264EFED0CAC9140FE9C29F1FBF7D');
    expect(script).toContain('Get-FileHash');
  });

  it('handles a one-element Python command safely in the clone setup script', () => {
    const script = source('tools/setup-clone.ps1');
    expect(script).toContain('if ($basePy.Count -gt 1)');
    expect(script).not.toContain('& $basePy[0] $basePy[1..($basePy.Count-1)]');
  });

  it('does not ship byte-identical font files under duplicate names', () => {
    const fontDir = resolve(process.cwd(), 'site/assets/fonts');
    const byHash = new Map<string, string>();
    for (const name of readdirSync(fontDir)) {
      const bytes = readFileSync(resolve(fontDir, name));
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(byHash.get(hash), `${name} duplicates ${byHash.get(hash)}`).toBeUndefined();
      byHash.set(hash, name);
    }
  });

  it('keeps every font URL in the site stylesheet resolvable', () => {
    const css = source('site/css/main-v31.css');
    const urls = [...css.matchAll(/url\("\.\.\/assets\/fonts\/([^"?]+)"\)/g)].map(
      (match) => match[1],
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const name of urls) {
      expect(existsSync(resolve(process.cwd(), 'site/assets/fonts', name)), name).toBe(true);
    }
  });

  it('keeps developer-facing accessibility labels in English', () => {
    const script = source('site/js/main-v28.js');
    expect(script).toContain('aria-label="Copy Discord ID"');
    expect(script).not.toContain('aria-label="Copiar Discord ID"');
  });
});
