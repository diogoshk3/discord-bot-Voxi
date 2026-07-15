// src/tts/gcloud.ts — motor TTS PREMIUM via API OFICIAL Google Cloud Text-to-Speech
// (tier STANDARD). É o "Google HD" do /voice set, exclusivo de quem tem Vozen Plus ou
// Premium do servidor (gate em resolveUserEngine + gcloudUsage). Valor vs o gTTS grátis:
// API oficial estável (sem os 429/bloqueios do endpoint não-oficial), escolha de género
// de voz, e latência/fiabilidade consistentes.
//
// Formato: pedimos LINEAR16 a 22050Hz mono — o MESMO do Piper/gTTS — por isso o
// audioContent (base64) já é um WAV pronto que encaixa sem atrito no pipeline (cache,
// leadSilenceMs, player, concat de silêncio).
//
// Economia: $4/1M chars, com free tier de 4M chars/mês permanente. Os limites de custo
// (allowances mensais por pessoa/passe) vivem na Fase 3 (gcloudUsage) — este motor só
// sintetiza; a contagem entra aqui no chokepoint na Fase 3.
//
// SEM GOOGLE_TTS_API_KEY, este motor NEM é construído: a factory faz o caminho 'gcloud'
// ser o próprio gTTS (identidade), por isso escolher Google HD comporta-se como o default.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rmDirSafe } from './cleanupDir';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SynthRequest, TTSEngine } from './engine';
import { AudioCache, cacheKey } from './cache';
import { concatWavs, silenceWav } from './wavConcat';
import { lowerAllCapsRuns } from './deCaps';
import { monthKeyUTC, type UsageScope } from '../store/gcloudUsage';
import { metrics } from '../metrics';
import { log } from '../logging/logger';

const GCLOUD_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const GCLOUD_TIMEOUT_MS = 15000;
/** Taxa de amostragem pedida à Google — igual ao resto do pipeline (Piper/gTTS = 22050). */
const GCLOUD_SAMPLE_RATE = 22050;

/**
 * `languageCode` BCP-47 a partir de um id de modelo Piper. Os ids são `lang_REGION-voz-
 * qualidade` (ex. 'pt_PT-tuga-medium', 'en_US-amy-medium'); o locale é o 1.º token antes
 * do '-', e trocar o '_' por '-' dá exatamente BCP-47 ('pt_PT' -> 'pt-PT', 'en_US' ->
 * 'en-US'). Sem locale reconhecível -> 'en-US' (fallback seguro). A Google escolhe a voz
 * Standard default dessa língua (não passamos `voice.name`). PURA e determinística.
 */
export function bcp47OfModel(model: string): string {
  const locale = model.split('-')[0]; // 'pt_PT-tuga-medium' -> 'pt_PT'
  if (!locale || !/^[a-z]{2,3}_[A-Za-z]{2,}$/.test(locale)) return 'en-US';
  return locale.replace('_', '-');
}

/** Contadores mensais persistentes (implementado por store/gcloudUsage sobre SQLite). */
export interface GcloudUsage {
  getMonthly(scope: UsageScope, key: string, month: string): number;
  addMonthly(scope: UsageScope, key: string, month: string, chars: number): void;
}

/** Tetos de custo do Google HD (vêm da config). Ver AppConfig.gcloud*. */
export interface GcloudLimits {
  maxChars: number; // pedido acima disto -> gTTS
  plusMonthly: number; // pool pessoal do Plus
  pass3Monthly: number; // pool do passe de 3 servidores
  pass8Monthly: number; // pool do passe de 8 servidores
  dailyBudget: number; // backstop GLOBAL/dia em memória (0 = desligado)
}

export interface GCloudOptions {
  /** fetch injetável (testes). Default: o `fetch` global. */
  fetchImpl?: typeof fetch;
  /** contadores mensais persistentes; ausente => sem contagem (ex. Fase 1 / testes). */
  usage?: GcloudUsage;
  /** tetos de custo; ausente => SEM enforcement (comporta-se como Fase 1). */
  limits?: GcloudLimits;
  /** relógio injetável (testes deterministicos do mês/dia). Default Date.now. */
  now?: () => number;
}

/** Erro de ORÇAMENTO: sinaliza ao RouterEngine que embrulha o motor para cair no gTTS. */
class GcloudBudgetError extends Error {}

/**
 * Motor Google Cloud TTS Standard. Implementa a MESMA interface TTSEngine e partilha a
 * cache por cacheKey (namespace próprio 'gcloud' — ver factory). Um erro HTTP / resposta
 * inválida / ORÇAMENTO esgotado LANÇA, para o RouterEngine que o embrulha cair no gTTS
 * (ninguém fica sem voz). É o CHOKEPOINT de custo: conta os chars SÓ na chamada real à
 * Google (cache-miss), por isso a contagem é exata e cobre TODOS os call sites (todos
 * passam por aqui via deps.engine -> PerUserEngineRouter -> este motor).
 */
