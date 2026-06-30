import { detectLang } from '../language/detect';
import { pickVoice } from '../language/voiceMap';
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
}

/**
 * Precedencia de voz (sem voz de user):
 *   voz guardada do user > default_voice da guild (se nao-vazio) >
 *   config.defaultVoice (.env) > 'en_US-amy-medium'.
 * A voz resultante entra como `fallback` da deteccao de lingua: se a lingua
 * tiver modelo correspondente em `available`, esse vence; senao usa-se o fallback.
 */
export function resolveSynth(input: ResolveSynthInput): SynthRequest {
  if (input.userVoice) {
    return { text: input.text, model: input.userVoice.model, speed: input.userVoice.speed };
  }
  const fallback = input.guildDefaultVoice || input.defaultVoice || 'en_US-amy-medium';
  const lang = detectLang(input.text);
  const model = pickVoice(lang, input.available, fallback);
  return { text: input.text, model, speed: input.defaultSpeed };
}
