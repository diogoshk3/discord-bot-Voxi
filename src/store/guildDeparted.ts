// src/store/guildDeparted.ts
//
// Retenção de dados por-SERVIDOR (conformidade §5(b)): quando o bot é removido de um
// servidor, marca-se a saída. Se o servidor não re-convidar o bot dentro de 30 dias, os
// seus dados são purgados por um job diário. O grace period existe para um kick acidental
// ou uma migração de servidor não apagarem tudo de imediato.
//
// IMPORTANTE: a marcação vem do handler REAL de GuildDelete (client.ts), que já ignora os
// outages (guild.available === false). Assim uma queda transitória do Discord nunca agenda
// eliminação de dados de servidores que não saíram.
import type Database from 'better-sqlite3';
import { purgeGuild } from './dataLifecycle';

/** Janela entre a saída e a purga dos dados (30 dias). */
export const DEPARTURE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/** Marca (ou re-marca) o momento em que o bot saiu de um servidor. */
export function markGuildDeparted(db: Database.Database, guildId: string, now: number): void {
  db.prepare(
    `INSERT INTO guild_departed (guild_id, left_at) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET left_at = excluded.left_at`,
  ).run(guildId, now);
}

/** Remove a marca de saída (bot re-convidado antes da purga). */
export function unmarkGuildDeparted(db: Database.Database, guildId: string): void {
  db.prepare('DELETE FROM guild_departed WHERE guild_id = ?').run(guildId);
}

/**
 * Purga os dados dos servidores cuja saída foi há mais de `graceMs`. Para cada um chama
 * `purgeGuild` (apaga o conteúdo/config/stats, mantém o financeiro) e limpa a marca.
 * Devolve os guildIds purgados (para log). Idempotente: correr duas vezes não repete nada.
 */
export function purgeDepartedGuilds(
  db: Database.Database,
  now: number,
  graceMs: number = DEPARTURE_GRACE_MS,
): string[] {
  const cutoff = now - graceMs;
  const rows = db.prepare('SELECT guild_id FROM guild_departed WHERE left_at <= ?').all(cutoff) as {
    guild_id: string;
  }[];
  const purged: string[] = [];
  for (const { guild_id: guildId } of rows) {
    purgeGuild(db, guildId); // apaga tudo, incl. a própria marca (guild_departed ∈ purga)
    unmarkGuildDeparted(db, guildId); // rede de segurança caso a marca sobreviva
    purged.push(guildId);
  }
  return purged;
}

/** Intervalo do job de purga (1x/dia). */
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Arranca o job de purga: corre 1x no arranque e depois de 24 em 24h. Nunca lança (um erro
 * numa corrida não pode derrubar o bot). O timer é unref'd (não segura o processo). Devolve
 * um `stop()` para testes/encerramento. A lógica pura está em `purgeDepartedGuilds`.
 */
export function startDepartedPurgeJob(
  db: Database.Database,
  onPurged: (guildIds: string[]) => void,
): () => void {
  const tick = (): void => {
    try {
      const ids = purgeDepartedGuilds(db, Date.now());
      if (ids.length > 0) onPurged(ids);
    } catch {
      // best-effort: nunca crashar o loop de manutenção.
    }
  };
  tick();
  const timer = setInterval(tick, PURGE_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
