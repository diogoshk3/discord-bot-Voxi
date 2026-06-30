import { detectLang } from '../language/detect';
import { pickVoice } from '../language/voiceMap';
import type { SynthRequest } from '../tts/engine';

export interface ResolveSynthInput {
  text: string;
  userVoice: { model: string; speed: number } | null;
  available: string[];
  defaultVoice: string;
  defaultSpeed: number;
}

export function resolveSynth(input: ResolveSynthInput): SynthRequest {
  if (input.userVoice) {
    return { text: input.text, model: input.userVoice.model, speed: input.userVoice.speed };
  }
  const lang = detectLang(input.text);
  const model = pickVoice(lang, input.available, input.defaultVoice);
  return { text: input.text, model, speed: input.defaultSpeed };
}
