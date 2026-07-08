import { detectLangDetailed } from '../language/detect';
import { pickVoiceForLang } from '../language/voiceMap';
import {
  langKeyOfModel,
  spokenPhrasesFor,
  buildMediaSuffix,
  type MediaItem,
} from '../language/spokenPhrases';
import { expandAbbreviations, splitEnglishSlang } from '../textCleaning/abbreviations';
import { restoreAccents, accentLangOfModel } from '../textCleaning/accents';
import { applyPronunciation, type PronunciationEntry } from '../textCleaning/pronunciation';
import { redactBlocked } from '../moderation/filter';
import type { SynthRequest } from '../tts/engine';

/** Há pelo menos uma letra ou número (algo legível para falar)? */
export function hasReadableText(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}

/**
 * Aplica a REDAÇÃO da blocklist a um SynthRequest: remove as palavras bloqueadas do
 * texto a sintetizar (req.text) e de cada segmento (síntese multi-voz), mantendo o
 * resto — o Vozen lê a mensagem SEM dizer as palavras banidas. Segmentos que ficam sem
 * nada legível são retirados. Blocklist vazia -> req inalterado. Se o resultado ficar
 * sem nada legível, o chamador deteta (hasReadableText) e não fala. PURA.
 */
export function redactRequest(req: SynthRequest, blocklist: string[]): SynthRequest {
  if (blocklist.length === 0) return req;
  const text = redactBlocked(req.text, blocklist);
  const segments = req.segments
    ?.map((s) => ({ ...s, text: redactBlocked(s.text, blocklist) }))
    .filter((s) => hasReadableText(s.text));
  return { ...req, text, segments: segments && segments.length > 0 ? segments : undefined };
}

export interface PrepareSpeechInput {
  /** Texto JA com as abreviaturas PESSOAIS do user aplicadas (antes da expansao EN). */
  personal: string;
  /** Pronúncias PESSOAIS do autor (getUserPronunciations) — individuais desde o plano v4. */
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
  /**
   * Media a ANUNCIAR no fim da fala (links, gifs, anexos por tipo, stickers). É
   * acrescentada DEPOIS de resolvida a voz e localizada na LÍNGUA DESSA voz (ex.
   * gif -> "um gif" em voz PT). Não passa por gírias/pronúncia (são palavras nossas,
   * já corretas) e NÃO entra na deteção de língua (esta corre só sobre `personal`).
   */
  media?: MediaItem[];
  /**
   * Nome do autor a anunciar ANTES da mensagem — o "xsaid": "{nome} disse …". Vazio/
   * undefined = sem anúncio (xsaid OFF ou não aplicável, ex. /tts). O "disse" é
   * localizado na língua da voz (spokenPhrases.said); o nome sai tal e qual.
   */
  announceSpeaker?: string;
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
/**
 * Teto RÍGIDO de caracteres do texto que vai para a SÍNTESE. O cleanText limita o texto
 * de ENTRADA (`maxChars` ≤ 2000), mas as expansões a jusante (pronúncia, gírias EN,
 * acentos, prefixo xsaid + sufixo de media) CRESCEM a string sem re-cap. Sem este teto,
 * uma mensagem de 2000 chars de gíria ("imho imho…") expandia ~5× → ~10k chars →
 * chunkText partia isso em ~50 pedidos HTTP ao gTTS por UMA mensagem → 429 da Google
 * para a guild toda (amplificação/auto-DoS). 2400 dá folga para as expansões legítimas
 * sobre um input no máximo (2000) + anúncios, e limita o fan-out a ~12 pedidos/mensagem.
 */
const MAX_SYNTH_CHARS = 2400;

/**
 * Aplica o teto de saída ao `req` (texto e segmentos) — o que efetivamente é
 * sintetizado. NÃO mexe no `spoken` (usado pela blocklist a jusante), para não perder
 * precisão na verificação de palavras bloqueadas. Trunca por CODE POINT (surrogate-safe).
 */
function capSynth(result: PreparedSpeech): PreparedSpeech {
  const text = result.req.text;
  if (text.length <= MAX_SYNTH_CHARS) return result;
  const req: SynthRequest = {
    ...result.req,
    text: Array.from(text).slice(0, MAX_SYNTH_CHARS).join(''),
  };
  if (req.segments && req.segments.length > 0) {
    const kept: { text: string; model: string }[] = [];
    let budget = MAX_SYNTH_CHARS;
    for (const seg of req.segments) {
      if (budget <= 0) break;
      const cps = Array.from(seg.text);
      if (cps.length <= budget) {
        kept.push(seg);
        budget -= cps.length;
      } else {
        kept.push({ text: cps.slice(0, budget).join(''), model: seg.model });
        budget = 0;
      }
    }
    req.segments = kept;
  }
  return { ...result, req };
}

export function prepareSpeech(input: PrepareSpeechInput): PreparedSpeech {
  return capSynth(decorateAnnouncements(prepareSpeechCore(input), input));
}

/**
 * Envolve a fala já resolvida com os ANÚNCIOS, ambos localizados na língua da VOZ-BASE
 * (`req.model`) — a mesma voz que fala a mensagem di-los:
 *   - PREFIXO xsaid: "{nome} {said}" (quem falou), quando `announceSpeaker` presente.
 *   - SUFIXO media:  "…um gif" no fim, quando há `media`.
 * Resultado: "{nome} disse {corpo} {media}". No caminho MISTURADO (com `segments`) os
 * anúncios entram como segmentos extra na voz-base — senão não seriam falados (o motor
 * usa `segments`, não `text`). `text` leva sempre tudo (fallback single-voice + base da
 * cache). Corpo vazio (ex. só um gif) -> "{nome} disse um gif". PURA. Sem anúncios ->
 * devolve o resultado intacto.
 */
function decorateAnnouncements(result: PreparedSpeech, input: PrepareSpeechInput): PreparedSpeech {
  const phrases = spokenPhrasesFor(langKeyOfModel(result.req.model));
  const name = input.announceSpeaker?.trim();
  const prefix = name ? `${name} ${phrases.said}` : '';
  const suffix =
    input.media && input.media.length > 0 ? buildMediaSuffix(input.media, phrases) : '';
  if (!prefix && !suffix) return result;

  const spoken = [prefix, result.spoken, suffix].filter((s) => s && s.length > 0).join(' ');
  const req: SynthRequest = { ...result.req, text: spoken };
  if (req.segments && req.segments.length > 0) {
    const model = result.req.model;
    req.segments = [
      ...(prefix ? [{ text: prefix, model }] : []),
      ...req.segments,
      ...(suffix ? [{ text: suffix, model }] : []),
    ];
  }
  return { ...result, spoken, req };
}

function prepareSpeechCore(input: PrepareSpeechInput): PreparedSpeech {
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
    return {
      spoken,
      req: { text: spoken, model: preferred, speed, singleVoice: true },
      learnedLang: '',
    };
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
  const baseText = proc0
    .filter((s) => !s.isEnglish)
    .map((s) => s.text)
    .join(' ');
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
