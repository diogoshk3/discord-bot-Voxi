import { baseCodeOf } from '../util';

/**
 * Bancos de palavras por lingua-base para os jogos de escrita (Ditado, Soletrado,
 * Sotaque Trocado). Palavras comuns, escreviveis e sem ambiguidade quando ditas em
 * voz alta. A lingua usada e a da VOZ DEFAULT da guild (se tiver banco); senao cai no
 * ingles. Ter mais bancos do que vozes instaladas e inofensivo.
 */
export const WORD_BANK: Record<string, string[]> = {
  en: [
    'computer', 'elephant', 'rainbow', 'guitar', 'mountain', 'chocolate', 'umbrella',
    'butterfly', 'adventure', 'library', 'pineapple', 'dinosaur', 'telescope', 'kangaroo',
    'strawberry', 'volcano',
  ],
  pt: [
    'computador', 'elefante', 'arco-iris', 'guitarra', 'montanha', 'chocolate', 'guarda-chuva',
    'borboleta', 'aventura', 'biblioteca', 'ananas', 'dinossauro', 'telescopio', 'canguru',
    'morango', 'vulcao',
  ],
  es: [
    'ordenador', 'elefante', 'arcoiris', 'guitarra', 'montana', 'chocolate', 'paraguas',
    'mariposa', 'aventura', 'biblioteca', 'piña', 'dinosaurio', 'telescopio', 'canguro',
    'fresa', 'volcan',
  ],
  fr: [
    'ordinateur', 'elephant', 'arcenciel', 'guitare', 'montagne', 'chocolat', 'parapluie',
    'papillon', 'aventure', 'bibliotheque', 'ananas', 'dinosaure', 'telescope', 'kangourou',
    'fraise', 'volcan',
  ],
  de: [
    'computer', 'elefant', 'regenbogen', 'gitarre', 'berg', 'schokolade', 'regenschirm',
    'schmetterling', 'abenteuer', 'bibliothek', 'ananas', 'dinosaurier', 'teleskop', 'kaenguru',
    'erdbeere', 'vulkan',
  ],
  it: [
    'computer', 'elefante', 'arcobaleno', 'chitarra', 'montagna', 'cioccolato', 'ombrello',
    'farfalla', 'avventura', 'biblioteca', 'ananas', 'dinosauro', 'telescopio', 'canguro',
    'fragola', 'vulcano',
  ],
};

export interface WordSource {
  base: string;
  /** Voz (id de modelo) com que dizer/soletrar as palavras. */
  model: string;
  words: string[];
}

/**
 * Escolhe o banco de palavras + a voz: a lingua da VOZ DEFAULT da guild se tiver banco
 * E voz instalada; senao ingles (com uma voz inglesa instalada, ou a default como
 * ultimo recurso). PURA.
 */
export function pickWordSource(defaultVoice: string, availableModels: string[]): WordSource {
  const base = baseCodeOf(defaultVoice);
  if (WORD_BANK[base]?.length) {
    return { base, model: defaultVoice, words: WORD_BANK[base] };
  }
  const enModel = availableModels.find((m) => baseCodeOf(m) === 'en') ?? defaultVoice;
  return { base: 'en', model: enModel, words: WORD_BANK.en };
}

/**
 * Palavras para um jogo de TEXTO (sem voz): pela lingua da INTERFACE da guild (locale),
 * nao pela voz. Fallback a ingles. Devolve so palavras SEM hifen/espaco (limpas para a
 * Forca). PURA.
 */
export function wordsForLocale(locale: string): { base: string; words: string[] } {
  const base = locale.split('-')[0].toLowerCase();
  const bank = WORD_BANK[base] ?? WORD_BANK.en;
  const clean = bank.filter((w) => !w.includes('-') && !w.includes(' '));
  return { base: WORD_BANK[base] ? base : 'en', words: clean };
}
