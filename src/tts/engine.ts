// src/tts/engine.ts
export interface SynthRequest {
  text: string;
  model: string;
  speed: number;
  // Milissegundos de silencio a PREPENDER ao audio sintetizado (default: nenhum).
  // Usado p.ex. pelo /joke para criar uma pausa real ANTES do riso (o riso e uma
  // fala separada com leadSilenceMs). Opcional: ausente => output inalterado.
  leadSilenceMs?: number;
  // Quando true, DESLIGA a sintese multi-lingua por-segmento para ESTE pedido: o
  // texto e lido verbatim com `model`, sem ser partido por lingua. Usado quando a
  // voz foi DELIBERADAMENTE escolhida (ex. /voice preview, /joke, /laugh, ou o
  // toggle de deteccao por-user desligado) e a deteccao NAO deve sobrepor-se.
  // Ausente/false => comportamento normal (parte por segmento quando ha >1 lingua).
  singleVoice?: boolean;
}

export interface TTSEngine {
  synth(req: SynthRequest): Promise<string>; // devolve caminho absoluto de um .wav
}
