export interface PronunciationEntry {
  term: string;
  replacement: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Aplica o dicionario de pronuncia ao texto: cada `term` e substituido pelo seu
 * `replacement`, case-insensitive e por palavra completa. Funcao PURA e deterministica.
 *
 * Fronteiras: usa lookarounds zero-width (mesmo estilo unicode que `isBlocked`, mas
 * SEM consumir os caracteres de fronteira) para que termos repetidos ou adjacentes
 * sejam todos substituidos — ao contrario de `isBlocked`, cujo padrao consome a
 * fronteira e e seguro apenas porque so faz `.test()`.
 *
 * Aplicado DEPOIS do `cleanText` e ANTES do synth. O whitespace residual de um
 * replacement vazio nao e re-colapsado (cleanText ja passou).
 */
export function applyPronunciation(text: string, dict: PronunciationEntry[]): string {
  let out = text;
  for (const { term, replacement } of dict) {
    const t = term.trim();
    if (t === '') {
      continue;
    }
    const pattern = new RegExp(
      `(?<=^|[^\\p{L}\\p{N}])${escapeRegExp(t)}(?=[^\\p{L}\\p{N}]|$)`,
      'giu',
    );
    out = out.replace(pattern, replacement);
  }
  return out;
}
