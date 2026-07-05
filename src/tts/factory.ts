// src/tts/factory.ts
import type { AppConfig } from '../config/index';
import type { TTSEngine } from './engine';
import { AudioCache } from './cache';
import { PiperEngine } from './piper';
import { NeuralEngine } from './neural';
import { GTTSEngine } from './gtts';
import { MultiSegmentEngine } from './multiSegment';
import { RouterEngine } from './router';
import { PerUserEngineRouter } from './perUserRouter';
import { CircuitBreakerEngine } from './circuitBreaker';
import { log } from '../logging/logger';

/**
 * Seleciona o motor TTS a partir da config.
 *   - 'piper'  (default) -> PiperEngine (self-host, sem API key).
 *   - 'neural'           -> NeuralEngine (OpenAI tts-1); EXIGE openaiApiKey.
 *
 * Se ttsEngine==='neural' sem openaiApiKey, falha rapido com mensagem clara
 * (apanhado pelo main().catch -> exit(1)). A sintese neural real e verificacao
 * ao vivo pendente; o que aqui se testa e a SELECAO.
 */
/**
 * Motor POR-UTILIZADOR (Google/Piper): constrói o gTTS (default) e o Piper e devolve um
 * PerUserEngineRouter que despacha por `req.engine`. É o motor-base da instância pública
 * — cada pessoa escolhe o seu motor em `/voice set`, com o Google por defeito.
 */
export function createPerUserEngine(config: AppConfig, cache: AudioCache): TTSEngine {
  const gtts = new GTTSEngine(cache.withNamespace('gtts'));
  const piper = makePiper(config, cache);
  // Circuit-breaker à volta do gTTS: após N falhas consecutivas (Google bloqueia/
  // timeout de ~15s), abre durante um cooldown e serve o Piper diretamente — sem
  // tentar o gTTS — para não acumular stalls de 15s por mensagem. Só o CAMINHO GOOGLE
  // passa pelo breaker; quem escolheu Piper vai direto ao Piper (inalterado).
  const google = new CircuitBreakerEngine(gtts, piper, {
    threshold: config.gttsBreakerThreshold,
    cooldownMs: config.gttsBreakerCooldownMs,
    label: 'gtts',
  });
  log.info(
    `[factory] motor por-utilizador ativo: google+breaker (${config.gttsBreakerThreshold} falhas -> ${config.gttsBreakerCooldownMs}ms) + piper (opção do user).`,
  );
  return new PerUserEngineRouter(google, piper);
}

function makePiper(config: AppConfig, cache: AudioCache): TTSEngine {
  return new PiperEngine(config.piperPath, config.modelsDir, cache.withNamespace('piper'), {
    // Params de qualidade globais vindos da config (envs NOISE_*/SENTENCE_SILENCE).
    // Defaults = preset ORGANICO (0.75/0.95/0.4) quando as envs nao existirem.
    noiseScale: config.noiseScale,
    noiseW: config.noiseW,
    sentenceSilence: config.sentenceSilence,
  });
}

export function createEngine(config: AppConfig, cache: AudioCache): TTSEngine {
  if (config.ttsEngine === 'neural') {
    if (!config.openaiApiKey) {
      throw new Error('TTS_ENGINE=neural requer OPENAI_API_KEY');
    }
    return new NeuralEngine(config.openaiApiKey, cache.withNamespace('neural'));
  }
  if (config.ttsEngine === 'gtts') {
    // Google Translate TTS (grátis, sem API key, multilingue). Opt-in via
    // TTS_ENGINE=gtts. Endpoint não-oficial — pode ser limitado pela Google.
    return new GTTSEngine(cache.withNamespace('gtts'));
  }
  if (config.ttsEngine === 'router') {
    // MOTOR HÍBRIDO (Vaga 2): combina vários motores por-língua com fallback-por-falha.
    // Fase 1 — gTTS (Google, boa qualidade, todas as línguas) como PRINCIPAL, e o Piper
    // (local, todas as 34, sem rate-limits) como REDE DE SEGURANÇA quando a Google
    // bloqueia/limita. Ambos apanha-tudo, por isso NENHUMA língua fica sem voz. O Kokoro
    // (Fase 2) entrará ANTES do gTTS para as suas ~8 línguas, sem perder cobertura.
    const routes = [
      { engine: new GTTSEngine(cache.withNamespace('gtts')), langs: null, label: 'gtts' },
      { engine: makePiper(config, cache), langs: null, label: 'piper' },
    ];
    log.info(`[factory] motor 'router' ativo: ${routes.map((r) => r.label).join(' -> ')}`);
    return new RouterEngine(routes);
  }
  return makePiper(config, cache);
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
