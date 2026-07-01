import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/moderation/rateLimiter';

describe('RateLimiter', () => {
  it('permite ate perMin pedidos no mesmo instante', () => {
    const rl = new RateLimiter(3);
    const now = 1_000_000;
    expect(rl.allow('u1', now)).toBe(true);
    expect(rl.allow('u1', now)).toBe(true);
    expect(rl.allow('u1', now)).toBe(true);
  });

  it('bloqueia o pedido seguinte quando excede perMin', () => {
    const rl = new RateLimiter(3);
    const now = 1_000_000;
    rl.allow('u1', now);
    rl.allow('u1', now);
    rl.allow('u1', now);
    expect(rl.allow('u1', now)).toBe(false);
  });

  it('recarrega um token apos passar 60s/perMin', () => {
    const rl = new RateLimiter(3);
    const now = 1_000_000;
    rl.allow('u1', now);
    rl.allow('u1', now);
    rl.allow('u1', now);
    expect(rl.allow('u1', now)).toBe(false);
    // 60000ms / 3 = 20000ms por token recarregado
    const later = now + 20_000;
    expect(rl.allow('u1', later)).toBe(true);
    // sem mais tokens disponiveis no mesmo instante
    expect(rl.allow('u1', later)).toBe(false);
  });

  it('recarrega ate ao maximo perMin apos um minuto completo', () => {
    const rl = new RateLimiter(3);
    const now = 1_000_000;
    rl.allow('u1', now);
    rl.allow('u1', now);
    rl.allow('u1', now);
    const fullMinute = now + 60_000;
    expect(rl.allow('u1', fullMinute)).toBe(true);
    expect(rl.allow('u1', fullMinute)).toBe(true);
    expect(rl.allow('u1', fullMinute)).toBe(true);
    expect(rl.allow('u1', fullMinute)).toBe(false);
  });

  it('nao acumula tokens acima do limite mesmo apos muito tempo', () => {
    const rl = new RateLimiter(2);
    const now = 1_000_000;
    // muito tempo parado nao da mais que perMin
    const farFuture = now + 10_000_000;
    expect(rl.allow('u1', farFuture)).toBe(true);
    expect(rl.allow('u1', farFuture)).toBe(true);
    expect(rl.allow('u1', farFuture)).toBe(false);
  });

  it('isola buckets por userId', () => {
    const rl = new RateLimiter(1);
    const now = 1_000_000;
    expect(rl.allow('u1', now)).toBe(true);
    expect(rl.allow('u1', now)).toBe(false);
    expect(rl.allow('u2', now)).toBe(true);
    expect(rl.allow('u2', now)).toBe(false);
  });

  describe('varios users em simultaneo', () => {
    it('cada user tem contador independente (3 users, perMin=2)', () => {
      const rl = new RateLimiter(2);
      const now = 1_000_000;
      // u1 esgota o bucket
      expect(rl.allow('u1', now)).toBe(true);
      expect(rl.allow('u1', now)).toBe(true);
      expect(rl.allow('u1', now)).toBe(false);
      // u2 começa com bucket cheio
      expect(rl.allow('u2', now)).toBe(true);
      expect(rl.allow('u2', now)).toBe(true);
      expect(rl.allow('u2', now)).toBe(false);
      // u3 tambem começa com bucket cheio independente
      expect(rl.allow('u3', now)).toBe(true);
      expect(rl.allow('u3', now)).toBe(true);
      expect(rl.allow('u3', now)).toBe(false);
    });

    it('esgoto de u1 nao afecta u2', () => {
      const rl = new RateLimiter(3);
      const now = 1_000_000;
      rl.allow('u1', now);
      rl.allow('u1', now);
      rl.allow('u1', now);
      // u1 esgotado, mas u2 ainda tem tokens
      expect(rl.allow('u1', now)).toBe(false);
      expect(rl.allow('u2', now)).toBe(true);
    });
  });

  describe('poda de buckets inativos (memoria)', () => {
    // A poda so pode remover buckets que estao "cheios" (tokens efetivos ao
    // maximo em nowMs) — equivalente a nao existirem, pois um bucket recriado
    // nasce cheio. NUNCA muda a semantica observavel de allow/deny.

    it('sweep remove um bucket cheio+inativo (recomputa tokens em nowMs)', () => {
      const rl = new RateLimiter(3);
      const t0 = 1_000_000;
      // cria o bucket e consome 1 token => tokens armazenados = 2 (< perMin=3)
      expect(rl.allow('u1', t0)).toBe(true);
      expect(rl.bucketCount).toBe(1);
      // 10 minutos depois o bucket ja refez ao maximo (efetivo >= perMin).
      const later = t0 + 10 * 60_000;
      const removed = rl.sweep(later, 60_000);
      expect(removed).toBe(1);
      expect(rl.bucketCount).toBe(0);
    });

    it('sweep NAO remove um bucket ainda parcialmente gasto (efetivo < perMin)', () => {
      const rl = new RateLimiter(3);
      const t0 = 1_000_000;
      rl.allow('u1', t0); // tokens efetivos = 2 em t0
      // no MESMO instante ainda nao refez => nao deve podar mesmo com idle 0.
      const removed = rl.sweep(t0, 0);
      expect(removed).toBe(0);
      expect(rl.bucketCount).toBe(1);
    });

    it('sweep NAO remove um bucket cheio mas recente (gate de idle protege)', () => {
      const rl = new RateLimiter(3);
      const t0 = 1_000_000;
      // enche u_old num instante antigo
      rl.allow('u_old', t0);
      // u_active tocado agora (lastRefillMs recente) — cheio mas nao inativo.
      const later = t0 + 10 * 60_000;
      rl.allow('u_active', later);
      expect(rl.bucketCount).toBe(2);
      // maxIdle = 60s: u_old (idle 10min) poda; u_active (idle 0) sobrevive.
      const removed = rl.sweep(later, 60_000);
      expect(removed).toBe(1);
      expect(rl.bucketCount).toBe(1);
      // u_active continua com a sua quota intacta (semantica intocada).
      expect(rl.allow('u_active', later)).toBe(true);
      expect(rl.allow('u_active', later)).toBe(true);
      expect(rl.allow('u_active', later)).toBe(false);
    });

    it('allow() poda automaticamente quando buckets.size excede MAX_BUCKETS', () => {
      const rl = new RateLimiter(1);
      const t0 = 1_000_000;
      // Enche > MAX_BUCKETS users num instante antigo (cada um consome o seu 1 token).
      for (let i = 0; i <= 5000; i++) {
        rl.allow(`u${i}`, t0);
      }
      expect(rl.bucketCount).toBeGreaterThan(5000);
      // Muito mais tarde, todos ja refizeram ao maximo => allow() de um novo user
      // dispara a poda preguicosa e a contagem cai.
      const later = t0 + 10 * 60_000;
      rl.allow('novo', later);
      expect(rl.bucketCount).toBeLessThan(5000);
    });

    it('a decisao allow/deny permanece correta apos poda', () => {
      const rl = new RateLimiter(2);
      const t0 = 1_000_000;
      rl.allow('u1', t0); // 1 gasto
      const later = t0 + 10 * 60_000;
      rl.sweep(later, 60_000); // u1 podado (cheio+inativo)
      // u1 recriado cheio => mesmo comportamento que se nunca tivesse existido.
      expect(rl.allow('u1', later)).toBe(true);
      expect(rl.allow('u1', later)).toBe(true);
      expect(rl.allow('u1', later)).toBe(false);
    });
  });

  describe('fronteira exata de recarga (1 token)', () => {
    // perMin=3 => refillIntervalMs = 60000/3 = 20000ms
    // Usa instancias separadas para evitar que a chamada "before" altere
    // lastRefillMs e perturbe o calculo da chamada "at boundary".

    it('nao recarrega um token 1ms antes do intervalo (nowMs = now + 19999)', () => {
      const rl = new RateLimiter(3);
      const now = 1_000_000;
      rl.allow('u1', now);
      rl.allow('u1', now);
      rl.allow('u1', now);
      // 19999ms < 20000ms => refilled = 19999/20000 < 1 => sem token novo
      expect(rl.allow('u1', now + 19_999)).toBe(false);
    });

    it('recarrega exactamente 1 token no limite do intervalo (nowMs = now + 20000)', () => {
      const rl = new RateLimiter(3);
      const now = 1_000_000;
      rl.allow('u1', now);
      rl.allow('u1', now);
      rl.allow('u1', now);
      // 20000ms == 20000ms => refilled = 1.0 => exatamente 1 token reposto
      expect(rl.allow('u1', now + 20_000)).toBe(true);
      // mas nao ha segundo token nesse mesmo instante
      expect(rl.allow('u1', now + 20_000)).toBe(false);
    });
  });
});
