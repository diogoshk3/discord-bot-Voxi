// src/textCleaning/accents.ts — restauro de acentos por-língua.
//
// PROBLEMA: em chat casual escreve-se muitas vezes SEM acentos ("nao", "voce",
// "amanha"). O Piper/espeak lê a grafia literal e soa MAL (verificado: "nao" e "não"
// produzem áudio diferente). SOLUÇÃO: antes de sintetizar, repor os acentos das
// palavras mais comuns da língua DETETADA.
//
// REGRA DE CURADORIA (intra-língua, não cross-língua): só entra uma palavra se a
// forma SEM acento NÃO for, ela própria, uma OUTRA palavra comum da mesma língua
// (em QUALQUER flexão e QUALQUER capitalização — o match é case-insensitive). Por
// isso ficam DE FORA os pares ambíguos (pt: esta/está, e/é, so/só, pais/país,
// pode/pôde, publico/público, musica/música, pratica/prática, manha/manhã…). Na
// dúvida, EXCLUI — uma troca errada é pior que um acento em falta. Aplica-se SÓ à
// língua correspondente (o dicionário `por` só corre quando a lingua é `por`).
//
// Chaves em minúsculas, sem acento; valores com acento e TAMBÉM em minúsculas (a
// capitalização do output é reposta por `matchCase` a partir do token casado, e o
// case é irrelevante para o fonema — o Piper/espeak ignora-o). `restoreAccents` casa
// por FRONTEIRA de palavra (mesmo estilo de expandAbbreviations) e preserva a
// capitalização do token (minúsculas / Primeira-maiúscula / TUDO-MAIÚSCULAS).

/** ISO 639-3 (o output de detectLang) -> dicionário sem-acento -> com-acento. */
const DICTS: Record<string, Record<string, string>> = {
  // ── Português ──────────────────────────────────────────────────────────────
  por: {
    nao: 'não', sao: 'são', entao: 'então', estao: 'estão', nao_: 'não',
    voce: 'você', voces: 'vocês',
    portugues: 'português', ingles: 'inglês', frances: 'francês', japones: 'japonês',
    chines: 'chinês', alemao: 'alemão',
    tambem: 'também', alem: 'além', ninguem: 'ninguém', alguem: 'alguém',
    parabens: 'parabéns', porem: 'porém',
    amanha: 'amanhã', manhas: 'manhãs',
    rapido: 'rápido', rapida: 'rápida', rapidos: 'rápidos', rapidas: 'rápidas',
    facil: 'fácil', faceis: 'fáceis', dificil: 'difícil', dificeis: 'difíceis',
    ultimo: 'último', ultima: 'última', ultimos: 'últimos', ultimas: 'últimas',
    proximo: 'próximo', proxima: 'próxima', proximos: 'próximos', proximas: 'próximas',
    numero: 'número', numeros: 'números',
    pagina: 'página', paginas: 'páginas',
    familia: 'família', familias: 'famílias',
    policia: 'polícia', experiencia: 'experiência', paciencia: 'paciência',
    ciencia: 'ciência', historia: 'história', historias: 'histórias',
    memoria: 'memória', vitoria: 'vitória', gloria: 'glória',
    servico: 'serviço', servicos: 'serviços', preco: 'preço', precos: 'preços',
    comecar: 'começar', comeca: 'começa', comecou: 'começou',
    coracao: 'coração', coracoes: 'corações',
    mae: 'mãe', maes: 'mães', irmao: 'irmão', irmaos: 'irmãos', irma: 'irmã',
    agua: 'água', aguas: 'águas',
    otimo: 'ótimo', otima: 'ótima', pessimo: 'péssimo', pessima: 'péssima',
    unico: 'único', unica: 'única',
    possivel: 'possível', impossivel: 'impossível', possiveis: 'possíveis',
    nivel: 'nível', niveis: 'níveis', util: 'útil', inutil: 'inútil',
    maquina: 'máquina', maquinas: 'máquinas',
    video: 'vídeo', videos: 'vídeos', musculo: 'músculo',
    ate: 'até',
  },
  // ── Espanhol (só palavras de conteúdo NÃO-ambíguas; fora que/qué, si/sí, tu/tú…) ─
  spa: {
    informacion: 'información', corazon: 'corazón', tambien: 'también', adios: 'adiós',
    facil: 'fácil', dificil: 'difícil', rapido: 'rápido', ultimo: 'último',
    numero: 'número', pagina: 'página', telefono: 'teléfono', arbol: 'árbol',
    lapiz: 'lápiz', musica: 'música', pelicula: 'película', cancion: 'canción',
    tambien_: 'también', espanol: 'español', ingles: 'inglés', frances: 'francés',
    aqui: 'aquí', alli: 'allí', ademas: 'además', despues: 'después', quiza: 'quizá',
  },
  // ── Francês (palavras comuns de conteúdo; fora a/à, ou/où, la/là…) ────────────
  fra: {
    francais: 'français', tres: 'très', etre: 'être', deja: 'déjà', apres: 'après',
    cafe: 'café', ecole: 'école', etudiant: 'étudiant', numero: 'numéro',
    telephone: 'téléphone', tele: 'télé', fenetre: 'fenêtre', theatre: 'théâtre',
    probleme: 'problème', systeme: 'système', modele: 'modèle', celebre: 'célèbre',
    repondre: 'répondre', prefere: 'préfère', achete: 'achète',
  },
  // ── Alemão ───────────────────────────────────────────────────────────────────
  // O trema (Umlaut ä/ö/ü) MUDA o fonema (ex. "schon"[ʃoːn] vs "schön"[ʃøːn]) e é
  // muito omitido em chat ("fur", "konnen", "grun"). Repô-lo melhora nitidamente o
  // áudio. MAS o alemão é um campo minado de pares mínimos distinguidos SÓ pelo
  // trema — por isso a curadoria aqui é AINDA mais estrita: só entram palavras cuja
  // forma sem-trema NÃO exista como QUALQUER palavra alemã, em QUALQUER flexão e
  // QUALQUER capitalização (o match é case-insensitive). Os infinitivos (-en) e as
  // formas claramente-não-palavra são o terreno seguro; as conjugadas colidem.
  //
  // Valores em minúsculas (o case não afeta o fonema; `matchCase` repõe-no do token).
  // O ß fica DE FORA de propósito: "ss"->"ß" quase não muda o fonema (ganho ~nulo) e
  // o "ss" é ortografia legítima (suíço), logo trocá-lo seria um risco sem retorno.
  deu: {
    fur: 'für', // fur = palavra inglesa, não alemã
    konnen: 'können', mussen: 'müssen', durfen: 'dürfen',
    naturlich: 'natürlich', moglich: 'möglich', wahrend: 'während',
    grun: 'grün', tur: 'tür', kuche: 'küche', madchen: 'mädchen',
    horen: 'hören', gehoren: 'gehören', wunschen: 'wünschen',
    fuhlen: 'fühlen', erzahlen: 'erzählen',
    funf: 'fünf', glucklich: 'glücklich', zuruck: 'zurück',
    // ── EXCLUÍDOS (a forma sem-trema É outra palavra alemã comum) ──────────────
    //   schon/schön (schon = "já"), wurde/würde, mochte/möchte, mochten/möchten,
    //   hatte/hätte, konnte/könnte, musste/müsste, durfte/dürfte, wusste/wüsste,
    //   ware/wäre (+ Ware = mercadoria), wahlen/wählen (Wahlen = eleições),
    //   zahlen/zählen (zahlen = pagar), lauft/läuft (ihr lauft), hort/hört (Hort),
    //   spat/spät (Spat = mineral), gluck/glück (Gluck = apelido do compositor).
    //   Também EXCLUÍDO über/uber: colide com a marca "Uber" (match case-insensitive)
    //   — na dúvida, exclui (regra do próprio ficheiro).
  },
};

