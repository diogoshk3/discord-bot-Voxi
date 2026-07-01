/**
 * Expansao de girias/abreviaturas por lingua, para o TTS soar natural (dizer
 * "by the way" em vez de soletrar "B-T-W").
 *
 * Funcao PURA e deterministica: depende so do input (texto + codigo de lingua),
 * sem efeitos secundarios nem estado.
 *
 * Match por FRONTEIRA DE PALAVRA, case-insensitive, usando lookarounds zero-width
 * (mesmo estilo que `applyPronunciation`): a fronteira NAO e consumida, por isso
 * abreviaturas adjacentes ("btw btw") expandem ambas e nunca se expande dentro de
 * uma palavra ("btwx" fica intacto).
 *
 * Seguranca de lingua: o dicionario e escolhido pelo codigo franc (ISO 639-3,
 * ex. 'eng'/'por'). Qualquer outra lingua — incluindo '' (desconhecida) e 'und' —
 * devolve o texto INALTERADO. Assim o passo nunca dispara fora da lingua certa.
 */

/** Dicionarios por lingua. Apenas tokens que NAO disparam em palavras normais. */
const DICTS: Record<string, Record<string, string>> = {
  eng: {
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
    np: 'no problem',
    ty: 'thank you',
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
    // 'bc' deliberadamente OMITIDO: dispara em texto normal ("500 BC" -> "500 because").
  },
  por: {
    pf: 'por favor',
    pfv: 'por favor',
    vc: 'você',
    vcs: 'vocês',
    tb: 'também',
    tbm: 'também',
    pq: 'porque',
    obg: 'obrigado',
    obgd: 'obrigado',
    hj: 'hoje',
    blz: 'beleza',
    vlw: 'valeu',
    mto: 'muito',
    qnd: 'quando',
    qdo: 'quando',
    msg: 'mensagem',
    agr: 'agora',
    dnd: 'de nada',
    flw: 'falou',
    cmg: 'comigo',
    ngm: 'ninguém',
  },
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
 * Expande as abreviaturas conhecidas da lingua `lang` no `text`.
 * Regra de capitalizacao (unica): se o token casado comeca por letra maiuscula
 * (ex. "Btw" ou "BTW"), a 1.a letra da expansao e capitalizada — para frases
 * naturais. Token em minusculas -> expansao tal e qual.
 */
export function expandAbbreviations(text: string, lang: string): string {
  const dict = DICTS[lang];
  if (!dict) return text;

  let out = text;
  for (const token of Object.keys(dict)) {
    const expansion = dict[token];
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
