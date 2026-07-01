import { describe, it, expect } from 'vitest';
import { expandAbbreviations } from '../src/textCleaning/abbreviations';

describe('expandAbbreviations', () => {
  // ── EN ────────────────────────────────────────────────────────────────────
  it('expande abreviaturas EN comuns', () => {
    expect(expandAbbreviations('btw isto acabou', 'eng')).toBe('by the way isto acabou');
    expect(expandAbbreviations('idk what to do', 'eng')).toBe("I don't know what to do");
    expect(expandAbbreviations('imo this is fine', 'eng')).toBe('in my opinion this is fine');
    expect(expandAbbreviations('come asap please', 'eng')).toBe('come as soon as possible please');
  });

  // ── PT ────────────────────────────────────────────────────────────────────
  it('expande abreviaturas PT comuns', () => {
    expect(expandAbbreviations('vc viste isto', 'por')).toBe('você viste isto');
    expect(expandAbbreviations('pq fizeste isso', 'por')).toBe('porque fizeste isso');
    expect(expandAbbreviations('eu tbm acho', 'por')).toBe('eu também acho');
    expect(expandAbbreviations('obg pela ajuda', 'por')).toBe('obrigado pela ajuda');
  });

  // ── case-insensitive ──────────────────────────────────────────────────────
  it('e case-insensitive no match', () => {
    expect(expandAbbreviations('BTW algo', 'eng')).toBe('By the way algo');
    expect(expandAbbreviations('Btw algo', 'eng')).toBe('By the way algo');
  });

  // ── preservacao de capitalizacao ──────────────────────────────────────────
  it('capitaliza a 1.a letra da expansao quando o token comeca por maiuscula', () => {
    // token capitalizado -> expansao capitalizada
    expect(expandAbbreviations('Btw isto', 'eng')).toBe('By the way isto');
    // token em minusculas -> expansao tal e qual
    expect(expandAbbreviations('btw isto', 'eng')).toBe('by the way isto');
    // token tudo-maiusculas tambem capitaliza so a 1.a letra (regra unica)
    expect(expandAbbreviations('BTW isto', 'eng')).toBe('By the way isto');
  });

  it('a expansao que ja comeca por maiuscula mantem-se (idempotente)', () => {
    // 'idk' -> "I don't know" comeca por 'I' (maiuscula) em qualquer caso do token
    expect(expandAbbreviations('idk', 'eng')).toBe("I don't know");
    expect(expandAbbreviations('Idk', 'eng')).toBe("I don't know");
    expect(expandAbbreviations('IDK', 'eng')).toBe("I don't know");
  });

  // ── fronteira de palavra ──────────────────────────────────────────────────
  it('so expande em fronteira de palavra (nao dentro de palavras)', () => {
    expect(expandAbbreviations('btwx', 'eng')).toBe('btwx');
    expect(expandAbbreviations('xbtw', 'eng')).toBe('xbtw');
    expect(expandAbbreviations('vcs', 'por')).toBe('vocês'); // 'vcs' e um token proprio
    expect(expandAbbreviations('avc', 'por')).toBe('avc'); // 'vc' dentro de palavra -> intacto
  });

  // ── pontuacao adjacente ───────────────────────────────────────────────────
  it('preserva pontuacao a volta do token', () => {
    expect(expandAbbreviations('foste tu, vc, certo?', 'por')).toBe('foste tu, você, certo?');
    expect(expandAbbreviations('pq.', 'por')).toBe('porque.');
    expect(expandAbbreviations('(btw)', 'eng')).toBe('(by the way)');
  });

  // ── multiplas no mesmo texto ──────────────────────────────────────────────
  it('expande multiplas abreviaturas diferentes', () => {
    expect(expandAbbreviations('vc e tb eu, pq sim', 'por')).toBe(
      'você e também eu, porque sim',
    );
    expect(expandAbbreviations('idk tbh', 'eng')).toBe("I don't know to be honest");
  });

  // ── adjacentes (fronteira zero-width) ─────────────────────────────────────
  it('expande abreviaturas adjacentes (ambas)', () => {
    expect(expandAbbreviations('btw btw', 'eng')).toBe('by the way by the way');
    expect(expandAbbreviations('vc vc', 'por')).toBe('você você');
  });

  // ── lingua desconhecida / vazia -> inalterado ─────────────────────────────
  it('lingua desconhecida/vazia/und -> texto inalterado', () => {
    expect(expandAbbreviations('btw vc pq', '')).toBe('btw vc pq');
    expect(expandAbbreviations('btw vc pq', 'und')).toBe('btw vc pq');
    expect(expandAbbreviations('btw vc pq', 'fra')).toBe('btw vc pq');
    expect(expandAbbreviations('btw vc pq', 'deu')).toBe('btw vc pq');
  });

  // ── nao cruza linguas ─────────────────────────────────────────────────────
  it('nao aplica dicionario PT a texto marcado como EN (e vice-versa)', () => {
    // 'vc' so existe no dicionario PT -> com lang 'eng' fica intacto
    expect(expandAbbreviations('vc', 'eng')).toBe('vc');
    // 'btw' so existe no dicionario EN -> com lang 'por' fica intacto
    expect(expandAbbreviations('btw', 'por')).toBe('btw');
  });

  // ── texto vazio -> vazio ──────────────────────────────────────────────────
  it('texto vazio -> vazio', () => {
    expect(expandAbbreviations('', 'eng')).toBe('');
    expect(expandAbbreviations('', 'por')).toBe('');
  });

  // ── determinismo / pureza ─────────────────────────────────────────────────
  it('e deterministico para o mesmo input', () => {
    const out1 = expandAbbreviations('vc tb pq vc', 'por');
    const out2 = expandAbbreviations('vc tb pq vc', 'por');
    expect(out1).toBe(out2);
    expect(out1).toBe('você também porque você');
  });

  // ── nao toca em palavras normais ──────────────────────────────────────────
  it('nao expande palavras normais que contem um token como substring', () => {
    // 'np' -> 'no problem', mas 'snap' nao deve mudar
    expect(expandAbbreviations('snap', 'eng')).toBe('snap');
    // 'ty' -> 'thank you', mas 'tyrano' (inventado) nao muda
    expect(expandAbbreviations('typical', 'eng')).toBe('typical');
  });
});
