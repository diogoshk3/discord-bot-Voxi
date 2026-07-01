import type { UserAbbrevEntry } from '../store/userAbbrev';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Teto de seguranca (defesa-em-profundidade): se a passagem unica produzir um output
 * maior que isto, devolve-se o texto ORIGINAL intacto. Valvula patologica — mensagens
 * normais nunca chegam perto (o /tts limita a maxChars, tipicamente <=2000). So la
 * para caucionar um caso extremo (muitas entries com replacements gigantes).
 */
const MAX_ABBREV_OUTPUT = 20000;

/**
 * Aplica as abreviaturas PESSOAIS do utilizador ao texto: cada `term` e substituido
 * pelo seu `replacement`, case-insensitive e por palavra completa. Funcao PURA e
 * deterministica.
 *
 * PASSAGEM UNICA (anti-cascata / anti-DoS): como as entries sao user-controladas nos
 * DOIS lados (termo E replacement), uma implementacao multi-passo (um out.replace por
 * entry sobre o output ACUMULADO) permitia encadear substituicoes (termo `a`->"b b b",
 * `b`->"c c c", ...) para re-expandir o output a cada passo -> crescimento exponencial
 * (billion-laughs) que congelava o event loop de TODO o bot multi-guild. Esta feature
 * e global-por-utilizador e sem privilegios, por isso a superficie de ataque e ampla.
 *
 * Por isso construimos UMA alternacao sobre TODOS os termos e fazemos UM SO replace com
 * um replacer-FUNCAO. Consequencias:
 *  - Um replacement NUNCA e re-analisado (o replace nao re-percorre o que ja inseriu):
 *    a cascata fica cortada, sem crescimento exponencial.
 *  - O replacer-FUNCAO insere a string LITERALMENTE — `$&`, `$\``, `$'`, `$n`, `$$` NAO
 *    sao interpretados (um replacer-string interpretava-os). "js"->"$&" fica "$&".
 *
 * Fronteiras: mesmos lookarounds zero-width (estilo unicode que
 * `applyPronunciation`/`expandAbbreviations`) para nunca disparar dentro de uma palavra
 * ("brbx" fica intacto) e apanhar termos adjacentes/repetidos.
 *
 * NOTA: `applyPronunciation` tem a MESMA forma multi-passo, mas e admin-gated
 * por-guild (risco menor: so um admin da guild define as entries) e fica de proposito
 * inalterada aqui.
 *
 * Aplicado ANTES das girias inglesas embutidas (precedencia: pessoal > embutido) e
 * em QUALQUER lingua. Com `entries` vazio e um no-op (devolve o texto tal e qual).
 */
export function applyUserAbbrev(text: string, entries: UserAbbrevEntry[]): string {
  // Fast path: sem entries, no-op (devolve o texto tal e qual).
  if (entries.length === 0) {
    return text;
  }

  // Mapa termo-lowercase -> replacement (dedupe defensivo: a ultima entry ganha). Os
  // termos vazios (apos trim) sao filtrados ANTES da alternacao — uma alternativa
  // vazia `(?:|foo)` casaria a string vazia em toda a posicao (catastrofico).
  const byTerm = new Map<string, string>();
  for (const { term, replacement } of entries) {
    const t = term.trim().toLowerCase();
    if (t === '') {
      continue;
    }
    byTerm.set(t, replacement);
  }
  if (byTerm.size === 0) {
    return text;
  }

  // Alternacao sobre TODOS os termos, ordenados do MAIS LONGO para o mais curto: assim,
  // se dois termos casarem na mesma posicao, ganha o mais longo (defensivo; os
  // lookarounds de fronteira ja evitam a maioria destas sobreposicoes).
  const terms = [...byTerm.keys()].sort((a, b) => b.length - a.length);
  const alt = terms.map(escapeRegExp).join('|');
  // `(?:...)` (nao-captura) e obrigatorio: sem o grupo, o `|` engoliria os lookarounds.
  const pattern = new RegExp(
    `(?<=^|[^\\p{L}\\p{N}])(?:${alt})(?=[^\\p{L}\\p{N}]|$)`,
    'giu',
  );

  // UM SO replace, com replacer-FUNCAO (insercao literal, sem re-analise -> sem cascata).
  const out = text.replace(pattern, (match) => byTerm.get(match.toLowerCase()) ?? match);

  // Teto de seguranca: output patologicamente grande -> devolve o original intacto.
  if (out.length > MAX_ABBREV_OUTPUT) {
    return text;
  }
  return out;
}
