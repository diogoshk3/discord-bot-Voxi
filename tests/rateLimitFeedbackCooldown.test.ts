// tests/rateLimitFeedbackCooldown.test.ts — testes puros do RateLimitFeedbackCooldown
// (plano 030, ABUSE-02). Mesma estrutura do greetCooldown.test.ts: relógio injetável,
// janela FIXA, poda por MAX_ENTRIES.
import { describe, it, expect } from 'vitest';
import {
  RateLimitFeedbackCooldown,
  RATE_LIMIT_FEEDBACK_WINDOW_MS,
} from '../src/commands/messageHandler';

const G = 'guild-1';
const U = 'user-1';

/** RateLimitFeedbackCooldown com relógio controlado: o teste move `t` e injeta () => t. */
function makeClock(start = 0): { cd: RateLimitFeedbackCooldown; set: (ms: number) => void } {
  let t = start;
  const cd = new RateLimitFeedbackCooldown(() => t);
  return { cd, set: (ms: number) => (t = ms) };
}

describe('RateLimitFeedbackCooldown', () => {
  it('a 1.ª mensagem dropada de um (guild,user) sempre notifica', () => {
    const { cd } = makeClock();
    expect(cd.shouldNotify(G, U)).toBe(true);
  });

  it('drop seguinte DENTRO da janela é suprimido (não notifica outra vez)', () => {
    const { cd, set } = makeClock(0);
    expect(cd.shouldNotify(G, U)).toBe(true);
    set(1000);
    expect(cd.shouldNotify(G, U)).toBe(false);
  });

  it('drop DEPOIS da janela volta a notificar', () => {
    const { cd, set } = makeClock(0);
    expect(cd.shouldNotify(G, U)).toBe(true);
    set(RATE_LIMIT_FEEDBACK_WINDOW_MS + 1);
    expect(cd.shouldNotify(G, U)).toBe(true);
  });

  it('exatamente na fronteira (== janela) já notifica (limite não-inclusivo)', () => {
    const { cd, set } = makeClock(0);
    expect(cd.shouldNotify(G, U)).toBe(true);
    set(RATE_LIMIT_FEEDBACK_WINDOW_MS);
    expect(cd.shouldNotify(G, U)).toBe(true);
  });

  it('janela FIXA: um drop suprimido não estende a janela', () => {
    const { cd, set } = makeClock(0);
    expect(cd.shouldNotify(G, U)).toBe(true); // t=0, regista 0
    set(RATE_LIMIT_FEEDBACK_WINDOW_MS - 1000);
    expect(cd.shouldNotify(G, U)).toBe(false); // suprimido, NÃO regista este instante
    set(RATE_LIMIT_FEEDBACK_WINDOW_MS);
    expect(cd.shouldNotify(G, U)).toBe(true); // janela desde t=0 (não desde o suprimido)
  });

  it('utilizadores e guilds diferentes são independentes', () => {
    const { cd } = makeClock(0);
    expect(cd.shouldNotify(G, U)).toBe(true);
    expect(cd.shouldNotify(G, 'user-2')).toBe(true); // outro user, mesma guild
    expect(cd.shouldNotify('guild-2', U)).toBe(true); // mesmo user, outra guild
    expect(cd.shouldNotify(G, U)).toBe(false); // o par original continua em cooldown
  });

  it('não rebenta com muitas chaves (poda mantém o mapa limitado)', () => {
    const { cd } = makeClock(0);
    for (let i = 0; i < 12_000; i++) expect(cd.shouldNotify(G, `user-${i}`)).toBe(true);
    // sanidade: uma chave recente continua a responder corretamente
    expect(cd.shouldNotify(G, 'user-11999')).toBe(false);
  });
});
