import { describe, it, expect } from 'vitest';
import {
  isRepetitionSpam,
  normalizeForDuplicate,
  DuplicateTracker,
  REPETITION_MIN_TOKENS,
  DUPLICATE_WINDOW_MS,
} from '../src/moderation/antispam';

const G = 'guild-1';
const U = 'user-1';

describe('isRepetitionSpam', () => {
  it('apanha o caso real: "POKEBOLAS" ×39', () => {
    expect(isRepetitionSpam(Array(39).fill('POKEBOLAS').join(' '))).toBe(true);
  });

  it('apanha "eu gosto de ti" ×3 (ratio 0.33)', () => {
    expect(isRepetitionSpam(Array(3).fill('eu gosto de ti').join(' '))).toBe(true);
  });

  it('deixa passar uma frase normal (alta diversidade)', () => {
    expect(
      isRepetitionSpam(
        'hoje fui ao mercado comprar pão leite e ainda uns ovos frescos para o jantar',
      ),
    ).toBe(false);
  });

  it('deixa passar mensagens curtas mesmo que repetidas (< min tokens)', () => {
    expect(isRepetitionSpam('sim sim sim')).toBe(false); // 3 tokens < 10
    // Exatamente na fronteira: 9 repetições não chega ao mínimo.
    expect(
      isRepetitionSpam(
        Array(REPETITION_MIN_TOKENS - 1)
          .fill('lol')
          .join(' '),
      ),
    ).toBe(false);
  });

  it('fronteira do ratio: 10 tokens com 4 únicos (0.4) NÃO é spam; com 3 únicos (0.3) é', () => {
    // "a a a a a a a b c d" -> 10 tokens, 4 únicos = 0.4 > 0.35
    expect(isRepetitionSpam('a a a a a a a b c d')).toBe(false);
    // "a a a a a a a a b c" -> 10 tokens, 3 únicos = 0.3 <= 0.35
    expect(isRepetitionSpam('a a a a a a a a b c')).toBe(true);
  });

  it('ignora pontuação/emoji na tokenização', () => {
    expect(isRepetitionSpam('POKEBOLAS!!! '.repeat(12))).toBe(true);
  });
});

describe('normalizeForDuplicate', () => {
  it('minúsculas, colapsa espaços e trim', () => {
    expect(normalizeForDuplicate('  Olá   MUNDO\n\tfim ')).toBe('olá mundo fim');
  });
});

describe('DuplicateTracker', () => {
  const big = 'esta é uma mensagem suficientemente grande para contar como duplicado spam ok'; // ≥40 chars

  it('a 1.ª ocorrência lê-se; a 2.ª idêntica dentro da janela é suprimida', () => {
    const t = new DuplicateTracker();
    expect(t.isDuplicateSpam(G, U, big, 0)).toBe(false);
    expect(t.isDuplicateSpam(G, U, big, 10_000)).toBe(true);
    expect(t.isDuplicateSpam(G, U, big, 30_000)).toBe(true);
  });

  it('passada a janela (≥60s) volta a ler uma vez', () => {
    const t = new DuplicateTracker();
    expect(t.isDuplicateSpam(G, U, big, 0)).toBe(false);
    expect(t.isDuplicateSpam(G, U, big, DUPLICATE_WINDOW_MS)).toBe(false); // 60s: fora da janela
    expect(t.isDuplicateSpam(G, U, big, DUPLICATE_WINDOW_MS + 5_000)).toBe(true); // já dentro da nova
  });

  it('mensagens curtas (< 40 chars) nunca são duplicado-spam', () => {
    const t = new DuplicateTracker();
    const short = 'ola malta tudo bem?'; // < 40 chars
    expect(t.isDuplicateSpam(G, U, short, 0)).toBe(false);
    expect(t.isDuplicateSpam(G, U, short, 1_000)).toBe(false);
  });

  it('texto diferente da mesma pessoa não é duplicado', () => {
    const t = new DuplicateTracker();
    const a = 'primeira mensagem bem grande para passar o limite dos quarenta chars';
    const b = 'segunda mensagem completamente diferente e também bem grande aqui';
    expect(t.isDuplicateSpam(G, U, a, 0)).toBe(false);
    expect(t.isDuplicateSpam(G, U, b, 1_000)).toBe(false);
  });

  it('autores e guilds diferentes são independentes', () => {
    const t = new DuplicateTracker();
    expect(t.isDuplicateSpam(G, U, big, 0)).toBe(false);
    expect(t.isDuplicateSpam(G, 'user-2', big, 1_000)).toBe(false); // outro autor
    expect(t.isDuplicateSpam('guild-2', U, big, 1_000)).toBe(false); // outra guild
    expect(t.isDuplicateSpam(G, U, big, 2_000)).toBe(true); // o par original repete
  });

  it('normaliza antes de comparar (espaços/maiúsculas não escapam)', () => {
    const t = new DuplicateTracker();
    expect(t.isDuplicateSpam(G, U, big, 0)).toBe(false);
    expect(t.isDuplicateSpam(G, U, `  ${big.toUpperCase()}  `, 5_000)).toBe(true);
  });
});
