import { detectLangDetailed } from '../language/detect';
import { pickVoiceForLang } from '../language/voiceMap';
import { expandAbbreviations, splitEnglishSlang } from '../textCleaning/abbreviations';
import { restoreAccents, accentLangOfModel } from '../textCleaning/accents';
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
  /**
   * Memoria de lingua do user (T3.2): a ultima lingua detetada COM CONFIANCA. Quando
   * a deteccao da mensagem atual e AMBIGUA (fragmento curto), usa-se esta em vez do
   * palpite incerto do franc. Vazio/undefined = sem memoria (comportamento de hoje).
   */
  recentLang?: string;
}

export interface PreparedSpeech {
  /** Texto FALADO (girias expandidas + pronuncia), usado para a blocklist. */
  spoken: string;
  /** Pedido de sintese ja com a(s) voz(es) resolvida(s). */
  req: SynthRequest;
  /**
   * Lingua detetada COM CONFIANCA nesta mensagem (ISO 639-3), ou '' se ambigua/sem
   * texto-base. O chamador memoriza-a (rememberLang) para desambiguar as proximas
   * mensagens curtas do mesmo user.
   */
  learnedLang: string;
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
    // Voz FIXA: a língua vem da voz escolhida (não do texto) — restaura os acentos
    // dessa língua ("nao"->"não" se a voz for PT).
    // ORDEM: pronúncia da guild ANTES das gírias embutidas — assim uma /pronunciation
    // como btw->batata GANHA ao "by the way". Precedência final (o pessoal já foi
    // aplicado a montante no messageHandler): pessoal > /pronunciation > gírias.
    const spokenRaw = expandAbbreviations(applyPronunciation(input.personal, input.pronunciations));
    const spoken = restoreAccents(spokenRaw, accentLangOfModel(preferred));
    return { spoken, req: { text: spoken, model: preferred, speed, singleVoice: true }, learnedLang: '' };
  }

  // Deteccao LIGADA. Pronúncia da guild PRIMEIRO — ANTES de partir por gíria — para
  // que uma /pronunciation como btw->batata deixe de ser "gíria" e NÃO gere um
  // segmento EN separado (sai na voz base). Depois parte por gírias e expande cada
  // parte. Precedência: pessoal (a montante) > /pronunciation > gírias embutidas.
  const pronounced = applyPronunciation(input.personal, input.pronunciations);
  const rawSegs = splitEnglishSlang(pronounced);
  const proc0 = rawSegs.map((seg) => ({
    isEnglish: seg.isEnglish,
    text: expandAbbreviations(seg.text),
  }));

  // Lingua-base = deteccao SO da parte non-slang (as girias EN nao poluem). Deteta-se
  // sobre o texto SEM acentos restaurados (e o que temos); restauram-se DEPOIS.
  const baseText = proc0.filter((s) => !s.isEnglish).map((s) => s.text).join(' ');
  const { lang: detectedBase, confident } = detectLangDetailed(baseText);
  // Memoria adaptativa (T3.2): se a deteccao e AMBIGUA e ha uma lingua recente do user,
  // usa a recente (resolve "isto ta a funcionar" -> por depois de um "olá" confiante).
  // Se e confiante, e ELA que memorizamos (learnedLang) para as proximas curtas.
  const baseLang = !confident && input.recentLang ? input.recentLang : detectedBase;
  const learnedLang = confident ? detectedBase : '';

  // Restauro de acentos POR-SEGMENTO, na lingua de cada um (base p/ non-slang; as
  // girias EN nao tem dicionario -> no-op). Ex.: PT "nao"->"não", "amanha"->"amanhã".
  const procSegs = proc0.map((s) => ({
    isEnglish: s.isEnglish,
    text: restoreAccents(s.text, s.isEnglish ? 'eng' : baseLang),
  }));
  const spoken = procSegs.map((s) => s.text).join(' ');

  const hasEng = procSegs.some((s) => s.isEnglish);
  const hasOther = procSegs.some((s) => !s.isEnglish);

  // Sem girias EN (o caso comum): voz unica da lingua-base — identico ao resolveSynth
  // de hoje para texto non-slang. Cobre tambem `personal` vazio (procSegs [], spoken '',
  // sem girias): devolve um req single-voice sao com a voz preferida, sem crashar.
  if (!hasEng) {
    const model = pickVoiceForLang(baseLang, input.available, preferred);
    return { spoken, req: { text: spoken, model, speed }, learnedLang };
  }

  // So girias EN: voz unica inglesa.
  if (!hasOther) {
    const model = pickVoiceForLang('eng', input.available, preferred);
    return { spoken, req: { text: spoken, model, speed }, learnedLang };
  }

  // MISTURADO: cada segmento com a sua voz (giria -> EN, resto -> lingua-base). O
  // req.model/text de topo sao o fallback single-voice + base da cache.
  const segments = procSegs.map((s) => ({
    text: s.text,
    model: pickVoiceForLang(s.isEnglish ? 'eng' : baseLang, input.available, preferred),
  }));
  const baseModel = pickVoiceForLang(baseLang, input.available, preferred);
  return { spoken, req: { text: spoken, model: baseModel, speed, segments }, learnedLang };
}
