import { baseCodeOf } from '../util';

/**
 * Frases CURTAS (3-6 palavras) por lingua-base, para o jogo da Velocidade Estupida: o
 * Vozen le-as MUITO depressa e o 1o a escrever o que ouviu ganha. Curtas de proposito —
 * a graca e decifrar, nao transcrever um paragrafo. Ditas na voz default da guild.
 */
export const SHORT_PHRASES: Record<string, string[]> = {
  en: [
    'the cat sat on the mat',
    'i love pizza with cheese',
    'the sun is very bright today',
    'my dog runs really fast',
    'we are going to the beach',
    'she sings a happy song',
    'the coffee is too hot',
    'birds fly over the river',
  ],
  pt: [
    'o gato dormiu no sofa',
    'eu adoro pizza com queijo',
    'o sol esta muito quente hoje',
    'o meu cao corre depressa',
    'vamos todos ate a praia',
    'ela canta uma cancao alegre',
    'o cafe esta demasiado quente',
    'os passaros voam sobre o rio',
  ],
  es: [
    'el gato duerme en el sofa',
    'me encanta la pizza con queso',
    'el sol esta muy caliente hoy',
    'mi perro corre muy rapido',
    'vamos todos a la playa',
    'ella canta una cancion alegre',
    'el cafe esta demasiado caliente',
    'los pajaros vuelan sobre el rio',
  ],
  fr: [
    'le chat dort sur le canape',
    'jadore la pizza au fromage',
    'le soleil est tres chaud aujourdhui',
    'mon chien court tres vite',
    'nous allons tous a la plage',
    'elle chante une chanson joyeuse',
    'le cafe est trop chaud',
    'les oiseaux volent sur la riviere',
  ],
  de: [
    'die katze schlaeft auf dem sofa',
    'ich liebe pizza mit kaese',
    'die sonne ist heute sehr heiss',
    'mein hund rennt sehr schnell',
    'wir gehen alle an den strand',
    'sie singt ein frohes lied',
    'der kaffee ist zu heiss',
    'die voegel fliegen ueber den fluss',
  ],
  it: [
    'il gatto dorme sul divano',
    'adoro la pizza al formaggio',
    'oggi il sole e molto caldo',
    'il mio cane corre veloce',
    'andiamo tutti alla spiaggia',
    'lei canta una canzone allegra',
    'il caffe e troppo caldo',
    'gli uccelli volano sul fiume',
  ],
};

export interface PhraseSource {
  base: string;
  model: string;
  phrases: string[];
}

/** Escolhe frases curtas + voz: lingua da voz default da guild se tiver banco; senao EN. */
export function pickPhraseSource(defaultVoice: string, availableModels: string[]): PhraseSource {
  const base = baseCodeOf(defaultVoice);
  if (SHORT_PHRASES[base]?.length) {
    return { base, model: defaultVoice, phrases: SHORT_PHRASES[base] };
  }
  const enModel = availableModels.find((m) => baseCodeOf(m) === 'en') ?? defaultVoice;
  return { base: 'en', model: enModel, phrases: SHORT_PHRASES.en };
}
