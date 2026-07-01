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

/**
 * Dicionarios por lingua. Apenas tokens que NAO disparam em palavras normais.
 *
 * REGRA DE CURADORIA (qualidade > cobertura): uma expansao errada e PIOR que
 * nenhuma. So entra uma chave se (1) for gíria/abreviatura de chat REAL e comum
 * na lingua, e (2) NAO colidir com uma palavra normal dessa lingua em NENHUMA
 * capitalizacao (o match e case-insensitive). Na duvida, EXCLUI. Chaves so com
 * letras (sem digitos, sem pontos), guardadas em minusculas.
 *
 * Indexado pelo codigo franc (ISO 639-3) EXATO que `detectLang` devolve — os
 * mesmos codigos de LANG_TO_PREFIX (voiceMap.ts), confirmados com franc v5.
 * Para linguas com variantes de codigo franc, o MESMO objeto e registado sob
 * todas as variantes (ver aliases no fim do ficheiro).
 */
const DICTS: Record<string, Record<string, string>> = {
  // ── EN (eng) ──────────────────────────────────────────────────────────────
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
    // Refino P17:
    afaik: 'as far as I know',
    lmk: 'let me know',
    nbd: 'no big deal',
    tba: 'to be announced',
    tbd: 'to be determined',
    ppl: 'people',
    pls: 'please',
    plz: 'please',
    thx: 'thanks',
    // Excluidos por colisao/ambiguidade:
    //   'bc'  -> dispara em "500 BC" ("500 because"),
    //   'dm'  -> colide com o verbo/inicio de nomes; ambiguo,
    //   'gg'/'wp' -> gaming, arriscado fora de contexto,
    //   'u'/'r'/'ur' -> chaves de 1 letra, colidem demasiado.
  },

  // ── PT (por) ──────────────────────────────────────────────────────────────
  por: {
    pf: 'por favor',
    pfv: 'por favor',
    pfvr: 'por favor',
    vc: 'você',
    vcs: 'vocês',
    tb: 'também',
    tbm: 'também',
    tmb: 'também',
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
    // Refino P17:
    bjs: 'beijos',
    abs: 'abraços',
    fds: 'fim de semana',
    // Excluidos: 'td' (colide com "tédio"? nao, mas 'td'->'tudo' e arriscado;
    //   'kd'/'kdê' regional; 'slc' ambiguo) -> deixados de fora por prudencia.
  },

  // ── DE (deu) ──────────────────────────────────────────────────────────────
  deu: {
    vllt: 'vielleicht',
    hdl: 'hab dich lieb',
    hdgdl: 'hab dich ganz doll lieb',
    mfg: 'mit freundlichen Grüßen',
    lg: 'liebe Grüße',
    vg: 'viele Grüße',
    ka: 'keine Ahnung',
    kp: 'kein Plan',
    wmd: 'was machst du',
    sry: 'sorry',
    // Excluidos por colisao com palavra normal (em qualquer caso):
    //   'da', 'so', 'am', 'im', 'nen', 'bb' (colide), 'bd' (ambiguo).
  },

  // ── FR (fra) ──────────────────────────────────────────────────────────────
  fra: {
    mdr: 'mort de rire',
    ptdr: 'pété de rire',
    bcp: 'beaucoup',
    pk: 'pourquoi',
    stp: "s'il te plaît",
    svp: "s'il vous plaît",
    dsl: 'désolé',
    jsp: 'je sais pas',
    tjrs: 'toujours',
    tkt: "t'inquiète",
    cad: "c'est-à-dire",
    slt: 'salut',
    bjr: 'bonjour',
    bsr: 'bonsoir',
    qqch: 'quelque chose',
    qqn: "quelqu'un",
    rdv: 'rendez-vous',
    // Excluidos por colisao: 'car', 'or', 'ou', 'on', 'ma', 'si', 'ce', 'ta',
    //   'auj' evitado (ambiguo com "aujourd'hui" mas raro isolado — deixado fora).
  },

  // ── ES (spa) ──────────────────────────────────────────────────────────────
  spa: {
    pq: 'porque',
    xq: 'porque',
    tb: 'también',
    tbn: 'también',
    porfa: 'por favor',
    porfi: 'por favor',
    tqm: 'te quiero mucho',
    finde: 'fin de semana',
    dnd: 'dónde',
    xfa: 'por favor',
    grax: 'gracias',
    bss: 'besos',
    // Excluidos por colisao / 1 letra: 'q'(que), 'k'(que), 'd'(de), 'x'(por),
    //   'tq' (colide com "te quiero" mas tambem "tal que"? ambiguo -> fora),
    //   'salu2' (digito, viola regra so-letras).
  },

  // ── IT (ita) ──────────────────────────────────────────────────────────────
  ita: {
    cmq: 'comunque',
    tvb: 'ti voglio bene',
    tvtb: 'ti voglio tanto bene',
    nn: 'non',
    qlcn: 'qualcuno',
    qlcs: 'qualcosa',
    msg: 'messaggio',
    cvd: 'come volevasi dimostrare',
    nnt: 'niente',
    grz: 'grazie',
    prg: 'prego',
    // Excluidos por colisao: 'ho', 'da', 'se', 'sa', 'te', 'ci', 'ne', 'no',
    //   'tt'(->tutto) e 'dv'(->dove) deixados fora por serem curtos/ambiguos,
    //   'xké' evitado (acento no 'é' + variantes ortograficas inconsistentes).
  },

  // ── NL (nld) ──────────────────────────────────────────────────────────────
  nld: {
    idd: 'inderdaad',
    ff: 'even',
    gwn: 'gewoon',
    wrm: 'waarom',
    aub: 'alsjeblieft',
    mss: 'misschien',
    msch: 'misschien',
    iwni: 'ik weet niet',
    tnx: 'bedankt',
    thx: 'bedankt',
    // Excluidos por colisao: 'en', 'je', 'ik', 'me', 'we', 'zo', 'nu', 'al',
    //   'idk'/'dm'/'ofc' evitados (sao ingleses, ambiguos em texto NL).
  },

  // ── RU (rus) ──────────────────────────────────────────────────────────────
  rus: {
    спс: 'спасибо',
    пжлст: 'пожалуйста',
    плз: 'пожалуйста',
    прив: 'привет',
    норм: 'нормально',
    оч: 'очень',
    пасибо: 'спасибо',
    хз: 'хрен знает',
    нзч: 'не за что',
    // Excluidos por ambiguidade/curteza: 'др' (silaba comum), 'нг', 'сб'.
  },

  // ── PL (pol) ──────────────────────────────────────────────────────────────
  pol: {
    nwm: 'nie wiem',
    nara: 'na razie',
    pzdr: 'pozdrawiam',
    zw: 'zaraz wracam',
    // Excluidos: 'thx'(->dzięki) ambiguo (ingles), 'spoko' e palavra lexicalizada,
    //   'dzięki' identico a si mesmo, 'jj' ambiguo.
  },

  // ── UK (ukr) ──────────────────────────────────────────────────────────────
  ukr: {
    // VAZIO de proposito (no-op seguro). Ver relatorio.
    //   'дяки'(->дякує) EXCLUIDO: colide com 'дяки' (plural/genitivo de 'дяк',
    //   escrivao — arcaico mas real) E nao e claramente a forma dominante de
    //   "obrigado" em chat (спс/дяк/дякую competem). Duvida nos dois eixos da
    //   regra de ouro -> fora. UK precisa de curadoria de um falante.
  },

  // ── TR (tur) ──────────────────────────────────────────────────────────────
  tur: {
    slm: 'selam',
    nbr: 'ne haber',
    mrb: 'merhaba',
    cnm: 'canım',
    eyw: 'eyvallah',
    tşk: 'teşekkürler',
    tsk: 'teşekkürler',
    tskler: 'teşekkürler',
    tmm: 'tamam',
    knk: 'kanka',
    // Excluidos: 'bkm'(ambiguo), palavras normais 'sen'/'ben'/'onu'.
  },
};

