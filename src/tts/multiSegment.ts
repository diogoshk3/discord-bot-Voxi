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
import { createHash } from 'node:crypto';
import type { TTSEngine, SynthRequest } from './engine';
import { AudioCache, cacheKey } from './cache';
import { detectSegments } from './segments';
import { concatWavs, silenceWav } from './wavConcat';
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
    // Gate single-voice: quando o pedido pede explicitamente UMA voz (voz
    // deliberadamente escolhida — /voice preview, /joke, /laugh, ou o toggle de
    // deteccao por-user desligado), NUNCA partimos por segmento. Delega no base com
    // o req INTACTO (honra `model` e `leadSilenceMs`). Verificado ANTES do split.
    if (req.singleVoice) {
      return this.base.synth(req);
    }

    // Segmentos EXPLICITOS (texto, voz ja resolvidos por prepareSpeech) tomam
    // precedencia sobre a deteccao por-script: e a sintese MISTURADA (base + girias
    // EN). Verificado ANTES do detectSegments para nao re-partir por script.
    if (req.segments && req.segments.length > 0) {
      return this.synthExplicitSegments(req);
    }

    const segments = detectSegments(req.text);

    // 0 ou 1 segmento (o caso COMUM: texto monolingue) -> nada a combinar.
    // Delega no motor base com o req INTACTO — respeita o req.model, que ja vem
    // resolvido por resolveSynth (a lingua da mensagem decide; a voz preferida
    // [user > guild > .env] e honrada quando bate a lingua). NAO re-escolhemos a
    // voz aqui: para texto monolingue o req.model ja e a voz certa para essa
    // lingua. So partimos por segmento quando ha MESMO >1 lingua.
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
        // reutilizada — sintese legitima de um substring). Herda o `engine` da
        // mensagem para o PerUserEngineRouter usar o motor certo do utilizador.
        const path = await this.base.synth({
          text: seg.text,
          model,
          speed: req.speed,
          engine: req.engine,
        });
        wavs.push(readFileSync(path));
      }

      const combined = this.withLead(req, concatWavs(wavs, { silenceMs: SEGMENT_SILENCE_MS }));
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
   * Caminho de segmentos EXPLICITOS: as partes (texto, voz) ja vêm resolvidas em
   * `req.segments` (sintese MISTURADA — base numa lingua + girias EN em voz inglesa).
   * NAO re-deteta nem re-parte: sintetiza cada parte com o SEU model e concatena.
   */
  private async synthExplicitSegments(req: SynthRequest): Promise<string> {
    const segs = req.segments!;

    // Um so segmento -> delega no base com o {text,model} desse segmento (sem
    // combinar nem cachear no namespace 'multiseg'; a cache single-voice do base chega).
    if (segs.length === 1) {
      const seg = segs[0];
      return this.base.synth({ text: seg.text, model: seg.model, speed: req.speed, engine: req.engine });
    }

    // Chave da cache do resultado COMBINADO. Inclui os PROPRIOS segmentos (texto+voz)
    // para NUNCA colidir com o caminho por-script (chave = cacheKey(req)) nem com uma
    // mensagem literal igual ao texto juntado. Separadores de unidade (U+241F entre
    // texto e voz, U+2426 entre segmentos) que nao aparecem em texto normal.
    const SEP_FIELD = '␟';
    const SEP_SEG = '␦';
    const payload = segs.map((s) => `${s.text}${SEP_FIELD}${s.model}`).join(SEP_SEG);
    // leadSilenceMs entra na chave: com/sem silêncio de arranque não podem colidir. O
    // MOTOR também (append-only p/ 'piper'): dois users com motores diferentes e o mesmo
    // texto misturado NÃO se cruzam neste namespace combinado.
    const engineKey = req.engine === 'piper' ? ' piper' : '';
    const key = createHash('sha1')
      .update(`${payload} ${req.speed} lead${req.leadSilenceMs ?? 0}${engineKey}`, 'utf8')
      .digest('hex');
    const cached = this.cache.get(key);
    if (cached) return cached;

    try {
      const wavs: Buffer[] = [];
      for (const seg of segs) {
        const path = await this.base.synth({
          text: seg.text,
          model: seg.model,
          speed: req.speed,
          engine: req.engine,
        });
        wavs.push(readFileSync(path));
      }
      const combined = this.withLead(req, concatWavs(wavs, { silenceMs: SEGMENT_SILENCE_MS }));
      return this.persist(key, combined);
    } catch (err) {
      // Mesma resiliencia do caminho por-script: se qualquer parte (ou a
      // concatenacao) falha, cai no single-voice de TODO o texto com a voz-base.
      log.warn(
        '[multiSegment] falha no caminho de segmentos explicitos, fallback single-voice:',
        (err as Error).message,
      );
      return this.base.synth({ text: req.text, model: req.model, speed: req.speed, engine: req.engine });
    }
  }

  /**
   * Escreve o WAV combinado num ficheiro temporario e mete-o na cache 'multiseg'
   * (que copia para o seu diretorio e devolve o caminho definitivo). Mesmo padrao
   * do PiperEngine (temp -> cache.put -> cleanup).
   */
  /** Prepend `req.leadSilenceMs` de silêncio ao WAV combinado (no-op se 0/ausente). */
  private withLead(req: SynthRequest, wav: Buffer): Buffer {
    if (req.leadSilenceMs && req.leadSilenceMs > 0) {
      return concatWavs([silenceWav(req.leadSilenceMs), wav], { silenceMs: 0 });
    }
    return wav;
  }

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
