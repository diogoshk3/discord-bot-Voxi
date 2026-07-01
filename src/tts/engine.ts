// src/tts/engine.ts
export interface SynthRequest {
  text: string;
  model: string;
  speed: number;
  // Milissegundos de silencio a PREPENDER ao audio sintetizado (default: nenhum).
  // Usado p.ex. pelo /joke para criar uma pausa real ANTES do riso (o riso e uma
  // fala separada com leadSilenceMs). Opcional: ausente => output inalterado.
  leadSilenceMs?: number;
}

export interface TTSEngine {
  synth(req: SynthRequest): Promise<string>; // devolve caminho absoluto de um .wav
}
