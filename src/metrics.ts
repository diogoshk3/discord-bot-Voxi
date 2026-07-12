// src/metrics.ts
// Singleton simples de contadores em memória para observabilidade.
// Sem dependências externas; reset() disponível para isolamento em testes.

export interface MetricsSnapshot {
  messagesSpoken: number;
  cacheHits: number;
  cacheMisses: number;
  synthErrors: number;
  // Mensagens SALTADAS por rate-limit (limite N/min por-user). Antes o drop era
  // silencioso (sem log, sem métrica) — parecia "o bot não fala". Agora é observável.
  messagesRateLimited: number;
  // Reconexao a voz (P7.4): quedas detetadas e reconexoes com sucesso.
  voiceDrops: number;
  voiceReconnects: number;
  // Votos top.gg (P11.5): upvotes validos recebidos via webhook. Pings de "test"
  // do dashboard top.gg NAO contam (so type === "upvote").
  votes: number;
  // Bloqueios do event-loop detetados (health/loopLag). Um loop bloqueado >~400ms
  // atrasa TUDO — em especial o autocomplete, que tem ~3s de orcamento sem defer.
  loopStalls: number;
  // Latencia de sintese (T0.2): nº total de sinteses medidas + p50/p95 (ms) das
  // ULTIMAS N amostras (janela deslizante). p50/p95 = 0 se ainda nao ha amostras.
  synthCount: number;
  synthP50Ms: number;
  synthP95Ms: number;
  // Motor Google HD (gcloud, perk Premium): sinteses REAIS feitas a Google (cache-miss),
  // total de chars faturados a Google, e quantas vezes caiu no gTTS por orcamento/limite
  // (fallback). Observabilidade de CUSTO — cada char conta ($4/1M).
  gcloudSynths: number;
  gcloudChars: number;
  gcloudFallbacks: number;
}

/** Tamanho da janela deslizante de latencias mantida em memoria. */
const SYNTH_SAMPLE_WINDOW = 512;

/** Percentil `p` (0-100) de um array JA ordenado; 0 se vazio. */
function percentileOf(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx];
}

class Metrics {
  messagesSpoken = 0;
  cacheHits = 0;
  cacheMisses = 0;
  synthErrors = 0;
  messagesRateLimited = 0;
  voiceDrops = 0;
  voiceReconnects = 0;
  votes = 0;
  loopStalls = 0;
  gcloudSynths = 0;
  gcloudChars = 0;
  gcloudFallbacks = 0;
  // Latencia: contador total + janela deslizante das ultimas amostras (ms).
  synthCount = 0;
  private synthMs: number[] = [];

  /**
   * Incrementa um contador escalar pelo nome. NOTA: so os contadores puramente
   * numericos-escalares (nao os de latencia) — a latencia usa recordSynthMs().
   */
  inc(counter: Exclude<keyof MetricsSnapshot, 'synthCount' | 'synthP50Ms' | 'synthP95Ms'>): void {
    (this[counter] as number)++;
  }

  /** Soma `amount` a um contador escalar (ex.: gcloudChars, que cresce por N chars). */
  add(
    counter: Exclude<keyof MetricsSnapshot, 'synthCount' | 'synthP50Ms' | 'synthP95Ms'>,
    amount: number,
  ): void {
    (this[counter] as number) += amount;
  }

  /** Regista a latencia (ms) de UMA sintese. Mantem uma janela deslizante. */
  recordSynthMs(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.synthCount++;
    this.synthMs.push(ms);
    if (this.synthMs.length > SYNTH_SAMPLE_WINDOW) this.synthMs.shift();
  }

  /** Devolve uma cópia instantânea dos contadores (leitura não-destrutiva). */
  snapshot(): MetricsSnapshot {
    const sorted = [...this.synthMs].sort((a, b) => a - b);
    return {
      messagesSpoken: this.messagesSpoken,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      synthErrors: this.synthErrors,
      messagesRateLimited: this.messagesRateLimited,
      voiceDrops: this.voiceDrops,
      voiceReconnects: this.voiceReconnects,
      votes: this.votes,
      loopStalls: this.loopStalls,
      synthCount: this.synthCount,
      synthP50Ms: Math.round(percentileOf(sorted, 50)),
      synthP95Ms: Math.round(percentileOf(sorted, 95)),
      gcloudSynths: this.gcloudSynths,
      gcloudChars: this.gcloudChars,
      gcloudFallbacks: this.gcloudFallbacks,
    };
  }

  /** Repõe todos os contadores a zero. Usado nos testes para isolar casos. */
  reset(): void {
    this.messagesSpoken = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.synthErrors = 0;
    this.messagesRateLimited = 0;
    this.voiceDrops = 0;
    this.voiceReconnects = 0;
    this.votes = 0;
    this.loopStalls = 0;
    this.gcloudSynths = 0;
    this.gcloudChars = 0;
    this.gcloudFallbacks = 0;
    this.synthCount = 0;
    this.synthMs = [];
  }
}

export const metrics = new Metrics();
