// ÊNFASE DE VOLUME — "fala mais alto quando há ! ou MAIÚSCULAS".
//
// PORQUÊ AQUI E NÃO NO MOTOR: nem o gTTS grátis (endpoint translate_tts, só texto
// simples — ignora SSML/prosódia) nem o Piper expõem controlo de prosódia por
// pontuação. A entoação "expressiva" que se ouve em espanhol é a voz nativa do
// Google, não uma feature — e varia por língua (o PT soa plano). Para dar ênfase
// CONSISTENTE em TODAS as línguas e TODOS os motores, aplicamos um ganho de VOLUME
// ao áudio JÁ sintetizado, na reprodução (AudioResource inlineVolume no player).
//
// É "mais alto", não "voz mais expressiva" — foi o que o utilizador pediu. O ganho é
// calculado sobre o texto ORIGINAL (com maiúsculas e `!`), antes de o gTTS o passar
// por deCapsForGoogle (que baixa as maiúsculas só para o motor não soletrar siglas).

// Detecção de "grito": uma corrida de 2+ maiúsculas (ex.: "PARA", "AJUDA"). NÃO global
// (/g é stateful em .test() via lastIndex — reutilizar partilharia estado e daria
// resultados errados entre chamadas). \p{M} apanha diacríticos combinados (ÁÁ).
const RE_ALLCAPS_RUN = /\p{Lu}[\p{Lu}\p{M}]+/u;

// Ganhos de amplitude (multiplicadores lineares). Modestos de propósito: o WAV do
// Piper/gTTS não vem no máximo, mas passar de ~1.4 arrisca clipping/distorção.
const GAIN_NONE = 1;
const GAIN_SOFT = 1.22; // um sinal de ênfase (um `!` ou uma palavra em maiúsculas)
const GAIN_STRONG = 1.4; // ênfase forte (!! ou mais, ou maiúsculas + `!`)

/**
 * Ganho de volume para uma fala, a partir do seu texto. 1.0 = normal (sem ganho).
 * >1.0 = mais alto. Puro e determinístico (testável isolado). Engine-agnóstico:
 * o player aplica-o na reprodução, por isso vale para gTTS, Piper e clone.
 */
export function emphasisGain(text: string): number {
  if (!text) return GAIN_NONE;
  const bangs = (text.match(/!/g) ?? []).length;
  const shout = RE_ALLCAPS_RUN.test(text);
  if (bangs === 0 && !shout) return GAIN_NONE;
  // Forte: muitos `!`, ou gritar E exclamar ao mesmo tempo.
  if (bangs >= 2 || (shout && bangs >= 1)) return GAIN_STRONG;
  return GAIN_SOFT;
}
