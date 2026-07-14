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

/** Corpo máximo encaminhado (antes do invólucro cabeçalho+code block). */
const MAX_BODY = 1500;
// Forma de um token de bot do Discord (3 blocos base64url separados por '.').
const DISCORD_TOKEN_RE = /[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}/g;
// Chave da OpenAI ("sk-..."): pode aparecer solta em erros do SDK, não só em
// Authorization (ex.: mensagens de erro do cliente HTTP que ecoam a config).
const OPENAI_KEY_RE = /sk-[A-Za-z0-9_-]{20,}/g;
// Header x-goog-api-key (Google Cloud TTS/Translate): valor da chave.
const GOOGLE_HEADER_RE = /x-goog-api-key['":\s]*[:=]\s*['"]?[A-Za-z0-9_-]{10,}/gi;
// Query param key=... — a API REST da Google aceita a chave na própria URL
// (?key=<chave>), por isso um erro HTTP pode ecoar o URL completo.
const GOOGLE_QUERY_KEY_RE = /([?&]key=)[A-Za-z0-9_-]{10,}/gi;
// Credencial "Bearer xxx" (headers HTTP ecoados em mensagens de erro).
const BEARER_RE = /Bearer\s+[\w.~+/=-]+/gi;
// Header Authorization genérico (esquemas != Bearer, ex. Basic, ou uma chave crua sem
// esquema). O lookahead exclui "Bearer" (já tratado acima, com o marcador "Bearer […]");
// o valor tem de COMEÇAR por um char não-espaço para o \s* anterior não conseguir "devolver"
// o espaço e assim contornar o lookahead ao ficar posicionado mesmo antes de "Bearer".
const AUTH_HEADER_RE = /authorization\s*[:=]\s*['"]?(?!Bearer\b)[^\s"'`,;\r\n][^"'`,;\r\n]*/gi;

/**
 * SEC-03 / SECRET-03: o texto de um erro pode ecoar credenciais (token do bot num erro
 * do discord.js, chave da OpenAI/Google, header Authorization num erro HTTP). Redige-as
 * ANTES do envio para o webhook (que é um canal de chat) e limita o tamanho — redigir
 * primeiro, cortar depois, para um corte nunca deixar meio token/chave visível.
 */
function scrub(text: string): string {
  return text
    .replace(DISCORD_TOKEN_RE, '[token-redigido]')
    .replace(OPENAI_KEY_RE, '[chave-redigida]')
    .replace(GOOGLE_HEADER_RE, 'x-goog-api-key: [chave-redigida]')
    .replace(GOOGLE_QUERY_KEY_RE, '$1[chave-redigida]')
    .replace(BEARER_RE, 'Bearer [redigido]')
    .replace(AUTH_HEADER_RE, 'authorization: [redigido]')
    .slice(0, MAX_BODY);
}

/** Formata o erro como content de webhook (cabeçalho + stack num code block, truncado). */
export function formatErrorMessage(error: unknown, context: string): string {
  const e = error as { stack?: string; message?: string };
  const head = `⚠️ **Vozen** — erro em \`${context}\``;
  const body = scrub(String(e?.stack || e?.message || String(error)));
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
