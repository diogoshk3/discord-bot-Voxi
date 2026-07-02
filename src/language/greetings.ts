/**
 * Lexico de SAUDACOES / palavras curtas comuns -> lingua (codigo ISO 639-3).
 *
 * PORQUE existe: o `franc` (deteccao por trigramas) NAO consegue decidir a lingua
 * de texto muito curto — devolve 'und' para 1-3 letras ("ola", "oi", "hi") e chega
 * a errar em frases curtas ("ola tudo bem" -> Tok Pisin, "ciao come stai" ->
 * portugues). Forcar o franc com `only`/`minLength` baixo NAO ajuda: ele escolhe
 * um palpite CONFIANTE mas errado ("ola" -> turco, "sim" -> servio). Verificado
 * empiricamente com franc v5.
 *
 * A solucao correta para o texto curto e um lexico curado: mapeia as saudacoes e
 * palavras-marca mais comuns (na PROPRIA lingua, com e sem acento) para o codigo da
 * lingua. E baseado no TEXTO (nao no locale do cliente Discord), por isso funciona
 * tanto no /tts como na leitura automatica de canal (onde nao ha locale do user).
 *
 * REGRAS anti-colisao: so entram tokens FORTEMENTE associados a uma lingua. Tokens
 * ambiguos entre linguas ("ok", "no", "si", "ja", "dag", "hej") sao DELIBERADAMENTE
 * deixados de fora — caem no franc (texto longo) ou na voz preferida.
 *
 * Os codigos devolvidos existem TODOS em LANG_TO_PREFIX (voiceMap.ts), senao a
 * escolha de voz nao encontraria modelo. PURO: sem efeitos secundarios.
 */

/**
 * Palavra/expressao normalizada -> codigo ISO 639-3. Chaves em minusculas, sem
 * pontuacao (o `normalize` abaixo poe o input no mesmo formato antes de procurar).
 * Inclui variantes com e sem acento porque muita gente escreve sem acentos.
 */
const LEXICON: Record<string, string> = {
  // ── Portugues (por) ────────────────────────────────────────────────────────
  ola: 'por',
  olá: 'por',
  oi: 'por',
  oie: 'por',
  opa: 'por',
  alo: 'por',
  alô: 'por',
  'bom dia': 'por',
  'boa tarde': 'por',
  'boa noite': 'por',
  'tudo bem': 'por',
  'tudo bom': 'por',
  'como estas': 'por',
  'como estás': 'por',
  obrigado: 'por',
  obrigada: 'por',
  obg: 'por',
  'muito obrigado': 'por',
  'muito obrigada': 'por',
  valeu: 'por',
  'de nada': 'por',
  sim: 'por',
  não: 'por',
  nao: 'por',
  claro: 'por',
  tchau: 'por',
  adeus: 'por',
  'ate logo': 'por',
  'até logo': 'por',
  'ate ja': 'por',
  'até já': 'por',
  beleza: 'por',
  'e ai': 'por',
  'e aí': 'por',

  // ── Ingles (eng) ───────────────────────────────────────────────────────────
  hi: 'eng',
  hey: 'eng',
  hello: 'eng',
  helo: 'eng',
  yo: 'eng',
  sup: 'eng',
  hiya: 'eng',
  heya: 'eng',
  thanks: 'eng',
  'thank you': 'eng',
  thx: 'eng',
  cheers: 'eng',
  please: 'eng',
  'good morning': 'eng',
  'good night': 'eng',
  'good evening': 'eng',
  'good afternoon': 'eng',
  yeah: 'eng',
  yep: 'eng',
  yup: 'eng',
  nope: 'eng',
  bye: 'eng',
  goodbye: 'eng',
  'see you': 'eng',

  // ── Espanhol (spa) ─────────────────────────────────────────────────────────
  hola: 'spa',
  buenas: 'spa',
  'buenos dias': 'spa',
  'buenos días': 'spa',
  'buenas tardes': 'spa',
  'buenas noches': 'spa',
  'hola que tal': 'spa',
  'que tal': 'spa',
  'qué tal': 'spa',
  gracias: 'spa',
  'muchas gracias': 'spa',
  adios: 'spa',
  adiós: 'spa',
  'hasta luego': 'spa',

  // ── Frances (fra) ──────────────────────────────────────────────────────────
  salut: 'fra',
  bonjour: 'fra',
  bonsoir: 'fra',
  coucou: 'fra',
  merci: 'fra',
  'merci beaucoup': 'fra',
  'au revoir': 'fra',
  oui: 'fra',
  'ca va': 'fra',
  'ça va': 'fra',
  'comment ca va': 'fra',
  'comment ça va': 'fra',
  'bonne nuit': 'fra',

  // ── Alemao (deu) ───────────────────────────────────────────────────────────
  hallo: 'deu',
  servus: 'deu',
  moin: 'deu',
  'guten tag': 'deu',
  'guten morgen': 'deu',
  'guten abend': 'deu',
  'gute nacht': 'deu',
  danke: 'deu',
  'danke schön': 'deu',
  'danke schon': 'deu',
  tschüss: 'deu',
  tschuss: 'deu',
  'auf wiedersehen': 'deu',
  nein: 'deu',

  // ── Italiano (ita) ─────────────────────────────────────────────────────────
  ciao: 'ita',
  salve: 'ita',
  buongiorno: 'ita',
  buonasera: 'ita',
  buonanotte: 'ita',
  grazie: 'ita',
  'grazie mille': 'ita',
  prego: 'ita',
  arrivederci: 'ita',
  'ciao come stai': 'ita',
  'come stai': 'ita',

  // ── Neerlandes (nld) ───────────────────────────────────────────────────────
  hoi: 'nld',
  doei: 'nld',
  'dank je': 'nld',
  'dank u': 'nld',
  bedankt: 'nld',
  goedemorgen: 'nld',
  goedenavond: 'nld',
  'tot ziens': 'nld',

  // ── Outras linguas com voz Piper (saudacoes-chave) ─────────────────────────
  cześć: 'pol',
  czesc: 'pol',
  'dzień dobry': 'pol',
  'dzien dobry': 'pol',
  dziękuję: 'pol',
  dziekuje: 'pol',
  merhaba: 'tur',
  selam: 'tur',
  teşekkürler: 'tur',
  tesekkurler: 'tur',
  hej: 'swe',
  hejsan: 'swe',
  tack: 'swe',
  hei: 'fin',
  moikka: 'fin',
  kiitos: 'fin',
  hejsa: 'dan',
  tak: 'dan',
  'bună': 'ron',
  buna: 'ron',
  mulțumesc: 'ron',
  multumesc: 'ron',
  'bon dia': 'cat',
  gràcies: 'cat',
  gracies: 'cat',
};

