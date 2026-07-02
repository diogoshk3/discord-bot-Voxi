import { detectLang } from '../language/detect';
import { pickVoiceForLang } from '../language/voiceMap';
import { expandAbbreviations, splitEnglishSlang } from '../textCleaning/abbreviations';
import { applyPronunciation, type PronunciationEntry } from '../textCleaning/pronunciation';
import type { SynthRequest } from '../tts/engine';

export interface PrepareSpeechInput {
  /** Texto JA com as abreviaturas PESSOAIS do user aplicadas (antes da expansao EN). */
  personal: string;
  /** Dicionario de pronuncia da guild (getPronunciations). */
  pronunciations: PronunciationEntry[];
  userVoice: { model: string; speed: number } | null;
  available: string[];
  /** Voz default por-guild (`default_voice`); vazio = a guild nao definiu. */
  guildDefaultVoice?: string;
  /** Voz default global do .env (DEFAULT_VOICE). */
  defaultVoice: string;
  defaultSpeed: number;
  /** Toggle da DETECAO AUTOMATICA de lingua por-user (ON => deteta; OFF => voz fixa). */
  autoDetect: boolean;
}

export interface PreparedSpeech {
  /** Texto FALADO (girias expandidas + pronuncia), usado para a blocklist. */
  spoken: string;
  /** Pedido de sintese ja com a(s) voz(es) resolvida(s). */
  req: SynthRequest;
}

/**
 * Transforma o texto (ja com abreviaturas pessoais) num SynthRequest, resolvendo a
 * voz — e, quando a deteccao esta ON e a mensagem MISTURA uma lingua-base com girias
 * EN conhecidas (btw, lol, omg...), produz VOZES MISTURADAS: a parte non-slang e
 * detetada por si e falada na voz da lingua detetada; as girias EN sao um segmento
 * SEPARADO em voz inglesa. Substitui o "btw"->"by the way" a poluir a deteccao e a
 * ler a mensagem toda numa voz (muitas vezes errada).
 *
 * A pronuncia acontece AQUI (antes da blocklist a montante correr sobre `spoken`).
 * PURA: sem efeitos secundarios.
 */
export function prepareSpeech(input: PrepareSpeechInput): PreparedSpeech {
  const speed = input.userVoice ? input.userVoice.speed : input.defaultSpeed;
  const preferred =
    (input.userVoice && input.userVoice.model) ||
    input.guildDefaultVoice ||
    input.defaultVoice ||
    'en_US-amy-medium';

  // Deteccao DESLIGADA: voz FIXA preferida verbatim, singleVoice, sem detetar a
  // lingua nem partir por segmento. Identico ao resolveSynth (autoDetect:false).
  if (input.autoDetect === false) {
    const spoken = applyPronunciation(expandAbbreviations(input.personal), input.pronunciations);
    return { spoken, req: { text: spoken, model: preferred, speed, singleVoice: true } };
  }

  // Deteccao LIGADA: parte por girias EN e processa cada parte (expansao + pronuncia).
  const rawSegs = splitEnglishSlang(input.personal);
  const procSegs = rawSegs.map((seg) => ({
    isEnglish: seg.isEnglish,
    text: applyPronunciation(expandAbbreviations(seg.text), input.pronunciations),
  }));
  const spoken = procSegs.map((s) => s.text).join(' ');

  // Lingua-base = deteccao SO da parte non-slang (as girias EN nao poluem).
  const baseText = procSegs.filter((s) => !s.isEnglish).map((s) => s.text).join(' ');
  const baseLang = detectLang(baseText);

  const hasEng = procSegs.some((s) => s.isEnglish);
  const hasOther = procSegs.some((s) => !s.isEnglish);

  // Sem girias EN (o caso comum): voz unica da lingua-base — identico ao resolveSynth
  // de hoje para texto non-slang. Cobre tambem `personal` vazio (procSegs [], spoken '',
  // sem girias): devolve um req single-voice sao com a voz preferida, sem crashar.
  if (!hasEng) {
    const model = pickVoiceForLang(baseLang, input.available, preferred);
    return { spoken, req: { text: spoken, model, speed } };
  }

  // So girias EN: voz unica inglesa.
  if (!hasOther) {
    const model = pickVoiceForLang('eng', input.available, preferred);
    return { spoken, req: { text: spoken, model, speed } };
  }

  // MISTURADO: cada segmento com a sua voz (giria -> EN, resto -> lingua-base). O
  // req.model/text de topo sao o fallback single-voice + base da cache.
  const segments = procSegs.map((s) => ({
    text: s.text,
    model: pickVoiceForLang(s.isEnglish ? 'eng' : baseLang, input.available, preferred),
  }));
  const baseModel = pickVoiceForLang(baseLang, input.available, preferred);
  return { spoken, req: { text: spoken, model: baseModel, speed, segments } };
}
