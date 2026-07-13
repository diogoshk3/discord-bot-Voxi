// src/voice/transcriptRouting.ts
//
// Routing PURO do STT (Fase 4): do texto cru que o sidecar Whisper devolve até à mensagem
// que vai para o canal. Sem IO, sem rede — testável em isolamento. A decisão de POSTAR é
// separada da FORMATAÇÃO para o chamador poder saltar utterances vazias sem construir nada.

/** Apara e colapsa espaços/quebras internas num único espaço. */
export function cleanTranscriptText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Vale a pena postar? O Whisper devolve "" (ou só espaço) para silêncio/ruído que o
 * vad_filter deixou passar — não poluímos o canal com isso.
 */
export function isTranscribable(raw: string): boolean {
  return cleanTranscriptText(raw).length > 0;
}

/**
 * Neutraliza pings de MASSA (@everyone/@here) inserindo um zero-width space a seguir ao @.
 * Defesa em profundidade: o envio já deve usar allowedMentions:{parse:[]}, mas uma
 * transcrição nunca deve conseguir tocar toda a gente mesmo que essa config falhe.
 */
function defuseMentions(s: string): string {
  return s.replace(/@(everyone|here)/gi, '@​$1');
}

/** Mensagem de canal: "**Nome:** texto". Apara o texto e desarma pings de massa. */
export function formatTranscript(displayName: string, text: string): string {
  return `**${defuseMentions(displayName)}:** ${defuseMentions(cleanTranscriptText(text))}`;
}
