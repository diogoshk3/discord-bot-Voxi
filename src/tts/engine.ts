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
  // Partes (texto, voz) JA RESOLVIDAS por-segmento para a sintese MISTURADA de
  // linguas (ex. base numa lingua + girias EN numa voz inglesa). Quando presente e
  // o MultiSegmentEngine esta ativo, cada parte e sintetizada com o seu proprio
  // `model` e os WAVs sao concatenados. O `text`/`model` de topo continuam a ser o
  // fallback single-voice (flag do motor OFF) e a base da chave de cache.
  segments?: { text: string; model: string }[];
  // MOTOR escolhido PELO UTILIZADOR para esta fala: 'google' (gTTS, default) ou
  // 'piper' (self-host). Ausente/undefined = 'google'. O PerUserEngineRouter despacha
  // por este campo; entra na chave de cache (só quando 'piper') para não cruzar áudio
  // entre users de motores diferentes.
  engine?: 'google' | 'piper';
}

export interface TTSEngine {
  synth(req: SynthRequest): Promise<string>; // devolve caminho absoluto de um .wav
}
