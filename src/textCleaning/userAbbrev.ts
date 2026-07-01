import type { UserAbbrevEntry } from '../store/userAbbrev';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Aplica as abreviaturas PESSOAIS do utilizador ao texto: cada `term` e substituido
 * pelo seu `replacement`, case-insensitive e por palavra completa. Funcao PURA e
 * deterministica.
 *
 * Fronteiras: usa lookarounds zero-width (mesmo estilo unicode que
 * `applyPronunciation`/`expandAbbreviations`, SEM consumir os caracteres de fronteira)
 * para que termos repetidos ou adjacentes sejam todos substituidos e nunca se dispare
 * dentro de uma palavra ("brbx" fica intacto).
 *
 * Aplicado ANTES das girias inglesas embutidas (precedencia: pessoal > embutido) e
 * em QUALQUER lingua. Com `entries` vazio e um no-op (devolve o texto tal e qual).
 */
export function applyUserAbbrev(text: string, entries: UserAbbrevEntry[]): string {
  let out = text;
  for (const { term, replacement } of entries) {
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