// Remove as chaves-marcador com '_' (nunca casam: normalize não produz '_') que só
// existem para evitar duplicados literais acima.
for (const lang of Object.keys(DICTS)) {
  for (const k of Object.keys(DICTS[lang])) if (k.includes('_')) delete DICTS[lang][k];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Aplica a capitalização de `sample` (o token casado) à forma acentuada `accented`. */
function matchCase(sample: string, accented: string): string {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) {
    return accented.toUpperCase(); // TUDO MAIÚSCULAS
  }
  if (sample[0] === sample[0].toUpperCase() && sample[0] !== sample[0].toLowerCase()) {
    return accented[0].toUpperCase() + accented.slice(1); // Primeira-maiúscula
  }
  return accented; // minúsculas
}

/**
 * Repõe os acentos das palavras conhecidas de `lang` (código ISO 639-3) em `text`.
 * No-op se `lang` não tiver dicionário. Match por FRONTEIRA de palavra
 * (`[^\p{L}\p{N}]`), case-insensitive, preservando a capitalização. PURO.
 */
export function restoreAccents(text: string, lang: string): string {
  const dict = DICTS[lang];
  if (!dict) return text;
  let out = text;
  for (const key of Object.keys(dict)) {
    const accented = dict[key];
    const pattern = new RegExp(
      `(?<=^|[^\\p{L}\\p{N}])${escapeRegExp(key)}(?=[^\\p{L}\\p{N}]|$)`,
      'giu',
    );
    out = out.replace(pattern, (m) => matchCase(m, accented));
  }
  return out;
}

/**
 * Código ISO 639-3 (para `restoreAccents`) a partir de um nome de modelo Piper, mas
 * SÓ para as línguas com dicionário de acentos (senão ''). Usado no caminho de voz
 * FIXA (deteção OFF), onde a língua vem da voz escolhida, não do texto.
 */
export function accentLangOfModel(model: string): string {
  const us = model.indexOf('_');
  const prefix = us === -1 ? '' : model.slice(0, us); // 'pt', 'es', 'fr', 'de'…
  const map: Record<string, string> = { pt: 'por', es: 'spa', fr: 'fra', de: 'deu' };
  return map[prefix.toLowerCase()] ?? '';
}
