// src/store/cache.ts
//
// Cache WRITE-THROUGH das tabelas ESTÁVEIS lidas a cada mensagem (guild_config,
// blocklist, pronúncia, voz/nickname/opt-out/deteção por-user, efeito, clone). As
// leituras populam a cache; CADA setter tem de a invalidar. Isto tira ~9 queries
// SQLite síncronas do event-loop por mensagem, mantendo as leituras sempre corretas
// DENTRO do processo.
//
// REGRA DE OURO: quem adicionar um setter novo a uma tabela cacheada TEM de chamar
// invalidate(...) para a mesma chave — senão a alteração fica stale-até-restart.
//
// Escopo por-INSTÂNCIA de db (WeakMap): testes com :memory: novos por teste nunca se
// contaminam, e fechar a db liberta as entradas (GC).

import type Database from 'better-sqlite3';

interface Entry {
  value: unknown;
  at: number;
}
type TableCache = Map<string, Entry>;
const caches = new WeakMap<Database.Database, Map<string, TableCache>>();

/** Nº máximo de entradas por tabela; ao exceder, limpa tudo (read-through repõe). */
const MAX_ENTRIES_PER_TABLE = 10_000;

/**
 * Tabelas com chave por-GUILD (chave === guildId ou prefixo `guildId:`). Só estas são
 * purgadas em invalidateGuild; o user_clone (chave global userId) é evictado só pelos
 * seus próprios invalidates + TTL.
 */
const GUILD_KEYED = new Set([
  'guild_config',
  'blocklist',
  'pronunciation',
  'user_voice',
  'user_nickname',
  'tts_optout',
  'tts_lang_detect_on',
  'user_effect',
]);

function tableMap(db: Database.Database, table: string): TableCache {
  let byTable = caches.get(db);
  if (!byTable) {
    byTable = new Map();
    caches.set(db, byTable);
  }
  let map = byTable.get(table);
  if (!map) {
    map = new Map();
    byTable.set(table, map);
  }
  return map;
}

/**
 * Devolve o valor cacheado para (db, table, key), carregando-o via `load` no miss.
 * `map.has` decide o hit — por isso valores `null`/`false` também são hits (caching
 * negativo, essencial: a maioria dos users não tem nickname/clone/voz fixada). Se
 * `ttlMs` for dado e a entrada expirou, trata-se como miss. `load` é SÍNCRONO
 * (better-sqlite3 é síncrono) — sem async, sem locks.
 */
export function cached<T>(
  db: Database.Database,
  table: string,
  key: string,
  load: () => T,
  ttlMs?: number,
): T {
  const map = tableMap(db, table);
  const hit = map.get(key);
  if (hit && (ttlMs === undefined || Date.now() - hit.at < ttlMs)) {
    return hit.value as T;
  }
  const value = load();
  // Bound de memória cru (nunca serve dados errados: o pior caso é um refill).
  if (!map.has(key) && map.size >= MAX_ENTRIES_PER_TABLE) map.clear();
  map.set(key, { value, at: Date.now() });
  return value;
}

/** Invalida uma chave de uma tabela (chamar DEPOIS de cada escrita nessa tabela). */
export function invalidate(db: Database.Database, table: string, key: string): void {
  caches.get(db)?.get(table)?.delete(key);
}

/**
 * Remove TODAS as entradas de uma guild (chave === guildId ou prefixo `guildId:`) das
 * tabelas GUILD-KEYED. Chamado no handleGuildDelete para limitar a memória. Não toca no
 * user_clone (chave global) — esse sai pelos próprios invalidates/TTL.
 */
export function invalidateGuild(db: Database.Database, guildId: string): void {
  const byTable = caches.get(db);
  if (!byTable) return;
  const prefix = `${guildId}:`;
  for (const table of GUILD_KEYED) {
    const map = byTable.get(table);
    if (!map) continue;
    for (const key of map.keys()) {
      if (key === guildId || key.startsWith(prefix)) map.delete(key);
    }
  }
}

/**
 * Tabelas cacheadas cuja chave é (ou termina em) um userId: chave === userId (user_clone,
 * global) ou sufixo `:userId` (as por-(guild,user), chave `guildId:userId`).
 */
const USER_KEYED = new Set([
  'user_voice',
  'user_nickname',
  'tts_optout',
  'user_effect',
  'user_clone',
]);

/**
 * Remove TODAS as entradas de um utilizador (em qualquer servidor) das tabelas USER-KEYED.
 * Usado pelo `eraseUser` (RGPD): apaga em vários servidores de uma vez, por isso invalidação
 * pontual não chega. Não toca em clones de que o user é ALVO mas não dono — esses são
 * invalidados individualmente por deleteClonesByTarget.
 */
export function invalidateUser(db: Database.Database, userId: string): void {
  const byTable = caches.get(db);
  if (!byTable) return;
  const suffix = `:${userId}`;
  for (const table of USER_KEYED) {
    const map = byTable.get(table);
    if (!map) continue;
    for (const key of map.keys()) {
      if (key === userId || key.endsWith(suffix)) map.delete(key);
    }
  }
}
