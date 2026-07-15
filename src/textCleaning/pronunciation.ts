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
// Cache de RegExp compiladas por CONTEUDO do dicionario. Sem isto, o loop recompilava uma
// RegExp unicode por entrada a CADA mensagem lida (o dict chega novo a cada chamada; keia-se
// pelo conteudo — term E replacement, porque ambos afetam o resultado). Reutilizar e seguro:
// `String.replace` com RegExp global reseta o `lastIndex`. Cap simples com limpeza no teto.
const PRON_CACHE_CAP = 256;
const pronCache = new Map<string, { re: RegExp; replacement: string }[]>();

export function applyPronunciation(text: string, dict: PronunciationEntry[]): string {
  const entries = dict.filter((e) => e.term.trim() !== '');
  if (entries.length === 0) return text;
  // Separadores de controlo (U+241F campo, U+2426 entrada) que nao aparecem em texto normal
  // — evitam colisoes de chave entre dicionarios diferentes.
  const key = entries.map((e) => `${e.term.trim()}␟${e.replacement}`).join('␦');
  let compiled = pronCache.get(key);
  if (!compiled) {
    compiled = entries.map((e) => ({
      re: new RegExp(
        `(?<=^|[^\\p{L}\\p{N}])${escapeRegExp(e.term.trim())}(?=[^\\p{L}\\p{N}]|$)`,
        'giu',
      ),
      replacement: e.replacement,
    }));
    if (pronCache.size >= PRON_CACHE_CAP) pronCache.clear();
    pronCache.set(key, compiled);
  }
  let out = text;
  for (const { re, replacement } of compiled) {
    // Replacer-FUNÇÃO (não string) para tratar o replacement como LITERAL: uma string
    // crua faria String.replace interpretar $&, $1, $`, $', $$ como diretivas (o
    // replacement é controlado pelo admin via /config pronunciation — ex.: "R$"). As
    // irmãs restoreAccents/expandAbbreviations já usam replacers-função por isto.
    out = out.replace(re, () => replacement);
  }
  return out;
}
