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
