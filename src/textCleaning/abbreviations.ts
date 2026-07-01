/**
 * Expansao de girias/abreviaturas INGLESAS, para o TTS soar natural (dizer
 * "by the way" em vez de soletrar "B-T-W").
 *
 * Funcao PURA e deterministica: depende so do input (texto), sem efeitos
 * secundarios nem estado.
 *
 * Match por FRONTEIRA DE PALAVRA, case-insensitive, usando lookarounds zero-width
 * (mesmo estilo que `applyPronunciation`): a fronteira NAO e consumida, por isso
 * abreviaturas adjacentes ("btw btw") expandem ambas e nunca se expande dentro de
 * uma palavra ("btwx" fica intacto).
 *
 * Contrato de lingua (P18): as girias sao SO inglesas e aplicam-se em QUALQUER
 * lingua. Nao ha mais deteccao/argumento de lingua — as girias EN sao universais
 * (um "brb" e "brb" em qualquer chat). Por isso o dicionario foi auditado contra
 * COLISOES CRUZADAS com palavras comuns das outras linguas suportadas (ver abaixo).
 */

/**
 * Dicionario INGLES. Apenas tokens que NAO disparam em palavras normais.
 *
 * REGRA DE OURO (qualidade > cobertura): uma expansao errada e PIOR que nenhuma.
 * So entra uma chave se (1) for gíria/abreviatura de chat REAL e comum, e (2) NAO
 * colidir com uma palavra normal em NENHUMA capitalizacao (o match e
 * case-insensitive) — nem em ingles NEM em nenhuma das outras linguas suportadas.
 * Na duvida, EXCLUI. Chaves so com letras (sem digitos, sem pontos), em minusculas.
 *
 * AUDITORIA ANTI-COLISAO CRUZADA (P18): como agora aplicamos os tokens EN a
 * mensagens de QUALQUER lingua, cada token foi re-vetado contra palavras/abreviaturas
 * COMUNS das linguas de script latino suportadas (pt, es, fr, de, it, nl, pl, tr).
 * As de script cirilico/arabe/CJK sao seguras (estes tokens sao todos latinos).
 * Tokens dropados por colisao estao listados no bloco "Excluidos" no fim.
 */
const DICT: Record<string, string> = {
  btw: 'by the way',
  idk: "I don't know",
  idc: "I don't care",
  imo: 'in my opinion',
  imho: 'in my humble opinion',
  tbh: 'to be honest',
  brb: 'be right back',
  omg: 'oh my god',
  omw: 'on my way',
  rn: 'right now',
  fyi: 'for your information',
  asap: 'as soon as possible',
  aka: 'also known as',
  tysm: 'thank you so much',
  yw: "you're welcome",
  nvm: 'never mind',
  ttyl: 'talk to you later',
  gtg: 'got to go',
  wyd: 'what are you doing',
  ikr: 'I know right',
  smh: 'shaking my head',
  tldr: "too long didn't read",
  irl: 'in real life',
  afaik: 'as far as I know',
  lmk: 'let me know',
  nbd: 'no big deal',
  tba: 'to be announced',
  tbd: 'to be determined',
  ppl: 'people',
  pls: 'please',
  plz: 'please',
  thx: 'thanks',
  // Excluidos por COLISAO CRUZADA com palavras comuns de outras linguas suportadas:
  //   'ty' -> em POLACO "ty" e a palavra "tu/você" (pronome 2.a pessoa). DROPADO.
  //   'np' -> em POLACO "np." e "na przykład" (= "por exemplo"/"e.g."). DROPADO.
  // Excluidos ainda (colisao/ambiguidade em ingles, herdados da curadoria original):
  //   'bc'  -> dispara em "500 BC" ("500 because"),
  //   'dm'  -> colide com o verbo/inicio de nomes; ambiguo,
  //   'gg'/'wp' -> gaming, arriscado fora de contexto,
  //   'u'/'r'/'ur' -> chaves de 1 letra, colidem demasiado.
  // Nota da auditoria: 'thx' em polaco tambem se usa como "dzięki" (=thanks) — MESMO
  //   sentido, colisao inofensiva -> mantido. Os restantes tokens (aka/imo/rn/…) sao
  //   grupos consonanticos ou nao sao palavras nas 8 linguas latinas -> mantidos.
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Capitaliza so a 1.a letra (preservando o resto da expansao). */
function capitalizeFirst(s: string): string {
  if (s.length === 0) return s;
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * Expande as girias inglesas conhecidas no `text`, em QUALQUER lingua.
 * Regra de capitalizacao (unica): se o token casado comeca por letra maiuscula
 * (ex. "Btw" ou "BTW"), a 1.a letra da expansao e capitalizada — para frases
 * naturais. Token em minusculas -> expansao tal e qual.
 */
export function expandAbbreviations(text: string): string {
  let out = text;
  for (const token of Object.keys(DICT)) {
    const expansion = DICT[token];
    const pattern = new RegExp(
      `(?<=^|[^\\p{L}\\p{N}])${escapeRegExp(token)}(?=[^\\p{L}\\p{N}]|$)`,
      'giu',
    );
    out = out.replace(pattern, (match) => {
      const first = match[0];
      // Token comeca por maiuscula -> capitaliza a 1.a letra da expansao.
      return /\p{Lu}/u.test(first) ? capitalizeFirst(expansion) : expansion;
    });
  }
  return out;
}

/**
 * True se o `text` for composto ENTEIRAMENTE de girias EN conhecidas: cada token
 * separado por whitespace tem de ser uma chave do dicionario (case-insensitive).
 * Texto vazio/so-espacos -> false (nao ha nada para forcar).
 *
 * Usado (stretch P18) para forcar uma voz inglesa em mensagens que sao SO girias
 * ("brb", "omg lol"): sem isto, uma voz fixada noutra lingua leria as girias com
 * o sotaque errado. Funcao PURA.
 */
export function isAllEnglishAbbrev(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  // Antes da lookup, retira a pontuacao envolvente (nao-\p{L}\p{N} no inicio/fim),
  // espelhando a semantica de FRONTEIRA do expandAbbreviations: este expande "omg!"/
  // "wyd?"/"brb..." (a pontuacao e fronteira), por isso o all-check tem de casar o
  // MESMO nucleo. Um token que reduza a vazio (so pontuacao, ex. "!!!") nao esta no
  // DICT (hasOwnProperty(DICT, '') e false) -> every() devolve false. Assim mantem-se
  // o contrato "todos os tokens sao chaves" e ''/whitespace continua a dar false.
  return tokens.every((tok) => {
    const core = tok.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    return Object.prototype.hasOwnProperty.call(DICT, core);
  });
}
