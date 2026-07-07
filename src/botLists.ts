// src/botLists.ts — Vaga 3
//
// Auto-post da contagem de servidores para o top.gg. As listas de bots ordenam por
// popularidade e usam o server_count para descoberta; publicá-lo periodicamente ajuda
// o Vozen a subir e a aparecer. OPT-IN: só arranca se TOPGG_TOKEN estiver definido.
//
// Endpoint (oficial): POST https://top.gg/api/bots/{botId}/stats
//   headers: { Authorization: <token>, Content-Type: application/json }
//   body:    { "server_count": <N> }

import { log } from './logging/logger';

const TOPGG_STATS_URL = (botId: string): string => `https://top.gg/api/bots/${botId}/stats`;
/** Intervalo entre publicações (30 min) — as listas não precisam de mais frequência. */
export const BOTLIST_POST_INTERVAL_MS = 30 * 60 * 1000;
const POST_TIMEOUT_MS = 10000;

/**
 * Publica a contagem de servidores no top.gg. PURA em relação ao ambiente (recebe o
 * token/id/contagem e um `fetchImpl` injetável para testar). Devolve true em sucesso
 * (HTTP 2xx), false caso contrário — NUNCA lança (uma falha de rede não deve derrubar
 * o bot nem o intervalo). Timeout defensivo.
 */
export async function postTopggStats(
  botId: string,
  token: string,
  serverCount: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(TOPGG_STATS_URL(botId), {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_count: serverCount }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn(`[botlist] top.gg respondeu HTTP ${res.status} ao publicar server_count.`);
      return false;
    }
    log.info(`[botlist] top.gg atualizado: ${serverCount} servidores.`);
    return true;
  } catch (err) {
    log.warn('[botlist] falha ao publicar no top.gg (ignorado):', (err as Error).message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface BotListDeps {
  /** Application id do bot (= id no top.gg). */
  botId: string;
  /** Token da API do top.gg (opt-in). Ausente/vazio => o updater não arranca. */
  token?: string;
  /** Devolve a contagem ATUAL de servidores (ex.: () => client.guilds.cache.size). */
  serverCount: () => number;
  // Injetáveis para teste (timers + fetch); defaults = globais reais.
  setIntervalImpl?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalImpl?: (h: ReturnType<typeof setInterval>) => void;
  fetchImpl?: typeof fetch;
}

/**
 * Arranca o updater periódico. OPT-IN: sem `token`, devolve um stop() no-op e não faz
 * nada (default). Com token, publica UMA vez já e depois a cada BOTLIST_POST_INTERVAL_MS.
 * Devolve um stop() que cancela o intervalo (usado no shutdown/testes). O timer é
 * `unref`'d para nunca segurar o processo aberto.
 */
export function startBotListUpdater(deps: BotListDeps): () => void {
  if (!deps.token) return () => {};
  const token = deps.token;
  const setIv = deps.setIntervalImpl ?? setInterval;
  const clearIv = deps.clearIntervalImpl ?? clearInterval;
  const post = (): void => {
    void postTopggStats(deps.botId, token, deps.serverCount(), deps.fetchImpl ?? fetch);
  };
  post(); // primeira publicação imediata
  const handle = setIv(post, BOTLIST_POST_INTERVAL_MS);
  (handle as unknown as { unref?: () => void }).unref?.();
  log.info('[botlist] auto-post da contagem de servidores para o top.gg ATIVO.');
  return () => clearIv(handle);
}