export class GCloudEngine implements TTSEngine {
  private readonly apiKey: string;
  private readonly cache: AudioCache;
  private readonly fetchImpl: typeof fetch;
  private readonly usage?: GcloudUsage;
  private readonly limits?: GcloudLimits;
  private readonly now: () => number;
  // Backstop GLOBAL/dia (em memória): disjuntor contra bugs/abuso, reposto quando o dia UTC
  // muda. Só um teto de segurança ACIMA dos pools mensais persistentes.
  private dailyDay = '';
  private dailyUsed = 0;
  // Anti-spam do log de recusas: um pool esgotado recusaria CADA mensagem — logar todas
  // enche o log. Warn no MÁXIMO uma vez por (dia, pool). Limpo quando o dia UTC muda.
  private warnedDenials = new Set<string>();
  private warnedDay = '';

  constructor(apiKey: string, cache: AudioCache, opts: GCloudOptions = {}) {
    this.apiKey = apiKey;
    this.cache = cache;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.usage = opts.usage;
    this.limits = opts.limits;
    this.now = opts.now ?? Date.now;
  }

  /** Teto mensal do pool do descritor (o motor é dono da tabela de preços; ver config). */
  private limitFor(budget: NonNullable<SynthRequest['gcloudBudget']>): number {
    const L = this.limits!;
    if (budget.scope === 'user') return L.plusMonthly;
    if (budget.scope === 'pass') return (budget.seats ?? 8) <= 3 ? L.pass3Monthly : L.pass8Monthly;
    return L.pass3Monthly; // 'guild' (Premium direto sem passe): usa o tier de 3 servidores
  }

  /** Repõe o contador diário em memória quando o dia UTC muda. */
  private rollDaily(dayKey: string): void {
    if (this.dailyDay !== dayKey) {
      this.dailyDay = dayKey;
      this.dailyUsed = 0;
    }
  }

  /**
   * Decide se ESTE pedido pode ir à Google. Lança GcloudBudgetError (-> gTTS) quando: não
   * há orçamento (fail-safe: um caminho não-gated nunca gasta $), o texto excede maxChars,
   * o pool mensal esgota, ou o backstop diário estoura. Sem `limits`, é no-op (Fase 1).
   */
  private enforceBudget(req: SynthRequest, chars: number): void {
    if (!this.limits) return; // sem tetos configurados => comportamento Fase 1 (sem gate)
    const budget = req.gcloudBudget;
    if (!budget) {
      this.deny('gcloud request without a budget (fail-safe)');
    }
    if (chars > this.limits.maxChars) {
      this.deny(`texto ${chars} chars > máx ${this.limits.maxChars}`);
    }
    const month = monthKeyUTC(this.now());
    const limit = this.limitFor(budget!);
    const used = this.usage ? this.usage.getMonthly(budget!.scope, budget!.key, month) : 0;
    if (used + chars > limit) {
      this.deny(
        `pool mensal ${budget!.scope}:${budget!.key} esgotado (${used}+${chars}>${limit})`,
        `pool:${budget!.scope}:${budget!.key}`,
      );
    }
    if (this.limits.dailyBudget > 0) {
      const d = new Date(this.now());
      const dayKey = `${month}-${String(d.getUTCDate()).padStart(2, '0')}`;
      this.rollDaily(dayKey);
      if (this.dailyUsed + chars > this.limits.dailyBudget) {
        this.deny(
          `backstop diário global estourado (${this.dailyUsed}+${chars}>${this.limits.dailyBudget})`,
          'daily',
        );
      }
    }
  }

  /**
   * Regista o fallback (métrica) e lança o erro de orçamento (-> gTTS). O `throttleKey`
   * (quando dado) limita o WARN a uma vez por dia por pool — uma recusa recorrente (pool
   * esgotado) não spamma o log. Sem `throttleKey` (ex.: fail-safe sem orçamento = sinal de
   * bug), avisa sempre.
   */
  private deny(reason: string, throttleKey?: string): never {
    metrics.inc('gcloudFallbacks');
    let shouldWarn = true;
    if (throttleKey) {
      const d = new Date(this.now());
      const dayKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
      if (this.warnedDay !== dayKey) {
        this.warnedDenials.clear();
        this.warnedDay = dayKey;
      }
      shouldWarn = !this.warnedDenials.has(throttleKey);
      if (shouldWarn) this.warnedDenials.add(throttleKey);
    }
    if (shouldWarn) log.warn(`[gcloud] request denied; falling back to gTTS: ${reason}`);
    throw new GcloudBudgetError(reason);
  }

