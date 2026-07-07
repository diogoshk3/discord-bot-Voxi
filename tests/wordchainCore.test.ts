import { describe, it, expect } from 'vitest';
import {
  normalize,
  isPlayableForm,
  WordSetDictionary,
  ChainEngine,
} from '../src/games/wordchain/core';

describe('normalize — TEM de casar com tools/build-wordlists.mjs', () => {
  it('minúsculas + remove diacríticos (PT/FR/ES)', () => {
    expect(normalize('Cães')).toBe('caes');
    expect(normalize('éléphant')).toBe('elephant');
    expect(normalize('AVÓ')).toBe('avo');
    expect(normalize('árbol')).toBe('arbol');
    expect(normalize('Français')).toBe('francais');
  });
  it('mapeia ligaduras/consoantes especiais para latim base', () => {
    expect(normalize('Straße')).toBe('strasse');
    expect(normalize('œuvre')).toBe('oeuvre');
    expect(normalize('Ærø')).toBe('aero');
    expect(normalize('Łódź')).toBe('lodz');
  });
  it('alfabetos não-latinos ficam não-jogáveis', () => {
    expect(isPlayableForm(normalize('日本語'))).toBe(false);
    expect(isPlayableForm(normalize('привет'))).toBe(false);
    expect(isPlayableForm(normalize('gato'))).toBe(true);
    // parcial: uma palavra meio-latim-meio-outro alfabeto também cai
    expect(isPlayableForm(normalize('caféя'))).toBe(false);
  });
});

describe('WordSetDictionary', () => {
  const d = new WordSetDictionary(['gato', 'orca', 'arte', 'elefante']);
  it('has() por pertença exata', () => {
    expect(d.has('gato')).toBe(true);
    expect(d.has('cao')).toBe(false);
  });
  it('hasStartingWith() reflete as 1as letras existentes', () => {
    expect(d.hasStartingWith('g')).toBe(true);
    expect(d.hasStartingWith('o')).toBe(true);
    expect(d.hasStartingWith('e')).toBe(true);
    expect(d.hasStartingWith('z')).toBe(false);
  });
});

// Dicionário de teste com cadeia controlada: g->o->a->e->t...
const DICT = new WordSetDictionary([
  'gato', 'orca', 'arte', 'elefante', 'tigre', 'ema', 'ave', 'estrela',
  'texto', 'ovo', 'osso', 'aro', 'era', 'tao', 'oca',
]);

describe('ChainEngine.validate — motivos de rejeição', () => {
  it('letra errada / curta / repetida / inexistente / não-latina', () => {
    // seed fixo → letra de arranque determinista; forçamos via accept controlado abaixo.
    const e = new ChainEngine(DICT, 1);
    // Descobrir a letra exigida e construir casos à volta dela.
    const L = e.requiredLetter;
    // não-latina
    expect(e.validate('日本').reason).toBe('not-latin');
    // letra errada: uma palavra que NÃO começa por L (escolhe outra letra viva)
    const wrong = 'abcdefghijklmnopqrstuvwxyz'.split('').find((c) => c !== L)!;
    expect(e.validate(wrong + 'ato').reason).toBe('wrong-letter');
  });

  it('too-short respeita o mínimo (>=3)', () => {
    const e = new ChainEngine(DICT, 5);
    const L = e.requiredLetter;
    // palavra de 2 letras começada na letra certa
    expect(e.validate(L + 'x').reason).toBe('too-short');
  });
});

describe('ChainEngine — encadeamento, no-repeat e letra-morta', () => {
  it('accept avança a letra para a última da palavra', () => {
    const e = new ChainEngine(DICT, 3);
    // forçar a cadeia começando por 'g' (gato): validar+aceitar
    // não sabemos a letra inicial do seed; testamos a mecânica a partir de accept.
    e.accept('gato'); // última letra 'o' e 'o' tem palavras (orca/ovo/osso/oca)
    expect(e.requiredLetter).toBe('o');
    const v = e.validate('orca');
    expect(v.ok).toBe(true);
    e.accept('orca'); // -> 'a'
    expect(e.requiredLetter).toBe('a');
  });

  it('não deixa repetir uma palavra já usada', () => {
    const e = new ChainEngine(DICT, 3);
    e.accept('gato');
    e.accept('orca');
    e.accept('arte'); // -> e
    // "arte" já foi usada; mesmo válida por letra, é repetida
    e.accept('elefante'); // -> e (last 'e')... elefante termina em 'e'
    expect(e.validate('elefante').reason).toBe('repeated');
  });

  it('letra-morta: cai na penúltima quando nada começa pela última', () => {
    // 'texto' termina em 'o' (viva). Fabriquemos uma palavra que acabe em letra morta.
    // No DICT não há palavras a começar por 'x'. "texto" acaba em 'o' (viva) — usemos
    // uma palavra artificial via dicionário próprio:
    const d = new WordSetDictionary(['fax', 'arte', 'ema']);
    const e = new ChainEngine(d, 2);
    e.accept('fax'); // última 'x' MORTA -> penúltima 'a' (arte/ema? 'a' viva via 'arte')
    expect(e.requiredLetter).toBe('a');
  });
});

describe('ChainEngine — rampa de dificuldade', () => {
  it('minLength sobe 3 -> 4 -> 5 às 8 e 16 palavras', () => {
    const e = new ChainEngine(DICT, 7);
    expect(e.minLength).toBe(3);
    for (let i = 0; i < 8; i++) e.accept('gato'); // aceites contam (repetição não importa p/ ramp)
    expect(e.minLength).toBe(4);
    for (let i = 0; i < 8; i++) e.accept('gato');
    expect(e.minLength).toBe(5);
  });

  it('turnMs encurta com a cadeia e tem piso', () => {
    const e = new ChainEngine(DICT, 9, { startTurnMs: 15000, minTurnMs: 6000, turnDecrementMs: 400 });
    expect(e.turnMs).toBe(15000);
    e.accept('gato'); // -1x400
    expect(e.turnMs).toBe(14600);
    for (let i = 0; i < 100; i++) e.accept('gato');
    expect(e.turnMs).toBe(6000); // piso
  });
});
