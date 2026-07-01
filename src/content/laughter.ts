/**
 * Riso LOCALIZADO por língua, no script CORRETO (nunca transliterado).
 *
 * Puro e determinístico: `laughterFor(prefix)` devolve sempre a mesma string para
 * o mesmo prefixo de locale (ex. 'en_', 'ru_', 'ar_'). O prefixo é a parte inicial
 * do nome do modelo Piper até ao primeiro '_' inclusive (ex. 'en_US-amy-medium' ->
 * 'en_'), o mesmo prefixo usado em LANG_TO_PREFIX / pickVoice.
 *
 * Regras de design:
 *  - RISO SUBSTANCIAL: pelo menos 5 sílabas ("ha ha ha ha ha"), com duração-alvo
 *    >= 1.5s no TTS. As sílabas vão ESPAÇADAS (não fundidas) para o Piper as
 *    articular como um riso de verdade em vez de as arrastar num só som.
 *  - Contagem AFINADA POR SCRIPT: a duração por sílaba varia muito entre modelos
 *    (medido: Latino ~0.36s, Cirílico ~0.14s, Árabe ~0.135s, Han-par ~0.53s,
 *    Grego/Georgiano/Devanagari ~0.29–0.38s). A contagem foi calibrada para que
 *    CADA língua ultrapasse ~1.5s (ex. Cirílico/Árabe precisam de ~12 sílabas,
 *    Latino de 6). Valores empíricos com os modelos -medium.
 *  - Script NATIVO: línguas de escrita não-latina (Cirílico, Árabe, Georgiano,
 *    Devanagari, Han) têm o seu próprio riso — misturar "hahaha" latino num modelo
 *    Árabe/Han faria o Piper "comer as palavras".
 *  - Fallback "ha ha ha ha ha ha" para prefixo desconhecido ou vazio.
 */
interface Laugh {
  /** Sílaba de riso, no script nativo da língua. */
  unit: string;
  /** Quantas vezes repetir (calibrado para o riso durar >= ~1.5s). */
  count: number;
}

// Latino padrão: "ha" x6 (~2.1s no en_US-amy-medium).
const HA6: Laugh = { unit: 'ha', count: 6 };

const LAUGHTER: Record<string, Laugh> = {
  // ── Latinas (partilham "ha" x6, salvo grafia local) ──
  en_: HA6,
  // Português: o 'h' é MUDO no phonemizer PT -> "ha" quase não soa (medido 0.65s
  // no tugão). Usa-se "rá" (r forte /ʁ/, vocalizado) x9 -> ~1.6s de gargalhada.
  pt_: { unit: 'rá', count: 9 },
  fr_: HA6,
  de_: HA6,
  nl_: HA6,
  pl_: HA6,
  tr_: HA6,
  cs_: HA6,
  sv_: HA6,
  fi_: HA6,
  da_: HA6,
  ro_: HA6,
  hu_: HA6,
  cy_: HA6,
  is_: HA6,
  lb_: HA6,
  lv_: HA6,
  sk_: HA6,
  sl_: HA6,
  sw_: HA6,
  vi_: HA6,
  es_: { unit: 'ja', count: 6 },
  ca_: { unit: 'ja', count: 6 },
  it_: { unit: 'ah', count: 6 },
  el_: { unit: 'χα', count: 7 }, // Grego (~2.0s)
  // ── Cirílico (sílaba curta -> precisa de mais repetições p/ ~1.6s) ──
  ru_: { unit: 'ха', count: 12 },
  uk_: { unit: 'ха', count: 12 },
  kk_: { unit: 'ха', count: 12 },
  sr_: { unit: 'ха', count: 12 },
  // ── Árabe / Persa (sílaba muito curta -> ~12 p/ ~1.6s) ──
  ar_: { unit: 'هه', count: 12 },
  fa_: { unit: 'هه', count: 12 },
  // ── Georgiano ──
  ka_: { unit: 'ჰა', count: 6 },
  // ── Devanagari (nepali) ──
  ne_: { unit: 'हा', count: 6 },
  // ── Han (chinês): par "哈哈" espaçado evita a saturação do modelo com chars repetidos ──
  zh_: { unit: '哈哈', count: 5 },
};

/** Constrói o riso repetindo a sílaba, ESPAÇADA (para o TTS a articular). */
function build(l: Laugh): string {
  return Array<string>(l.count).fill(l.unit).join(' ');
}

/**
 * Riso para o prefixo de locale dado, no script correto, com >= 5 sílabas e
 * duração-alvo >= ~1.5s. Fallback para prefixos desconhecidos/vazios. PURO.
 */
export function laughterFor(langPrefix: string): string {
  return build(LAUGHTER[langPrefix] ?? HA6);
}
