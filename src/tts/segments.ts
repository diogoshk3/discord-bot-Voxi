// src/tts/segments.ts — P14.4a
import { detectLang } from '../language/detect';

export interface Segment {
  text: string;
  lang: string;
}

/**
 * Comprimento minimo (em caracteres nao-brancos) para confiar na deteccao de
 * lingua de um pedaco. Abaixo disto o franc e ruido: o pedaco herda a lingua do
 * vizinho/dominante em vez de virar um segmento proprio com uma lingua aleatoria.
 */
const MIN_DETECT_CHARS = 12;

/**
 * Classe de script de um caractere. Usada para partir o texto em RUNS de script
 * (a fronteira mais fiavel para separar linguas): a transicao Latin<->Cyrillic,
 * Latin<->CJK, etc. e um sinal forte de mudanca de lingua, ao contrario da
 * deteccao por span curto dentro do mesmo script (imperfeita — ver limitacoes).
 */
type Script = 'latin' | 'cyrillic' | 'cjk' | 'arabic' | 'other';

function scriptOf(ch: string): Script {
  const c = ch.codePointAt(0) ?? 0;
  // Cirilico (U+0400–U+04FF, +suplementos comuns U+0500–U+052F).
  if (c >= 0x0400 && c <= 0x052f) return 'cyrillic';
  // Arabe (U+0600–U+06FF, +suplemento U+0750–U+077F).
  if ((c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f)) return 'arabic';
  // CJK: Han unificado, Hiragana, Katakana, Hangul.
  if (
    (c >= 0x4e00 && c <= 0x9fff) || // CJK unificado
    (c >= 0x3040 && c <= 0x30ff) || // Hiragana + Katakana
    (c >= 0xac00 && c <= 0xd7af) // Hangul
  ) {
    return 'cjk';
  }
  // Latin basico + Latin-1 suplemento + Latin estendido A/B (acentos).
  if (
    (c >= 0x0041 && c <= 0x007a) ||
    (c >= 0x00c0 && c <= 0x024f)
  ) {
    return 'latin';
  }
  // Pontuacao, digitos, espacos, simbolos: neutros (nao forcam fronteira).
  return 'other';
}

/**
 * Pedaco cru do 1.º passo: um substring contiguo do input com o seu script
 * dominante. Preserva TODO o texto (incluindo pontuacao/espacos), por isso a
 * concatenacao dos `text` reproduz o input.
 */
interface Piece {
  text: string;
  script: Script;
}

/**
 * 1.º passo: parte o texto em pedacos por RUN de script. Caracteres 'other'
 * (espacos, pontuacao, digitos) colam-se ao pedaco anterior — nao abrem pedaco
 * novo — para nao fragmentar em cada espaco.
 */
function splitByScript(text: string): Piece[] {
  const pieces: Piece[] = [];
  let current = '';
  let currentScript: Script | null = null;

  for (const ch of text) {
    const s = scriptOf(ch);
    if (s === 'other') {
      // Neutro: acumula no pedaco corrente (ou arranca um se ainda nao houver).
      current += ch;
      continue;
    }
    if (currentScript === null) {
      currentScript = s;
      current += ch;
    } else if (s === currentScript) {
      current += ch;
    } else {
      // Mudanca de script -> fecha o pedaco corrente e abre um novo.
      pieces.push({ text: current, script: currentScript });
      current = ch;
      currentScript = s;
    }
  }
  if (current.length > 0) {
    pieces.push({ text: current, script: currentScript ?? 'other' });
  }
  return pieces;
}

