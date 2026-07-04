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
  // Linguas dos restantes modelos Piper. Onde o franc pode devolver mais do que
  // um codigo ISO 639-3 para a mesma lingua, mapeamos TODAS as variantes plausiveis
  // para o mesmo prefixo. Codigos confirmados empiricamente com franc v5
  // (node + amostras longas): arabe -> 'arb', persa -> 'fas', georgiano -> 'kat',
  // cazaque -> 'kaz', letao -> 'lav', nepali -> 'nep', eslovaco -> 'slk',
  // esloveno -> 'slv', servio -> 'srp', suaili -> 'swh', vietnamita -> 'vie',
  // chines -> 'cmn'. Mantemos tambem as variantes alternativas (ara/pes/swa/zho).
  // NOTA: cym (gales), isl (islandes) e ltz (luxemburgues) NAO sao emitidos pelo
  // franc v5 (sem modelo de trigramas -> classifica-os como tzm/uzn/deu). As
  // entradas ficam mesmo assim (corretas e forward-compatible): pickVoice e
  // independente do franc, e se a fonte de detecao mudar passam a funcionar.
  ara: 'ar_',
  arb: 'ar_',
  cym: 'cy_',
  fas: 'fa_',
  pes: 'fa_',
  isl: 'is_',
  kat: 'ka_',
  kaz: 'kk_',
  ltz: 'lb_',
  lav: 'lv_',
  nep: 'ne_',
  slk: 'sk_',
  slv: 'sl_',
  srp: 'sr_',
  swh: 'sw_',
  swa: 'sw_',
  vie: 'vi_',
  cmn: 'zh_',
  zho: 'zh_',
  // FIX (auditoria TTS — bug de alinhamento G3): 'no_NO' ja tinha autonimo em
  // LOCALE_NAMES ("Norsk") mas NENHUM codigo de deteccao apontava para o prefixo
  // 'no_' — texto noruegues nunca conseguia rotar para um modelo noruegues
  // instalado, caindo sempre no fallback (tipicamente a voz inglesa, i.e. garble
  // C1 do docs/VOICE-QUALITY.md). 'nob' (bokmal) e 'nno' (nynorsk) sao os codigos
  // ISO 639-3 dos dois padroes escritos noruegueses; 'nor' e o codigo do
  // macro-idioma. Mapeamos os tres pelo MESMO motivo do bloco cym/isl/ltz acima:
  // o franc v5 pode nao emitir nenhum deles hoje (sem modelo de trigramas para
  // noruegues), mas pickVoice/pickVoiceForLang sao independentes do franc — a
  // rota fica correta e forward-compatible assim que a deteccao (ou outra fonte,
  // ex. deteccao futura por locale do Discord) emitir um destes codigos.
  nob: 'no_',
  nno: 'no_',
  nor: 'no_',
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

/**
 * Escolhe a voz para a lingua `lang`, HONRANDO a voz `preferred` quando esta ja
 * esta na lingua detetada. Diferenca vs `pickVoice`: aqui `preferred` nao e um
 * fallback anonimo — e a voz que o utilizador/guild/.env querem, por isso, se ela
 * pertencer a lingua do texto, e ela que vence (mesmo que nao seja a 1.ª voz do
 * prefixo por ordem alfabetica; ex. 'en_GB-alan' para ingles, nao a 1.ª 'en_').
 *
 * - `lang` desconhecida/'' (deteccao falhou) => devolve `preferred` (nao da para
 *   decidir pela lingua, honra a preferida).
 * - `preferred` ja comeca pelo prefixo da lingua => devolve `preferred`.
 * - senao => 1.ª voz de `available` com o prefixo da lingua; se nao houver
 *   nenhuma, fallback a `preferred`.
 * PURO: sem efeitos secundarios.
 */
export function pickVoiceForLang(lang: string, available: string[], preferred: string): string {
  const prefix = LANG_TO_PREFIX[lang];
  if (!prefix) return preferred;
  if (preferred.startsWith(prefix)) return preferred;

  const match = available.find((model) => model.startsWith(prefix));
  return match ?? preferred;
}

/**
 * Nome de apresentação de cada locale Piper, escrito NA PRÓPRIA LÍNGUA (autónimo).
 * Usado no dropdown de escolha de voz para ser beginner-friendly (o utilizador vê
 * "Português", "English", "Français"… em vez do id técnico do modelo).
 * Chave = locale (a parte antes do 1.º '-' no nome do modelo, ex. 'pt_PT', 'en_US').
 * Onde há mais do que uma variante de uma língua, inclui a região para desambiguar.
 */
