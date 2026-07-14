import { describe, it, expect } from 'vitest';
import { voteUpsellLine } from '../src/commands/voteUpsell';

describe('voteUpsellLine — convite a votar → 24h de Plus grátis', () => {
  it('sem clientId (undefined ou vazio): devolve null (link partido) — não anexa nada', () => {
    expect(voteUpsellLine('en', undefined)).toBeNull();
    expect(voteUpsellLine('pt', '')).toBeNull();
  });

  it('com clientId: devolve uma linha com o link de voto do top.gg', () => {
    const en = voteUpsellLine('en', '12345');
    expect(en).not.toBeNull();
    expect(en).toContain('https://top.gg/bot/12345/vote');

    const pt = voteUpsellLine('pt', '12345');
    expect(pt).not.toBeNull();
    expect(pt).toContain('https://top.gg/bot/12345/vote');
    // PT difere do EN (a copy está localizada, não é fallback ao inglês).
    expect(pt).not.toBe(en);
  });
});
