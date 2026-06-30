/**
 * Mapeia codigos ISO 639-3 (output de detectLang) para prefixos de locale
 * usados nos nomes de modelos Piper (ex. 'por' -> 'pt_', 'eng' -> 'en_').
 */
const LANG_TO_PREFIX: Record<string, string> = {
  // Linguas originais
  // 'por' -> 'pt_' cobre DELIBERADAMENTE pt_PT e pt_BR: o franc devolve sempre
  // 'por' para portugues (sem distinguir variante) e ambos os locales Piper
  // ('pt_PT-...', 'pt_BR-...') comecam por 'pt_', logo pickVoice apanha o
  // primeiro modelo pt_ disponivel (ver tests P7.3 em tests/language.test.ts).
  por: 'pt_',
  eng: 'en_',
  spa: 'es_',
  fra: 'fr_',
  deu: 'de_',
  ita: 'it_',
  nld: 'nl_',
  rus: 'ru_',
  // Linguas adicionadas (P3.3)
  pol: 'pl_',
  ukr: 'uk_',
  tur: 'tr_',
  ces: 'cs_',
  cat: 'ca_',
  swe: 'sv_',
  fin: 'fi_',
  dan: 'da_',
  ron: 'ro_',
  ell: 'el_',
  hun: 'hu_',
};

/**
 * Escolhe um modelo Piper de `available` para a lingua `lang`.
 * Se existir um modelo cujo nome comeca pelo prefixo da lingua, devolve-o.
 * Caso contrario (lang desconhecida, '', ou sem modelo correspondente), devolve `fallback`.
 * PURO: sem efeitos secundarios.
 */
export function pickVoice(lang: string, available: string[], fallback: string): string {
  const prefix = LANG_TO_PREFIX[lang];
  if (!prefix) return fallback;

  const match = available.find((model) => model.startsWith(prefix));
  return match ?? fallback;
}