/**
 * Deteta segmentos de lingua num texto, para sintese multi-lingua por-segmento.
 *
 * HEURISTICA (documentada e honesta sobre as suas limitacoes):
 *  1. Parte o texto em RUNS de script (Latin / Cyrillic / CJK / Arabic). Esta e
 *     a fronteira FIAVEL: uma transicao de script e quase sempre uma mudanca de
 *     lingua. Pontuacao/espacos/digitos sao neutros e colam ao pedaco anterior.
 *  2. Deteta a lingua de cada pedaco com `detectLang` (franc) — mas SO se o
 *     pedaco tiver comprimento suficiente (>= MIN_DETECT_CHARS de caracteres
 *     nao-brancos). Pedacos curtos demais ficam com lang '' (indeterminado).
 *  3. Pedacos indeterminados herdam a lingua do vizinho ANTERIOR (ou, se forem
 *     os primeiros, do proximo pedaco determinado / da lingua dominante do
 *     texto todo).
 *  4. Funde pedacos CONSECUTIVOS com a mesma lingua num unico segmento (o caso
 *     comum monolingue colapsa para 1 segmento).
 *
 * LIMITACOES (nao sobre-prometer):
 *  - Duas linguas do MESMO script na mesma frase (ex. ingles + frances, ambos
 *    Latin) NAO sao separadas de forma fiavel: nao ha fronteira de script e o
 *    franc por span curto e uma moeda ao ar. Nesses casos o texto tende a ficar
 *    num so segmento com a lingua dominante. Só o caso multi-script (ex. ingles
 *    + russo/cirilico, ou latim + arabe/CJK) e que separa com confianca.
 *  - A deteccao de spans curtos e imperfeita por construcao (o franc precisa de
 *    texto). Por isso o merge + heranca acima existem: reduzem falsos positivos.
 *
 * Devolve [] para texto vazio/so-espacos. Devolve 1 unico segmento quando tudo
 * e a mesma lingua (o caso comum). PURO: sem efeitos secundarios.
 */
export function detectSegments(text: string): Segment[] {
  if (text.trim().length === 0) return [];

  const pieces = splitByScript(text);
  if (pieces.length === 0) return [];

  // Passo 2: deteta lingua por pedaco (so quando ha comprimento suficiente).
  const langs: string[] = pieces.map((p) => {
    const nonSpace = p.text.replace(/\s+/g, '');
    if (nonSpace.length < MIN_DETECT_CHARS) return '';
    return detectLang(p.text);
  });

  // Lingua "dominante": a do pedaco determinado mais longo (por caracteres
  // nao-brancos). Serve de ancora para pedacos que ninguem consegue herdar.
  let dominant = '';
  let dominantLen = -1;
  for (let i = 0; i < pieces.length; i++) {
    if (!langs[i]) continue;
    const len = pieces[i].text.replace(/\s+/g, '').length;
    if (len > dominantLen) {
      dominantLen = len;
      dominant = langs[i];
    }
  }

  // Passo 3: heranca. Pedaco indeterminado -> lingua do anterior ja resolvido;
  // se nao houver anterior, do proximo determinado; senao, da dominante.
  const resolved: string[] = new Array(pieces.length).fill('');
  for (let i = 0; i < pieces.length; i++) {
    if (langs[i]) {
      resolved[i] = langs[i];
      continue;
    }
    if (i > 0 && resolved[i - 1]) {
      resolved[i] = resolved[i - 1];
      continue;
    }
    // Olha para a frente pelo proximo determinado.
    let next = '';
    for (let j = i + 1; j < pieces.length; j++) {
      if (langs[j]) {
        next = langs[j];
        break;
      }
    }
    resolved[i] = next || dominant;
  }

  // Se NADA foi detetado (texto todo curto/indeterminado), cai num unico
  // segmento com a deteccao do texto inteiro (melhor sinal disponivel).
  if (resolved.every((l) => l === '')) {
    return [{ text, lang: detectLang(text) }];
  }

  // Passo 4: funde pedacos consecutivos com a mesma lingua.
  const segments: Segment[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const lang = resolved[i];
    const last = segments[segments.length - 1];
    if (last && last.lang === lang) {
      last.text += pieces[i].text;
    } else {
      segments.push({ text: pieces[i].text, lang });
    }
  }

  return segments;
}
