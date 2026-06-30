// src/tts/factory.ts
import type { AppConfig } from '../config/index';
import type { TTSEngine } from './engine';
import { AudioCache } from './cache';
import { PiperEngine } from './piper';
import { NeuralEngine } from './neural';

/**
 * Seleciona o motor TTS a partir da config.
 *   - 'piper'  (default) -> PiperEngine (self-host, sem API key).
 *   - 'neural'           -> NeuralEngine (OpenAI tts-1); EXIGE openaiApiKey.
 *
 * Se ttsEngine==='neural' sem openaiApiKey, falha rapido com mensagem clara
 * (apanhado pelo main().catch -> exit(1)). A sintese neural real e verificacao
 * ao vivo pendente; o que aqui se testa e a SELECAO.
 */
export function createEngine(config: AppConfig, cache: AudioCache): TTSEngine {
  if (config.ttsEngine === 'neural') {
    if (!config.openaiApiKey) {
      throw new Error('TTS_ENGINE=neural requer OPENAI_API_KEY');
    }
    return new NeuralEngine(config.openaiApiKey, cache);
  }
  return new PiperEngine(config.piperPath, config.modelsDir, cache);
}