/**
 * Aliases de codigo franc -> codigo canonico ja em DICTS.
 *
 * O franc pode devolver mais do que um codigo ISO 639-3 para a mesma lingua
 * (arabe arb/ara, persa fas/pes, suaili swh/swa, chines cmn/zho). Para que o
 * dict funcione seja qual for a variante detetada, registamos o MESMO objeto
 * sob todas as variantes.
 *
 * Estado atual: nenhuma destas linguas tem dict curado (arabe/persa/suaili/
 * chines ficaram VAZIAS — ver relatorio; chines nem tem fronteira de palavra
 * util). Por isso os aliases nao apontam para nada hoje e o no-op cobre. Mas o
 * mecanismo fica pronto: para adicionar estas linguas, cria o dict sob o codigo
 * CANONICO (`arb`/`fas`/`swh`/`cmn`) em DICTS; o loop abaixo replica-o para a
 * variante (`ara`/`pes`/`swa`/`zho`) automaticamente, sem esquecer nenhuma.
 */
const VARIANT_ALIASES: Record<string, string> = {
  ara: 'arb', // arabe
  pes: 'fas', // persa
  swa: 'swh', // suaili
  zho: 'cmn', // chines
};
for (const [alias, canonical] of Object.entries(VARIANT_ALIASES)) {
  const canonicalDict = DICTS[canonical];
  if (canonicalDict && !DICTS[alias]) {
    DICTS[alias] = canonicalDict; // partilham a MESMA referencia
  }
}

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
