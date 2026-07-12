// src/tts/perUserRouter.ts
//
// Despacha cada síntese para o motor que o UTILIZADOR escolheu (`req.engine`): 'piper'
// -> Piper (self-host, local), 'kokoro' -> Kokoro (neural opt-in; já embrulhado num
// RouterEngine que cai no gTTS nas línguas que não suporta), 'gcloud' -> Google Cloud
// TTS Standard (perk Premium; também já embrulhado num RouterEngine que cai no gTTS por
// falha/orçamento — e SEM key é o próprio gTTS), qualquer outro / ausente -> Google
// (gTTS, o default de toda a gente). Os motores são construídos no arranque; o router só
// encaminha. Mesmo contrato TTSEngine, por isso vive por baixo do MultiSegmentEngine
// (cada segmento herda o `engine` da mensagem — ver multiSegment.ts).

import type { SynthRequest, TTSEngine } from './engine';
import { log } from '../logging/logger';

export class PerUserEngineRouter implements TTSEngine {
  constructor(
    private readonly google: TTSEngine,
    private readonly piper: TTSEngine,
    private readonly kokoro: TTSEngine,
    private readonly gcloud: TTSEngine,
  ) {}

  async synth(req: SynthRequest): Promise<string> {
    if (req.engine === 'kokoro') return this.kokoro.synth(req);
    if (req.engine === 'gcloud') return this.gcloud.synth(req);
    if (req.engine !== 'piper') return this.google.synth(req);

    try {
      return await this.piper.synth(req);
    } catch (err) {
      log.warn(
        `[tts] Piper falhou para ${req.model}; fallback para Google: ${(err as Error).message}`,
      );
      return this.google.synth({ ...req, engine: 'google' });
    }
  }
}