  /**
   * Reserva o consumo ANTES da chamada real (cache-miss). Debitar já — em vez de após o
   * `await` — fecha a race check-then-act: duas sínteses concorrentes do MESMO pool (um
   * passe cobre várias guilds) veriam ambas o total antigo e ambas passariam o teto.
   */
  private reserveUsage(req: SynthRequest, chars: number): void {
    if (this.limits && req.gcloudBudget && this.usage) {
      const month = monthKeyUTC(this.now());
      this.usage.addMonthly(req.gcloudBudget.scope, req.gcloudBudget.key, month, chars);
    }
    if (this.limits && this.limits.dailyBudget > 0) this.dailyUsed += chars;
  }

  /** Devolve a reserva quando a síntese falha (uma chamada falhada não gasta orçamento). */
  private refundUsage(req: SynthRequest, chars: number): void {
    if (this.limits && req.gcloudBudget && this.usage) {
      const month = monthKeyUTC(this.now());
      this.usage.addMonthly(req.gcloudBudget.scope, req.gcloudBudget.key, month, -chars);
    }
    if (this.limits && this.limits.dailyBudget > 0) this.dailyUsed -= chars;
  }

  async synth(req: SynthRequest): Promise<string> {
    const key = cacheKey(req);
    const cached = this.cache.get(key);
    if (cached) return cached; // cache-hit: SEM chamada à Google (sem custo, sem contagem)

    // Cache-miss => vai haver chamada real. Aplica os tetos ANTES de gastar $.
    const chars = req.text.length;
    this.enforceBudget(req, chars);
    // Reserva o consumo ANTES do await (fecha a race check-then-act — ver reserveUsage).
    this.reserveUsage(req, chars);

    let wav: Buffer;
    try {
      wav = await this.fetchSpeech(req);
    } catch (err) {
      this.refundUsage(req, chars); // síntese falhada -> devolve a reserva
      throw err;
    }
    // Sucesso -> contabiliza as métricas do custo real.
    metrics.inc('gcloudSynths');
    metrics.add('gcloudChars', chars);
    // Silêncio de arranque (mesma semântica do Piper/gTTS): PREPENDido ao WAV.
    if (req.leadSilenceMs && req.leadSilenceMs > 0) {
      wav = concatWavs([silenceWav(req.leadSilenceMs), wav], { silenceMs: 0 });
    }

    const workDir = mkdtempSync(join(tmpdir(), 'gcloud-'));
    const outPath = join(workDir, 'out.wav');
    try {
      writeFileSync(outPath, wav);
      return this.cache.put(key, outPath);
    } finally {
      rmDirSafe(workDir);
    }
  }

  private async fetchSpeech(req: SynthRequest): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GCLOUD_TIMEOUT_MS);

    let res: Response;
    try {
      res = await this.fetchImpl(GCLOUD_TTS_URL, {
        method: 'POST',
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // lowerAllCapsRuns: evita que um "grito" TODO-MAIÚSCULAS saia soletrado
          // (mesmo problema do gTTS/Kokoro/Neural — a transformação vive em deCaps.ts).
          input: { text: lowerAllCapsRuns(req.text) },
          voice: { languageCode: bcp47OfModel(req.model) },
          audioConfig: {
            audioEncoding: 'LINEAR16',
            sampleRateHertz: GCLOUD_SAMPLE_RATE,
            // speakingRate: velocidade do user (Google aceita 0.25–4.0); 1 = natural.
            ...(req.speed > 0 && Math.abs(req.speed - 1) > 1e-6
              ? { speakingRate: Math.min(4, Math.max(0.25, req.speed)) }
              : {}),
          },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const reason =
        (err as Error)?.name === 'AbortError'
          ? `timeout (${GCLOUD_TIMEOUT_MS}ms)`
          : (err as Error).message;
      throw new Error(`Network failure while contacting the Google Cloud TTS API: ${reason}`, {
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `API Google Cloud TTS devolveu ${res.status} ${res.statusText}${detail ? `: ${detail.trim()}` : ''}`,
      );
    }

    const data = (await res.json().catch(() => ({}))) as { audioContent?: string };
    if (!data.audioContent) {
      throw new Error('Google Cloud TTS API response did not contain audioContent');
    }
    const buf = Buffer.from(data.audioContent, 'base64');
    if (buf.length === 0) {
      throw new Error('Google Cloud TTS API returned empty audioContent');
    }
    return buf;
  }
}
