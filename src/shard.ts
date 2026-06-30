/**
 * P11.4 — Launcher de SHARDING (opt-in). NÃO e o entrypoint default.
 *
 * O entrypoint de sempre continua a ser `src/index.ts` (um unico processo). Este
 * ficheiro e um arranque ALTERNATIVO, acessivel via `npm run start:sharded`
 * (= `node dist/shard.js`), pensado para escalar perto dos ~1000+ guilds, onde o
 * Discord exige multiplos gateway shards (≈1 shard / 1000 guilds).
 *
 * Decisao (delegada a resolveShardCount, a partir de config.shards / env
 * BOT_SHARDS — NAO `SHARDS`, que e reservada pelo discord.js; ver src/config):
 *   - SEM sharding (null): corre o bot single-process DIRETAMENTE, com um
 *     `require('./index')` PREGUICOSO — assim `start:sharded` funciona mesmo sem
 *     BOT_SHARDS definido, sem obrigar ninguem a trocar de script.
 *   - COM sharding ('auto' | N): cria um ShardingManager que faz spawn de N
 *     processos-filho, cada um a correr `index.js` (o MESMO entrypoint de sempre).
 *
 * INVARIANTE CRITICA (evita spawn infinito): o ShardingManager so e construido
 * AQUI. O `index.ts` nunca constroi um manager — os filhos correm index.js e
 * ligam-se ao Discord como bots normais. Por isso o `require('./index')` so pode
 * acontecer no ramo single-process, e o ShardingManager aponta para index.js, NÃO
 * para este ficheiro.
 */
import path from 'node:path';
import { ShardingManager } from 'discord.js';
import { loadConfig } from './config/index';
import { log } from './logging/logger';
import { resolveShardCount } from './sharding';

/**
 * Arranque efetivo. Separado do guard `require.main` para que os testes possam
 * importar este modulo sem disparar login/spawn (modulo import-safe).
 */
export function runShardLauncher(): void {
  const config = loadConfig();
  const totalShards = resolveShardCount(config.shards);

  if (totalShards === null) {
    // SEM sharding: corre o bot single-process. require PREGUICOSO — importar
    // ./index no topo executaria main() (login no Discord) sempre, inclusive no
    // ramo de sharding, o que NÃO queremos.
    log.info('[shard] BOT_SHARDS ausente/desativado — a correr single-process (default).');
    require('./index');
    return;
  }

  // COM sharding. O alvo e index.js (o entrypoint de cada filho), resolvido a
  // partir de __dirname para ser robusto ao cwd: em runtime este ficheiro vive em
  // dist/, logo __dirname/index.js => dist/index.js independentemente de onde o
  // processo foi lancado. O token e necessario para totalShards:'auto' (o manager
  // pergunta ao Discord a contagem recomendada).
  const file = path.join(__dirname, 'index.js');
  const manager = new ShardingManager(file, {
    token: config.token,
    totalShards,
  });

  manager.on('shardCreate', (shard) => {
    log.info(`[shard] shard #${shard.id} lancado.`);
  });

  log.info(`[shard] sharding ATIVO (totalShards=${totalShards}). A fazer spawn…`);
  manager.spawn().catch((err) => {
    log.error('[shard] falha ao fazer spawn dos shards', err);
    process.exit(1);
  });
}

// So arranca quando executado diretamente (`node dist/shard.js`). Um teste que
// importe este modulo NÃO dispara o arranque.
if (require.main === module) {
  runShardLauncher();
}
