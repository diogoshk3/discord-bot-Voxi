/**
 * P11.4 — Scaffold de SHARDING opt-in.
 *
 * `resolveShardCount` e uma funcao PURA e determinística: traduz o valor cru da
 * env `BOT_SHARDS` na decisao de arranque, sem efeitos colaterais. E o unico
 * ponto de verdade sobre "ha sharding ou nao", para que o launcher (src/shard.ts)
 * e os testes partilhem exatamente a mesma logica.
 *
 * (A env chama-se BOT_SHARDS e NAO `SHARDS`: esta ultima e reservada e lida
 * diretamente pelo Client do discord.js — ver nota em src/config/index.ts.)
 *
 * Regra de ouro: o caminho single-process (default histórico) e o seguro, por
 * isso TUDO o que nao seja inequivocamente um pedido de sharding cai em `null`.
 *
 *   - null    => SEM sharding. Corre um unico processo (o comportamento de
 *                sempre). Acontece para ausente / vazio / "1" / "0" / invalido.
 *   - 'auto'  => deixar o ShardingManager perguntar ao Discord a contagem
 *                recomendada (≈1 shard / 1000 guilds).
 *   - N (>=2) => contagem fixa de shards.
 *
 * Notas de robustez (espelham `engineEnv` em config):
 *   - Faz trim antes de interpretar (tolera espacos da env/.env).
 *   - Usa `Number(...)` + `Number.isInteger`, NAO `parseInt`: "2abc" tem de cair
 *     em null, e `parseInt("2abc")` devolveria 2 (silenciosamente errado).
 */
export function resolveShardCount(raw: string | undefined): number | 'auto' | null {
  if (raw === undefined) return null;
  const value = raw.trim();
  if (value === '') return null;
  if (value.toLowerCase() === 'auto') return 'auto';
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2) return null;
  return n;
}
