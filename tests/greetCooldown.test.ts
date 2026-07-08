import { describe, it, expect } from 'vitest';
import { GreetCooldown, GREET_COOLDOWN_MS } from '../src/voice/greetCooldown';

const G = 'guild-1';
const U = 'user-1';

/** GreetCooldown com relógio controlado: o teste move `t` e injeta () => t. */
function makeClock(start = 0): { cd: GreetCooldown; set: (ms: number) => void } {
  let t = start;
  const cd = new GreetCooldown(() => t);
  return { cd, set: (ms: number) => (t = ms) };
}

describe('GreetCooldown', () => {
  it('a 1.ª entrada é sempre saudada', () => {
    const { cd } = makeClock();
    expect(cd.shouldGreet(G, U)).toBe(true);
  });

  it('reentrada DENTRO da janela (2 min) é suprimida', () => {
    const { cd, set } = makeClock(0);
    expect(cd.shouldGreet(G, U)).toBe(true);
    set(2 * 60 * 1000);
    expect(cd.shouldGreet(G, U)).toBe(false);
  });

  it('reentrada DEPOIS da janela (6 min) volta a saudar', () => {
    const { cd, set } = makeClock(0);
    expect(cd.shouldGreet(G, U)).toBe(true);
    set(6 * 60 * 1000);
    expect(cd.shouldGreet(G, U)).toBe(true);
  });

  it('exatamente na fronteira (== cooldown) já sauda (limite não-inclusivo)', () => {
    const { cd, set } = makeClock(0);
    expect(cd.shouldGreet(G, U)).toBe(true);
    set(GREET_COOLDOWN_MS);
    expect(cd.shouldGreet(G, U)).toBe(true);
  });

  it('janela FIXA: um pedido suprimido não estende a janela', () => {
    const { cd, set } = makeClock(0);
    expect(cd.shouldGreet(G, U)).toBe(true); // t=0, regista 0
    set(4 * 60 * 1000);
    expect(cd.shouldGreet(G, U)).toBe(false); // suprimido, NÃO regista 4min
    set(5 * 60 * 1000);
    expect(cd.shouldGreet(G, U)).toBe(true); // 5min desde t=0 (não desde os 4min)
  });

  it('utilizadores e guilds diferentes são independentes', () => {
    const { cd } = makeClock(0);
    expect(cd.shouldGreet(G, U)).toBe(true);
    expect(cd.shouldGreet(G, 'user-2')).toBe(true); // outro user, mesma guild
    expect(cd.shouldGreet('guild-2', U)).toBe(true); // mesmo user, outra guild
    expect(cd.shouldGreet(G, U)).toBe(false); // o par original continua em cooldown
  });

  it('não rebenta com muitas chaves (poda mantém o mapa limitado)', () => {
    const { cd } = makeClock(0);
    for (let i = 0; i < 12_000; i++) expect(cd.shouldGreet(G, `user-${i}`)).toBe(true);
    // sanidade: uma chave recente continua a responder corretamente
    expect(cd.shouldGreet(G, 'user-11999')).toBe(false);
  });
});