export const LOCALE_NAMES: Record<string, string> = {
  ar_JO: 'العربية',
  ca_ES: 'Català',
  cs_CZ: 'Čeština',
  cy_GB: 'Cymraeg',
  da_DK: 'Dansk',
  de_DE: 'Deutsch',
  el_GR: 'Ελληνικά',
  en_GB: 'English (UK)',
  en_US: 'English (US)',
  es_ES: 'Español',
  es_MX: 'Español (México)',
  fa_IR: 'فارسی',
  fi_FI: 'Suomi',
  fr_FR: 'Français',
  hu_HU: 'Magyar',
  is_IS: 'Íslenska',
  it_IT: 'Italiano',
  ka_GE: 'ქართული',
  kk_KZ: 'Қазақ тілі',
  lb_LU: 'Lëtzebuergesch',
  lv_LV: 'Latviešu',
  ne_NP: 'नेपाली',
  nl_BE: 'Nederlands (België)',
  nl_NL: 'Nederlands',
  no_NO: 'Norsk',
  pl_PL: 'Polski',
  pt_BR: 'Português', // pedido do Diogo: a única voz PT (Brasil) mostra-se como "Português"
  pt_PT: 'Português (Portugal)', // filtrado do availableModels (ver EXCLUDED_MODELS em index.ts)
  ro_RO: 'Română',
  ru_RU: 'Русский',
  sk_SK: 'Slovenčina',
  sl_SI: 'Slovenščina',
  sr_RS: 'Српски',
  sv_SE: 'Svenska',
  sw_CD: 'Kiswahili',
  tr_TR: 'Türkçe',
  uk_UA: 'Українська',
  vi_VN: 'Tiếng Việt',
  zh_CN: '中文',
};

/**
 * Nome amigável de um modelo Piper para o dropdown: a língua escrita na própria
 * língua, derivada do locale (parte antes do 1.º '-'). Se o locale não estiver
 * mapeado, devolve o id do modelo tal e qual (fallback seguro, nunca esconde uma voz).
 */
export function modelDisplayName(model: string): string {
  const dash = model.indexOf('-');
  const locale = dash === -1 ? model : model.slice(0, dash);
  return LOCALE_NAMES[locale] ?? model;
}

/**
 * Nome curto/humano da VOZ dentro de uma língua: o 2.º segmento do id do modelo
 * Piper (ex. 'en_US-amy-medium' -> 'Amy'), capitalizado. É o que distingue duas
 * vozes da MESMA língua (que o `modelDisplayName` colapsa no mesmo autónimo). Se
 * o id não tiver 2.º segmento, devolve o id cru (guard: nunca esconde uma voz).
 */