/**
 * Tokens que podem LIDERAR uma frase curta (saudacao inicial). Quando o texto tem
 * poucas palavras e comeca por uma destas, assume-se a lingua da saudacao — resolve
 * "ola tudo bem", "hello there my friend", "ciao come stai" (onde o franc erra) sem
 * depender de casar a frase inteira. So SAUDACOES puras entram aqui (nao "sim"/"ok"),
 * para nao rotular mal frases que comecam por uma afirmacao.
 */
const GREETING_INITIAL = new Set<string>([
  'ola', 'olá', 'oi', 'oie', 'opa', 'alo', 'alô',
  'hi', 'hey', 'hello', 'helo', 'yo', 'hiya', 'heya', 'sup',
  'hola', 'buenas',
  'salut', 'bonjour', 'bonsoir', 'coucou',
  'hallo', 'servus', 'moin',
  'ciao', 'salve',
  'hoi',
  'cześć', 'czesc', 'merhaba', 'selam', 'hej', 'hejsan', 'hei', 'moikka',
]);

/** Nº maximo de palavras para aplicar a regra da saudacao-inicial. */
const MAX_GREETING_PHRASE_TOKENS = 4;

/**
 * Normaliza o texto para procura no lexico: minusculas, pontuacao/simbolos -> espaco,
 * espacos colapsados, trim. Mantem letras acentuadas e numeros. Ex.: "Olá, tudo bem?"
 * -> "olá tudo bem".
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deteta a lingua de texto CURTO por lexico de saudacoes/palavras comuns.
 * Devolve o codigo ISO 639-3 ou '' se nao reconhecer (o chamador cai no franc).
 *
 * Ordem: (1) frase inteira no lexico; (2) token unico no lexico; (3) frase curta
 * (<= 4 palavras) que COMECA por uma saudacao conhecida. PURO.
 */
export function lookupShortLang(text: string): string {
  const norm = normalize(text);
  if (!norm) return '';

  // (1) frase inteira (ex. "bom dia", "hola que tal").
  const whole = LEXICON[norm];
  if (whole) return whole;

  const tokens = norm.split(' ');

  // (2) token unico (ex. "ola", "hello").
  if (tokens.length === 1) return LEXICON[tokens[0]] ?? '';

  // (3) frase curta iniciada por saudacao (ex. "ola tudo bem", "ciao come stai").
  if (tokens.length <= MAX_GREETING_PHRASE_TOKENS && GREETING_INITIAL.has(tokens[0])) {
    return LEXICON[tokens[0]] ?? '';
  }

  return '';
}
