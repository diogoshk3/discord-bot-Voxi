// src/tts/multiSegment.ts — P14.4b
//
// Decorator de TTSEngine que, para textos com MAIS DO QUE UMA lingua, sintetiza
// cada segmento com a voz da sua lingua e concatena os WAVs. EXPERIMENTAL, so e
// usado quando a flag MULTILINGUAL_SEGMENTS esta ON (ver src/index.ts). Com a
// flag OFF, este modulo NEM sequer e instanciado — o motor base e usado tal e
// qual, por isso o comportamento por defeito e byte-a-byte o de hoje.

import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TTSEngine, SynthRequest } from './engine';
import { AudioCache, cacheKey } from './cache';
import { detectSegments } from './segments';
import { concatWavs } from './wavConcat';
import { pickVoice } from '../language/voiceMap';
import { log } from '../logging/logger';

/** Silencio entre segmentos (ms). Pequeno, anti-clique. */
const SEGMENT_SILENCE_MS = 60;

export class MultiSegmentEngine implements TTSEngine {
  private readonly cache: AudioCache;

  /**
   * @param base           motor real (Piper/Neural) que sintetiza UM segmento.
   * @param availableModels modelos .onnx disponiveis, para pickVoice por-segmento.
   * @param cache           cache raiz; o WAV COMBINADO e guardado num namespace
   *                        SEPARADO ('multiseg') para NUNCA contaminar o caminho
   *                        single-voice (flag OFF) que usa a mesma chave.
   */
  constructor(
    private readonly base: TTSEngine,
    private readonly availableModels: string[],
    cache: AudioCache,
  ) {
    this.cache = cache.withNamespace('multiseg');
  }

  async synth(req: SynthRequest): Promise<string> {
    const segments = detectSegments(req.text);

    // 0 ou 1 segmento (o caso COMUM: texto monolingue) -> nada a combinar.
    // Delega no motor base com o req INTACTO — respeita o req.model, que ja vem
    // resolvido por resolveSynth (voz do user > default_voice da guild > deteccao
    // de lingua). NAO re-escolhemos a voz aqui: senao a voz que o utilizador
    // definiu via /voice seria silenciosamente substituida pela deteccao em cada
    // mensagem monolingue. So partimos por segmento quando ha MESMO >1 lingua.
    if (segments.length <= 1) {
      return this.base.synth(req);
    }

    // Chave da cache do resultado COMBINADO (namespace 'multiseg'). Inclui o
    // req.model (voz-base/fallback) porque afeta a escolha por-segmento.
    const key = cacheKey(req);
    const cached = this.cache.get(key);
    if (cached) return cached;

    try {
      const wavs: Buffer[] = [];
      for (const seg of segments) {
        const model = pickVoice(seg.lang, this.availableModels, req.model);
        // Cada segmento passa pelo motor base (cache single-voice do base
        // reutilizada — sintese legitima de um substring).
        const path = await this.base.synth({ text: seg.text, model, speed: req.speed });
        wavs.push(readFileSync(path));
      }

      const combined = concatWavs(wavs, { silenceMs: SEGMENT_SILENCE_MS });
      return this.persist(key, combined);
    } catch (err) {
      // Politica de erro: se QUALQUER segmento (ou a concatenacao) falha, NAO
      // crashamos e NAO deixamos cair conteudo — caimos no caminho single-voice
      // de TODO o texto com a voz-base (req.model). O player recebe sempre um WAV.
      log.warn(
        '[multiSegment] falha no caminho por-segmento, fallback single-voice:',
        (err as Error).message,
      );
      return this.base.synth(req);
    }
  }

  /**
   * Escreve o WAV combinado num ficheiro temporario e mete-o na cache 'multiseg'
   * (que copia para o seu diretorio e devolve o caminho definitivo). Mesmo padrao
   * do PiperEngine (temp -> cache.put -> cleanup).
   */
  private persist(key: string, wav: Buffer): string {
    const workDir = mkdtempSync(join(tmpdir(), 'multiseg-'));
    const outPath = join(workDir, 'out.wav');
    try {
      writeFileSync(outPath, wav);
      return this.cache.put(key, outPath);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}
