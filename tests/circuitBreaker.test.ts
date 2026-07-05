import { describe, it, expect, vi } from 'vitest';
import { CircuitBreakerEngine } from '../src/tts/circuitBreaker';
import type { SynthRequest, TTSEngine } from '../src/tts/engine';

const REQ = { text: 'olá', model: 'pt_BR-faber-medium', speed: 1 } as SynthRequest;

/** Motor falso controlável: devolve `path` ou lança, contando as chamadas. */
function fakeEngine(path: string) {
  let fail = false;
  const calls = { n: 0 };
  const engine: TTSEngine = {
    synth: vi.fn(async () => {
      calls.n++;
      if (fail) throw new Error('boom');
      return path;
    }),
  };
  return { engine, calls, setFail: (v: boolean) => (fail = v) };
}

function make(threshold = 3, cooldownMs = 60_000) {
  const primary = fakeEngine('/gtts.wav');
  const fallback = fakeEngine('/piper.wav');
  let t = 0;
  const breaker = new CircuitBreakerEngine(primary.engine, fallback.engine, {
    threshold,
    cooldownMs,
    now: () => t,
    label: 'gtts',
  });
  return { breaker, primary, fallback, advance: (ms: number) => (t += ms), setTime: (v: number) => (t = v) };
}

describe('CircuitBreakerEngine — cooldown do gTTS', () => {
  it('FECHADO + sucesso: usa o primary, não toca no fallback', async () => {
    const { breaker, primary, fallback } = make();
    await expect(breaker.synth(REQ)).resolves.toBe('/gtts.wav');
    expect(primary.calls.n).toBe(1);
    expect(fallback.calls.n).toBe(0);
    expect(breaker.isOpen()).toBe(false);
  });

  it('FECHADO + falha (abaixo do limiar): degrada para o fallback e continua fechado', async () => {
    const { breaker, primary, fallback } = make(3);
    primary.setFail(true);
    await expect(breaker.synth(REQ)).resolves.toBe('/piper.wav'); // não fica mudo
    expect(primary.calls.n).toBe(1);
    expect(fallback.calls.n).toBe(1);
    expect(breaker.isOpen()).toBe(false); // 1 < 3
  });

  it('após N falhas consecutivas ABRE: deixa de tentar o primary e vai direto ao fallback', async () => {
    const { breaker, primary, fallback } = make(3);
    primary.setFail(true);
    for (let i = 0; i < 3; i++) await breaker.synth(REQ); // 3 falhas -> abre
    expect(breaker.isOpen()).toBe(true);
    expect(primary.calls.n).toBe(3);

    // Enquanto aberto, o primary NÃO é chamado (evita o stall de 15s).
    await expect(breaker.synth(REQ)).resolves.toBe('/piper.wav');
    await breaker.synth(REQ);
    expect(primary.calls.n).toBe(3); // inalterado
    expect(fallback.calls.n).toBe(5); // 3 (degradação) + 2 (aberto)
  });

  it('MEIO-ABERTO após o cooldown: re-sonda o primary; sucesso FECHA', async () => {
    const { breaker, primary, advance } = make(3, 60_000);
    primary.setFail(true);
    for (let i = 0; i < 3; i++) await breaker.synth(REQ); // abre
    expect(breaker.isOpen()).toBe(true);

    advance(60_000); // cooldown expira
    expect(breaker.isOpen()).toBe(false);
    primary.setFail(false); // a Google recuperou
    await expect(breaker.synth(REQ)).resolves.toBe('/gtts.wav'); // sonda e fecha
    expect(primary.calls.n).toBe(4);
    // Já fechado: continua a usar o primary.
    await breaker.synth(REQ);
    expect(primary.calls.n).toBe(5);
    expect(breaker.isOpen()).toBe(false);
  });

  it('MEIO-ABERTO com falha REABRE por outro cooldown', async () => {
    const { breaker, primary, advance } = make(3, 60_000);
    primary.setFail(true);
    for (let i = 0; i < 3; i++) await breaker.synth(REQ); // abre
    advance(60_000);
    await breaker.synth(REQ); // sonda, falha -> reabre
    expect(breaker.isOpen()).toBe(true);
    expect(primary.calls.n).toBe(4); // uma sondagem
  });

  it('um sucesso reseta o contador de falhas (não abre com falhas espalhadas)', async () => {
    const { breaker, primary } = make(3);
    primary.setFail(true);
    await breaker.synth(REQ); // falha 1
    await breaker.synth(REQ); // falha 2
    primary.setFail(false);
    await breaker.synth(REQ); // sucesso -> reseta
    primary.setFail(true);
    await breaker.synth(REQ); // falha 1 (não 3)
    expect(breaker.isOpen()).toBe(false);
  });
});
