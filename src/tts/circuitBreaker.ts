// src/tts/circuitBreaker.ts
//
// CircuitBreakerEngine — decorator de TTSEngine que protege contra um motor PRIMARY
// que fica lento/indisponível (o caso típico: o gTTS da Google a fazer timeout de
// ~15s por pedido quando bloqueia/limita). Depois de N falhas CONSECUTIVAS, "abre" e
// serve o `fallback` (ex. Piper, local) DIRETAMENTE durante um cooldown — sem sequer
// tentar o primary — para não acumular stalls de 15s a cada mensagem. Uma síntese
// bem-sucedida do primary fecha o breaker e reseta o contador.
//
// Estados:
//   FECHADO      -> tenta o primary; sucesso reseta, falha conta.
//   ABERTO       -> (now < openUntil) nem toca no primary; vai direto ao fallback.
//   MEIO-ABERTO  -> (cooldown expirou) uma sondagem ao primary; sucesso fecha, falha reabre.
//
// Degradação graciosa: mesmo no estado FECHADO, uma falha do primary cai no fallback
// para ESSA mensagem (não a deixa sem áudio) além de contar para abrir.

import type { SynthRequest, TTSEngine } from './engine';
import { log } from '../logging/logger';

export interface CircuitBreakerOpts {
  /** Falhas CONSECUTIVAS do primary para abrir o breaker. */
  threshold: number;
  /** Tempo (ms) que o breaker fica aberto (a usar o fallback) antes de re-sondar. */
  cooldownMs: number;
  /** Relógio injetável (testes). Default: Date.now. */
  now?: () => number;
  /** Nome curto para logs (ex. 'gtts'). */
  label?: string;
  /** Hook chamado quando o breaker ABRE (métricas/observabilidade). */
  onOpen?: () => void;
}

export class CircuitBreakerEngine implements TTSEngine {
  private failures = 0;
  private openUntil = 0;
  private readonly now: () => number;
  private readonly label: string;

  constructor(
    private readonly primary: TTSEngine,
    private readonly fallback: TTSEngine,
    private readonly opts: CircuitBreakerOpts,
  ) {
    this.now = opts.now ?? Date.now;
    this.label = opts.label ?? 'primary';
  }

  /** O breaker está ABERTO agora (a saltar o primary)? Observabilidade/testes. */
  isOpen(): boolean {
    return this.now() < this.openUntil;
  }

  async synth(req: SynthRequest): Promise<string> {
    // ABERTO: nem tenta o primary — fallback direto (evita o stall de ~15s).
    if (this.now() < this.openUntil) {
      return this.fallback.synth(req);
    }
    // MEIO-ABERTO se JÁ esteve aberto e o cooldown expirou (openUntil>0). Nesse estado,
    // uma ÚNICA falha da sondagem reabre já (não espera juntar `threshold` outra vez —
    // senão cada expiração de cooldown re-provocava N stalls de 15s numa outage longa).
    const halfOpen = this.openUntil > 0;
    try {
      const out = await this.primary.synth(req);
      this.failures = 0; // sucesso -> FECHA e reseta
      this.openUntil = 0;
      return out;
    } catch (err) {
      if (halfOpen || ++this.failures >= this.opts.threshold) {
        this.openUntil = this.now() + this.opts.cooldownMs;
        this.failures = 0;
        log.warn(
          `[breaker] '${this.label}' ABERTO por ${this.opts.cooldownMs}ms (${halfOpen ? 'sondagem falhou' : `${this.opts.threshold} falhas`}) — a servir o fallback`,
        );
        this.opts.onOpen?.();
      } else {
        log.warn(
          `[breaker] '${this.label}' falhou (${this.failures}/${this.opts.threshold}): ${(err as Error).message}`,
        );
      }
      // Degradação graciosa: usa o fallback para ESTA mensagem também (não a deixa muda).
      return this.fallback.synth(req);
    }
  }
}
