/**
 * Utilitarios PUROS partilhados pelos minijogos. Sem estado, sem I/O — testaveis
 * isoladamente. A aleatoriedade e SEMPRE derivada de uma semente (seededShuffle/
 * seededIndex) para os testes serem deterministas, tal como pickJoke(key, seed).
 */

/**
 * Normaliza texto para comparacao TOLERANTE de respostas: minusculas, sem acentos
 * (NFD + strip de diacriticos), trim e espacos colapsados. Assim "Alemão", "alemao"
 * e "  ALEMAO " comparam iguais.
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Codigo base da lingua de um id de modelo Piper: 'de_DE-thorsten-medium' -> 'de'. */
export function baseCodeOf(model: string): string {
  return model.split('-')[0].split('_')[0].toLowerCase();
}

/**
 * Nome da lingua `base` escrito no `locale` do utilizador (via Intl.DisplayNames,
 * dados ICU do Node), capitalizado. Fallback ao proprio codigo se o ICU nao conhecer
 * a lingua ou o locale for invalido. NUNCA lanca.
 */
export function localizedLanguageName(base: string, locale: string): string {
  try {
    const dn = new Intl.DisplayNames([locale, 'en'], { type: 'language' });
    const name = dn.of(base);
    if (name && name.toLowerCase() !== base.toLowerCase()) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  } catch {
    /* locale/base invalido -> fallback abaixo */
  }
  return base;
}

/**
 * Converte letras A-Z para as suas versões de LARGURA COMPLETA (fullwidth, U+FF21+),
 * que têm ~a mesma largura de um emoji no Discord. Serve para alinhar uma linha de
 * letras EXATAMENTE por baixo de uma linha de quadrados emoji (🟩🟨⬛), sem depender
 * de espaços (que nunca batem certo com a largura do emoji). Não-letras ficam intactas.
 */
export function fullWidthLetters(s: string): string {
  let out = '';
  for (const ch of s.toUpperCase()) {
    const code = ch.codePointAt(0) ?? 0;
    out += code >= 0x41 && code <= 0x5a ? String.fromCodePoint(0xff21 + (code - 0x41)) : ch;
  }
  return out;
}

/** Gerador xorshift de 32 bits a partir de uma semente (nunca 0). Interno. */
function xorshift(seed: number): () => number {
  let state = (Math.floor(seed) | 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return Math.abs(state | 0);
  };
}

/** Gerador de inteiros nao-negativos deterministas a partir de `seed` (stream). */
export function makeRng(seed: number): () => number {
  return xorshift(seed);
}

/** Primeiro inteiro (com sinal opcional) num texto; null se nao houver. */
export function firstInteger(s: string): number | null {
  const m = s.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Semelhanca de Jaccard entre dois textos ao nivel de PALAVRA (ambos normalizados):
 * |A∩B| / |A∪B|, em [0,1]. Usada para aceitar respostas "quase iguais" (ex. jogo da
 * Velocidade, onde uma gralha nao deve invalidar). Conjuntos vazios -> 0.
 */
export function jaccard(a: string, b: string): number {
  const A = new Set(normalizeAnswer(a).split(' ').filter(Boolean));
  const B = new Set(normalizeAnswer(b).split(' ').filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Indice determinista em [0, n) a partir de uma semente. n<=0 -> 0. */
export function seededIndex(seed: number, n: number): number {
  if (n <= 0) return 0;
  return xorshift(seed)() % n;
}

/**
 * Baralha uma copia de `arr` deterministicamente a partir de `seed` (Fisher-Yates
 * com xorshift). Mesma semente -> mesma ordem (testavel); nao muta a entrada.
 */
export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = arr.slice();
  const next = xorshift(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
