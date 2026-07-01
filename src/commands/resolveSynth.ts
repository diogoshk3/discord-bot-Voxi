import { detectLang } from '../language/detect';
import { pickVoiceForLang } from '../language/voiceMap';
import type { SynthRequest } from '../tts/engine';

export interface ResolveSynthInput {
  text: string;
  userVoice: { model: string; speed: number } | null;
  available: string[];
  /** Voz default por-guild (`default_voice`); vazio = a guild nao definiu. */
  guildDefaultVoice?: string;
  /** Voz default global do .env (DEFAULT_VOICE). */
  defaultVoice: string;
  defaultSpeed: number;
  /**
   * Codigo franc (ISO 639-3) que FORCA a lingua para a escolha de voz, ignorando o
   * `detectLang` do texto. Usado quando a mensagem e SO girias EN ("brb", "omg lol"):
   * o texto expandido pode nao detetar como 'eng' de forma fiavel, mas sabemos que e
   * ingles. Vazio/undefined = comportamento normal (detetar a lingua do texto).
   */
  forceLang?: string;
}

/**
 * A LINGUA DA MENSAGEM DECIDE A VOZ.
 *
 * Deteta-se SEMPRE a lingua do texto. A voz PREFERIDA — por precedencia:
 *   voz guardada do user > default_voice da guild (se nao-vazio) >
 *   config.defaultVoice (.env) > 'en_US-amy-medium'
 * — e honrada quando ja esta na lingua detetada; caso contrario escolhe-se uma
 * voz correta da lingua detetada (e se nao houver modelo para essa lingua,
 * cai-se na preferida). Assim uma voz fixa (ex. via /voice set) nunca acaba a
 * ler texto de outra lingua (que sairia "a comer as palavras").
 *
 * Velocidade: quando ha voz de user usa-se `userVoice.speed`; senao `defaultSpeed`.
 */
export function resolveSynth(input: ResolveSynthInput): SynthRequest {
  // forceLang (quando presente) sobrepoe-se a deteccao: o texto e SO girias EN e
  // sabemos a lingua com certeza, por isso nao dependemos do `detectLang` (que em
  // texto curto pode devolver '').
  const lang = input.forceLang || detectLang(input.text);
  const speed = input.userVoice ? input.userVoice.speed : input.defaultSpeed;
  const preferred =
    (input.userVoice && input.userVoice.model) ||
    input.guildDefaultVoice ||
    input.defaultVoice ||
    'en_US-amy-medium';
  const model = pickVoiceForLang(lang, input.available, preferred);
  return { text: input.text, model, speed };
}
