// src/metrics.ts
// Singleton simples de contadores em memória para observabilidade.
// Sem dependências externas; reset() disponível para isolamento em testes.

export interface MetricsSnapshot {
  messagesSpoken: number;
  cacheHits: number;
  cacheMisses: number;
  synthErrors: number;
}

class Metrics {
  messagesSpoken = 0;
  cacheHits = 0;
  cacheMisses = 0;
  synthErrors = 0;

  /** Incrementa um contador pelo nome. */
  inc(counter: keyof MetricsSnapshot): void {
    this[counter]++;
  }

  /** Devolve uma cópia instantânea dos contadores (leitura não-destrutiva). */
  snapshot(): MetricsSnapshot {
    return {
      messagesSpoken: this.messagesSpoken,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      synthErrors: this.synthErrors,
    };
  }

  /** Repõe todos os contadores a zero. Usado nos testes para isolar casos. */
  reset(): void {
    this.messagesSpoken = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.synthErrors = 0;
  }
}

export const metrics = new Metrics();
