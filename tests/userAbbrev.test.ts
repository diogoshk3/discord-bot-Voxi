import { describe, it, expect } from 'vitest';
import { applyUserAbbrev } from '../src/textCleaning/userAbbrev';

describe('applyUserAbbrev', () => {
  const entries = [
    { term: 'brb', replacement: 'bora rapaz' },
    { term: 'js', replacement: 'JavaScript' },
  ];

  it('substitui um termo por palavra completa', () => {
    expect(applyUserAbbrev('espera brb', entries)).toBe('espera bora rapaz');
    expect(applyUserAbbrev('eu adoro js', entries)).toBe('eu adoro JavaScript');
  });

  it('e case-insensitive no match', () => {
    expect(applyUserAbbrev('BRB agora', entries)).toBe('bora rapaz agora');
    expect(applyUserAbbrev('Js', entries)).toBe('JavaScript');
  });

  it('so em fronteira de palavra (nao dentro de palavras)', () => {
    expect(applyUserAbbrev('brbx', entries)).toBe('brbx');
    expect(applyUserAbbrev('xbrb', entries)).toBe('xbrb');
  });

  it('substitui termos adjacentes (fronteira zero-width)', () => {
    expect(applyUserAbbrev('brb brb', entries)).toBe('bora rapaz bora rapaz');
  });

  it('preserva pontuacao a volta do termo', () => {
    expect(applyUserAbbrev('(brb)', entries)).toBe('(bora rapaz)');
    expect(applyUserAbbrev('brb!', entries)).toBe('bora rapaz!');
  });

  it('lista vazia -> texto inalterado (no-op)', () => {
    expect(applyUserAbbrev('brb js', [])).toBe('brb js');
  });

  it('texto vazio -> vazio', () => {
    expect(applyUserAbbrev('', entries)).toBe('');
  });

  it('e deterministico', () => {
    const a = applyUserAbbrev('brb e js', entries);
    const b = applyUserAbbrev('brb e js', entries);
    expect(a).toBe(b);
    expect(a).toBe('bora rapaz e JavaScript');
  });

  // ── seguranca: passagem unica corta a cascata (anti billion-laughs DoS) ──────
  // Cada entry e user-controlada nos DOIS lados (termo + replacement). Numa
  // implementacao multi-passo, um replacement que contem outro termo seria
  // re-expandido no passo seguinte -> crescimento exponencial que congela o event
  // loop de todo o bot. A passagem UNICA garante que um replacement NUNCA e
  // re-analisado: 'a'->'b b b' e o output final, o 'b' la dentro nao vira 'c'.
  it('nao re-expande um replacement que contem outro termo (cascata cortada)', () => {
    const chained = [
      { term: 'a', replacement: 'b b b' },
      { term: 'b', replacement: 'c c c' },
    ];
    const out = applyUserAbbrev('a', chained);
    expect(out).toBe('b b b');
    expect(out).not.toContain('c');
  });

  // ── correctness: replacement inserido LITERALMENTE (sem interpretacao de `$`) ──
  // Um replacer-string faz `$&`, `$\``, `$'`, `$n` e `$$` serem interpretados pelo
  // motor de regex. Com um replacer-FUNCAO a string entra tal e qual.
  it('insere o replacement literalmente (nao interpreta $& / $$)', () => {
    expect(applyUserAbbrev('hello js world', [{ term: 'js', replacement: '$&' }])).toBe(
      'hello $& world',
    );
    expect(applyUserAbbrev('x', [{ term: 'x', replacement: 'a$$b' }])).toBe('a$$b');
  });

  // ── seguranca (tempo/tamanho): muitas entries encadeadas de 1 char + 1 char de
  // input devolve rapido e pequeno (sem blow-up exponencial). Bounded-time check.
  it('input minusculo com muitas entries encadeadas devolve rapido e pequeno', () => {
    // a->'b b b b', b->'c c c c', ... : em multi-passo isto explodia.
    const chars = 'abcdefghijklmnop'.split('');
    const many = chars.map((c, idx) => ({
      term: c,
      replacement: (chars[idx + 1] ?? 'z').repeat(4).split('').join(' '),
    }));
    const start = Date.now();
    const out = applyUserAbbrev('a', many);
    expect(Date.now() - start).toBeLessThan(1000);
    // 1 passo: 'a' -> replacement de 'a' (contem 'b's, que NAO sao re-expandidos).
    expect(out.length).toBeLessThan(100);
  });
});
