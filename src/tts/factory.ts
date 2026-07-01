// src/tts/factory.ts
import type { AppConfig } from '../config/index';
import type { TTSEngine } from './engine';
import { AudioCache } from './cache';
import { PiperEngine } from './piper';
import { NeuralEngine } from './neural';
import { MultiSegmentEngine } from './multiSegment';

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
    return new NeuralEngine(config.openaiApiKey, cache.withNamespace('neural'));
  }
  return new PiperEngine(config.piperPath, config.modelsDir, cache.withNamespace('piper'));
}

/**
 * P14.4 — decide o motor efetivo a partir da flag EXPERIMENTAL
 * `multilingualSegments` (default OFF):
 *   - OFF (default) -> devolve o `base` TAL E QUAL (identidade `===`). O caminho
 *     de sintese fica byte-a-byte o de hoje: voz unica para a frase toda.
 *   - ON            -> embrulha `base` num MultiSegmentEngine (mesmo contrato
 *     TTSEngine) que parte textos multi-lingua por-segmento e concatena os WAVs.
 *
 * Extraido para funcao PURA (sem I/O) para tornar a SELECAO testavel e provar a
 * invariante do caminho OFF de forma executavel (ver tests/factory.test.ts).
 */
export function selectEngine(
  base: TTSEngine,
  config: AppConfig,
  availableModels: string[],
  cache: AudioCache,
): TTSEngine {
  if (!config.multilingualSegments) return base;
  return new MultiSegmentEngine(base, availableModels, cache);
}