function voiceLabel(model: string): string {
  const parts = model.split('-');
  const raw = parts[1];
  if (!raw) return model;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Nome amigável COMPLETO de uma voz para as respostas de sucesso (ex. /voice set,
 * /config default-voice): junta o autónimo da língua (`modelDisplayName`) com o
 * nome humano da voz (`voiceLabel`), no formato "English (US) — Amy". É o que
 * distingue duas vozes da MESMA língua (que o `modelDisplayName` sozinho colapsava
 * no mesmo autónimo) e evita mostrar o id técnico ao iniciante. Guards preservados:
 *  - locale não mapeado -> `modelDisplayName` cai no id cru (nunca esconde a voz);
 *  - id sem 2.º segmento (sem '-') -> não há nome de voz para juntar, devolve só o
 *    nome da língua (nunca "… — " com sufixo vazio).
 * PURO: sem efeitos secundários.
 */
export function voiceDisplayName(model: string): string {
  const lang = modelDisplayName(model);
  if (model.indexOf('-') === -1) return lang;
  return `${lang} — ${voiceLabel(model)}`;
}

/** Parte um id de modelo no código base e região do locale: 'en_US-amy' -> {base:'en', region:'US'}. */
function baseAndRegion(model: string): { base: string; region: string } {
  const locale = model.split('-')[0]; // 'en_US'
  const us = locale.indexOf('_');
  if (us === -1) return { base: locale.toLowerCase(), region: '' };
  return { base: locale.slice(0, us).toLowerCase(), region: locale.slice(us + 1) };
}

/** Bases de língua com MAIS DO QUE UMA região instalada (ex. 'en' se houver en_US e en_GB). */
function multiRegionBases(models: string[]): Set<string> {
  const byBase = new Map<string, Set<string>>();
  for (const m of models) {
    const { base, region } = baseAndRegion(m);
    if (!byBase.has(base)) byBase.set(base, new Set());
    if (region) byBase.get(base)!.add(region);
  }
  const out = new Set<string>();
  for (const [base, regions] of byBase) if (regions.size > 1) out.add(base);
  return out;
}

/** `Intl.DisplayNames.of` seguro: devolve undefined em código desconhecido (of devolve o próprio código) ou erro. */
function safeOf(dn: Intl.DisplayNames, code: string): string | undefined {
  try {
    const r = dn.of(code);
    return r && r.toLowerCase() !== code.toLowerCase() ? r : undefined;
  } catch {
    return undefined;
  }
}

const capFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Fábrica de um "namer" que escreve o nome da voz NA LÍNGUA DO UTILIZADOR (o locale do
 * cliente Discord, `i.locale`) — ex.: a voz alemã aparece "Alemão — Thorsten" para um
 * user com Discord em PT, "Allemand — Thorsten" em FR, "German — Thorsten" em EN. Usa o
 * `Intl.DisplayNames` (dados ICU do Node) — sem tabela de tradução à mão, cobre todas as
 * línguas. A região só é mostrada quando essa base tem >1 região instalada (ex. inglês
 * US vs UK); senão fica só o nome da língua. Constrói o `Intl.DisplayNames` UMA vez (não
 * por modelo) por eficiência no autocomplete.
 *
 * `locale` ausente/vazio (ex.: contextos sem interação) -> cai no AUTÓNIMO
 * (`voiceDisplayName`), preservando o comportamento antigo. Código de língua desconhecido
 * pelo ICU -> também cai no autónimo (nunca esconde uma voz).
 */
export function makeLocalizedNamer(
  locale: string | undefined,
  models: string[],
  opts: { voice?: boolean } = {},
): (model: string) => string {
  // voice=true (default) -> "Alemão — Thorsten" (confirmações); voice=false -> só a
  // língua "Alemão" (o picker do /voice set, que sempre foi só a língua).
  const withVoice = opts.voice !== false;
  const fallback = (m: string): string => (withVoice ? voiceDisplayName(m) : modelDisplayName(m));
  if (!locale) return fallback;
  let langDN: Intl.DisplayNames;
  let regionDN: Intl.DisplayNames;
  try {
    langDN = new Intl.DisplayNames([locale, 'en'], { type: 'language' });
    regionDN = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
  } catch {
    return fallback; // locale inválido -> autónimo
  }
  const multi = multiRegionBases(models);
  return (model) => {
    const { base, region } = baseAndRegion(model);
    const langName = safeOf(langDN, base);
    if (!langName) return fallback(model); // língua desconhecida pelo ICU -> autónimo/id
    let name = capFirst(langName);
    if (region && multi.has(base)) {
      const rn = safeOf(regionDN, region);
      if (rn) name = `${name} (${rn})`;
    }
    if (!withVoice) return name;
    return model.indexOf('-') === -1 ? name : `${name} — ${voiceLabel(model)}`;
  };
}

/**
 * Renderiza a lista de vozes disponíveis AGRUPADA POR LÍNGUA, para o /voice list
 * ser beginner-friendly: em vez de uma lista plana de ids técnicos, mostra um
 * cabeçalho com o autónimo da língua (via LOCALE_NAMES / modelDisplayName) e, por
 * baixo, uma linha por voz com o nome humano e o id cru entre parênteses (para
 * `/voice set` continuar copy-pasteável). Línguas e vozes ordenadas por nome, para
 * uma leitura estável (e testável). PURO: sem efeitos secundários.
 */
export function formatVoiceList(models: string[], locale?: string): string {
  // Agrupa por locale (a parte antes do 1.º '-', mesma fatia do modelDisplayName).
  const groups = new Map<string, string[]>();
  for (const model of models) {
    const dash = model.indexOf('-');
    const loc = dash === -1 ? model : model.slice(0, dash);
    const bucket = groups.get(loc);
    if (bucket) bucket.push(model);
    else groups.set(loc, [model]);
  }

  // Cabeçalho na LÍNGUA DO UTILIZADOR (Intl) quando há `locale`; senão o AUTÓNIMO
  // (LOCALE_NAMES), preservando o comportamento antigo. A região só aparece quando a
  // base tem >1 região instalada (mesma regra do makeLocalizedNamer).
  const multi = multiRegionBases(models);
  let langDN: Intl.DisplayNames | undefined;
  let regionDN: Intl.DisplayNames | undefined;
  if (locale) {
    try {
      langDN = new Intl.DisplayNames([locale, 'en'], { type: 'language' });
      regionDN = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
    } catch {
      langDN = undefined;
      regionDN = undefined;
    }
  }
  const header = (loc: string): string => {
    if (langDN) {
      const { base, region } = baseAndRegion(loc);
      const langName = safeOf(langDN, base);
      if (langName) {
        let name = capFirst(langName);
        if (region && multi.has(base) && regionDN) {
          const rn = safeOf(regionDN, region);
          if (rn) name = `${name} (${rn})`;
        }
        return name;
      }
    }
    return LOCALE_NAMES[loc] ?? loc;
  };

  const lines: string[] = [];
  // Ordena os grupos pelo cabeçalho (localizado ou autónimo) para uma saída estável.
  const sortedLocales = [...groups.keys()].sort((a, b) => header(a).localeCompare(header(b)));
  for (const loc of sortedLocales) {
    lines.push(header(loc));
    const voices = groups.get(loc)!;
    for (const model of [...voices].sort((a, b) => voiceLabel(a).localeCompare(voiceLabel(b)))) {
      lines.push(`• ${voiceLabel(model)} (${model})`);
    }
  }
  return lines.join('\n');
}
