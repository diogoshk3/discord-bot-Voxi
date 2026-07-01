/**
 * Riso LOCALIZADO por língua, no script CORRETO (nunca transliterado).
 *
 * Puro e determinístico: `laughterFor(prefix)` devolve sempre a mesma string para
 * o mesmo prefixo de locale (ex. 'en_', 'ru_', 'ar_'). O prefixo é a parte inicial
 * do nome do modelo Piper até ao primeiro '_' inclusive (ex. 'en_US-amy-medium' ->
 * 'en_'), o mesmo prefixo usado em LANG_TO_PREFIX / pickVoice.
 *
 * Regras de design:
 *  - Curto (2–4 sílabas) para o TTS renderizar limpo, sem arrastar.
 *  - Script NATIVO: as línguas de escrita não-latina (Cirílico, Árabe, Georgiano,
 *    Devanagari, Han) têm o seu próprio riso — misturar "hahaha" latino num modelo
 *    Árabe/Han faria o Piper "comer as palavras" (o mesmo garble que o bot evita).
 *  - Fallback "hahaha" para qualquer prefixo desconhecido ou vazio.
 */
const LAUGHTER: Record<string, string> = {
  // Latinas — a maioria partilha "hahaha"; algumas com a grafia local natural.
  en_: 'hahaha',
  pt_: 'hahaha',
  es_: 'jajaja',
  fr_: 'hahaha',
  de_: 'hahaha',
  it_: 'ahahah',
  nl_: 'hahaha',
  pl_: 'hahaha',
  tr_: 'hahaha',
  cs_: 'hahaha',
  ca_: 'jajaja',
  sv_: 'hahaha',
  fi_: 'hahaha',
  da_: 'hahaha',
  ro_: 'hahaha',
  hu_: 'hahaha',
  cy_: 'hahaha',
  is_: 'hahaha',
  lb_: 'hahaha',
  lv_: 'hahaha',
  sk_: 'hahaha',
  sl_: 'hahaha',
  sw_: 'hahaha',
  vi_: 'hahaha',
  el_: 'χαχαχα',
  // Cirílico
  ru_: 'хахаха',
  uk_: 'хахаха',
  kk_: 'хахаха',
  sr_: 'хахаха',
  // Árabe (persa partilha a escrita)
  ar_: 'هههه',
  fa_: 'هههه',
  // Georgiano
  ka_: 'ჰაჰაჰა',
  // Devanagari (nepali)
  ne_: 'हाहाहा',
  // Han (chinês)
  zh_: '哈哈哈',
};

/**
 * Riso para o prefixo de locale dado, no script correto. Fallback "hahaha" para
 * prefixos desconhecidos ou vazios. PURO: sem efeitos secundários.
 */
export function laughterFor(langPrefix: string): string {
  return LAUGHTER[langPrefix] ?? 'hahaha';
}
