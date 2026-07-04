// src/tts/perUserRouter.ts
//
// Despacha cada síntese para o motor que o UTILIZADOR escolheu (`req.engine`): 'piper'
// -> Piper (self-host, local), qualquer outro / ausente -> Google (gTTS, o default).
// Ambos os motores são construídos no arranque; o router só encaminha. Mesmo contrato
// TTSEngine, por isso vive por baixo do MultiSegmentEngine (cada segmento herda o
// `engine` da mensagem — ver multiSegment.ts).

import type { SynthRequest, TTSEngine } from './engine';

export class PerUserEngineRouter implements TTSEngine {
  constructor(
    private readonly google: TTSEngine,
    private readonly piper: TTSEngine,
  ) {}

  synth(req: SynthRequest): Promise<string> {
    return (req.engine === 'piper' ? this.piper : this.google).synth(req);
  }
}
