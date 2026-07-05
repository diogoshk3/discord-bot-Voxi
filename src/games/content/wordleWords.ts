/**
 * Palavras de 5 LETRAS para o Termo/Wordle, por lingua-base da INTERFACE da guild.
 * Sem acentos (a comparacao e feita sobre a forma normalizada) e exatamente 5 letras.
 * Fallback a ingles. Ter mais linguas do que o necessario e inofensivo.
 */
export const WORDLE_WORDS: Record<string, string[]> = {
  en: [
    'apple', 'beach', 'chair', 'dance', 'eagle', 'flame', 'grape', 'house', 'juice', 'lemon',
    'money', 'night', 'ocean', 'piano', 'queen', 'river', 'stone', 'table', 'water', 'zebra',
    'bread', 'cloud', 'dream', 'earth', 'ghost',
  ],
  pt: [
    'praia', 'gato', 'livro', 'porta', 'noite', 'verde', 'campo', 'fruta', 'letra', 'mundo',
    'plano', 'ponte', 'ramo', 'sonho', 'terra', 'vento', 'carta', 'festa', 'lugar', 'tempo',
    'pedra', 'nuvem', 'praca', 'forte', 'largo',
  ],
  es: [
    'playa', 'gato', 'libro', 'perro', 'noche', 'verde', 'campo', 'fruta', 'letra', 'mundo',
    'plato', 'punto', 'reloj', 'sueno', 'tierra', 'viento', 'carta', 'fiesta', 'lugar', 'tiempo',
    'piedra', 'nubes', 'plaza', 'fuego', 'largo',
  ],
  fr: [
    'plage', 'chat', 'livre', 'porte', 'verre', 'monde', 'fruit', 'lettre', 'point', 'reine',
    'terre', 'vente', 'carte', 'ville', 'temps', 'pierre', 'place', 'jaune', 'blanc', 'route',
    'arbre', 'fleur', 'chien', 'table', 'ecole',
  ],
  de: [
    'apfel', 'stuhl', 'blume', 'katze', 'nacht', 'gruen', 'feld', 'frau', 'welt', 'punkt',
    'erde', 'karte', 'stadt', 'zeit', 'stein', 'platz', 'gelb', 'weiss', 'baum', 'hund',
    'tisch', 'wasser', 'licht', 'brot', 'vogel',
  ],
};

/** Palavras de 5 letras para o locale (base) da guild; fallback a ingles. PURA. */
export function pickWordleWords(locale: string): { base: string; words: string[] } {
  const base = locale.split('-')[0].toLowerCase();
  const bank = WORDLE_WORDS[base] ?? WORDLE_WORDS.en;
  // Guarda-defensivo: so palavras com EXATAMENTE 5 letras (o jogo assume 5).
  const five = bank.filter((w) => w.length === 5);
  return { base: WORDLE_WORDS[base] ? base : 'en', words: five.length ? five : WORDLE_WORDS.en.filter((w) => w.length === 5) };
}
