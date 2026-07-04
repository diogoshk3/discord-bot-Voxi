// src/errorReporter.ts — Vaga 3
//
// Envia erros INESPERADOS (gateway, unhandledRejection, uncaughtException) para um
// webhook do Discord, para o operador ver problemas em produção sem ter de ler logs.
// OPT-IN: sem ERROR_WEBHOOK_URL, é no-op. DEDUP por hash do stack — o MESMO erro a
// repetir-se não faz spam do canal. NUNCA lança (um problema a reportar o erro não
// pode ele próprio derrubar o bot).

import { createHash } from 'node:crypto';
import { log } from './logging/logger';

/** Limpa a janela de dedup quando chega a este nº de erros distintos (evita crescer sem fim). */
const DEDUP_CAP = 500;
/** Margem abaixo do limite de 2000 chars do content do Discord. */
const MAX_CONTENT = 1900;

function hashError(error: unknown): string {
  const e = error as { stack?: string; message?: string };
  let key = e?.stack || e?.message;
  if (!key) {
    // Rejeições NÃO-Error (objeto simples, string, etc.) — comum no unhandledRejection.
    // Sem isto, tudo caía em String(error) === "[object Object]" e colidia num só hash,
    // deduplicando falhas genuinamente diferentes. Serializa (guardado) para distinguir.
    try {
      key = JSON.stringify(error);
    } catch {
      key = String(error);
    }
  }
  return createHash('sha1').update(String(key).slice(0, 1000)).digest('hex');
}

/** Formata o erro como content de webhook (cabeçalho + stack num code block, truncado). */
export function formatErrorMessage(error: unknown, context: string): string {
  const e = error as { stack?: string; message?: string };
  const head = `⚠️ **Voxi** — erro em \`${context}\``;
  const body = e?.stack || e?.message || String(error);
  const full = `${head}\n\`\`\`\n${body}\n\`\`\``;
  if (full.length <= MAX_CONTENT) return full;
  return `${full.slice(0, MAX_CONTENT - 4)}\n\`\`\``;
}

export interface ErrorReporter {
  /** Envia o erro (fire-and-forget-friendly). Devolve true se enviado, false se
   * suprimido (dedup / sem url) ou falhou. NUNCA lança. */
  report(error: unknown, context: string): Promise<boolean>;
}

/**
 * Cria um reporter com a sua PRÓPRIA janela de dedup (isolável em testes). `url`
 * ausente => report() é no-op. `fetchImpl` injetável para teste.
 */
export function createErrorReporter(
  url: string | undefined,
  fetchImpl: typeof fetch = fetch,
): ErrorReporter {
  const seen = new Set<string>();
  return {
    async report(error, context) {
      if (!url) return false;
      const h = hashError(error);
      if (seen.has(h)) return false; // já reportado — não faz spam
      if (seen.size >= DEDUP_CAP) seen.clear();
      // Marca ANTES do await para deduplicar envios concorrentes do MESMO erro; mas
      // remove se o envio FALHAR, para que a próxima ocorrência possa re-tentar — senão
      // uma falha transitória (429/5xx/rede) perdia esse sinal para sempre nesta janela.
      seen.add(h);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: formatErrorMessage(error, context) }),
        });
        if (!res.ok) {
          seen.delete(h);
          return false;
        }
        return true;
      } catch (err) {
        seen.delete(h);
        log.warn(
          '[errorReporter] falha a enviar erro para o webhook (ignorado):',
          (err as Error).message,
        );
        return false;
      }
    },
  };
}
