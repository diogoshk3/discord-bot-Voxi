import { describe, it, expect, vi } from 'vitest';
import { createErrorReporter, formatErrorMessage } from '../src/errorReporter';

// Params tipados (url, opts) p/ o typecheck: sem eles .mock.calls fica tuplo vazio.
// O mock é passado com cast `as unknown as typeof fetch`, por isso a forma do opts
// pode ser a que o teste lê (method+body).
function okFetch() {
  return vi.fn(async (_url: string, _opts: { method: string; body: string }) => ({ ok: true, status: 204 }) as Response);
}

describe('formatErrorMessage', () => {
  it('inclui o contexto e o stack num code block', () => {
    const msg = formatErrorMessage(new Error('boom'), 'gateway');
    expect(msg).toContain('gateway');
    expect(msg).toContain('boom');
    expect(msg).toContain('```');
  });

  it('trunca conteúdos gigantes para caber no limite do Discord', () => {
    const big = new Error('x'.repeat(5000));
    const msg = formatErrorMessage(big, 'ctx');
    expect(msg.length).toBeLessThanOrEqual(1900);
  });

  it('SEC-03: redige um token com forma de token do Discord', () => {
    // Token SINTÉTICO (nunca um real): 3 blocos base64url com os comprimentos típicos.
    const fake = `${'A'.repeat(24)}.${'B'.repeat(6)}.${'C'.repeat(27)}`;
    const msg = formatErrorMessage(new Error(`401 ao usar ${fake}`), 'ctx');
    expect(msg).not.toContain(fake);
    expect(msg).toContain('[token-redigido]');
  });

  it('SEC-03: redige credenciais Bearer', () => {
    const msg = formatErrorMessage(new Error('Authorization: Bearer abc.def-123'), 'ctx');
    expect(msg).not.toContain('abc.def-123');
    expect(msg).toContain('Bearer [redigido]');
  });

  it('SEC-03: corpo limitado a 1500 chars antes do invólucro', () => {
    const msg = formatErrorMessage(new Error('x'.repeat(5000)), 'ctx');
    // corpo = 1500; invólucro (cabeçalho + code fences) é pequeno e fixo
    expect(msg.length).toBeLessThanOrEqual(1500 + 100);
  });
});

describe('createErrorReporter', () => {
  it('sem url -> no-op (não faz fetch)', async () => {
    const fetchImpl = okFetch();
    const r = createErrorReporter(undefined, fetchImpl as unknown as typeof fetch);
    expect(await r.report(new Error('e'), 'ctx')).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('com url -> envia POST ao webhook com content', async () => {
    const fetchImpl = okFetch();
    const r = createErrorReporter('https://discord.com/api/webhooks/x', fetchImpl as unknown as typeof fetch);
    expect(await r.report(new Error('boom'), 'gateway')).toBe(true);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://discord.com/api/webhooks/x');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).content).toContain('boom');
  });

  it('DEDUP: o mesmo erro só é enviado UMA vez', async () => {
    const fetchImpl = okFetch();
    const r = createErrorReporter('https://wh', fetchImpl as unknown as typeof fetch);
    const err = new Error('repetido');
    await r.report(err, 'ctx');
    await r.report(err, 'ctx');
    await r.report(err, 'ctx');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 2ª e 3ª suprimidas
  });

  it('erros DIFERENTES são ambos enviados', async () => {
    const fetchImpl = okFetch();
    const r = createErrorReporter('https://wh', fetchImpl as unknown as typeof fetch);
    await r.report(new Error('um'), 'ctx');
    await r.report(new Error('dois'), 'ctx');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falha de rede -> false, nunca lança', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const r = createErrorReporter('https://wh', fetchImpl as unknown as typeof fetch);
    expect(await r.report(new Error('e'), 'ctx')).toBe(false);
  });

  // Bug-hunt 2026-07: o hash era marcado "seen" ANTES do envio ter sucesso, por isso
  // uma falha transitória perdia esse erro para sempre na janela de dedup. Agora, se o
  // envio falhar, a MESMA ocorrência pode ser re-tentada; a dedup só cola após sucesso.
  it('envio falhado NÃO deduplica: a próxima ocorrência re-tenta e ao ter sucesso passa a deduplicar', async () => {
    let ok = false;
    const fetchImpl = vi.fn(async () => {
      if (!ok) throw new Error('down');
      return { ok: true, status: 204 } as Response;
    });
    const r = createErrorReporter('https://wh', fetchImpl as unknown as typeof fetch);
    const err = new Error('flaky');
    // 1ª: rede em baixo -> false, e NÃO fica preso como "seen".
    expect(await r.report(err, 'ctx')).toBe(false);
    // 2ª: rede recupera -> re-tenta e envia (prova de que não foi deduplicado).
    ok = true;
    expect(await r.report(err, 'ctx')).toBe(true);
    // 3ª: agora sim deduplica (já foi enviado com sucesso).
    expect(await r.report(err, 'ctx')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('dedup distingue rejeições NÃO-Error diferentes (objetos simples)', async () => {
    const fetchImpl = okFetch();
    const r = createErrorReporter('https://wh', fetchImpl as unknown as typeof fetch);
    await r.report({ code: 'A', detail: 'um' }, 'ctx');
    await r.report({ code: 'B', detail: 'dois' }, 'ctx');
    // Antes: ambos hasheavam "[object Object]" e o 2.º era suprimido. Agora: 2 envios.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
