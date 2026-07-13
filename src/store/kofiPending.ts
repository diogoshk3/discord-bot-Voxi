import type Database from 'better-sqlite3';

// Grants PENDENTES do Ko-fi: uma compra que chegou pelo webhook SEM Discord ID associável
// (o checkout de subscrição do Ko-fi não tem caixa de mensagem fiável). Em vez de a perder
// num log, guardamo-la aqui à espera de ser RECLAMADA pelo comprador no site (login Discord +
// código do recibo). Indexada pelo tx id (que o comprador tem no recibo, chave forte) e pelo
// HASH do email (para renovações órfãs); NUNCA o email em claro — ver hashKofiEmail em
// premium/kofi.ts. Ao reclamar, aplica-se o grant ao Discord ID e memoriza-se email->Discord
// ID (kofi_supporter), por isso as renovações seguintes resolvem-se sozinhas.

export interface PendingGrant {
  transactionId: string;
  /** HASH HMAC do email (nunca o email em claro), ou null se o payload não trouxe email. */
  emailHash: string | null;
  plan: string; // 'plus' | 'premium'
  days: number;
  seats: number; // relevante só para 'premium'
  createdAt: number;
  /** Unix ms em que foi reclamado, ou null enquanto por reclamar. */
  claimedAt: number | null;
}

export interface PendingGrantInput {
  transactionId: string;
  emailHash: string | null;
  plan: string;
  days: number;
  seats: number;
}

/**
 * Regista uma compra sem Discord ID como PENDENTE. INSERT OR IGNORE na PK (transaction_id):
 * idempotente — uma re-entrega do Ko-fi (mesmo tx) não duplica. Devolve true se inseriu
 * (1.ª vez), false se já existia.
 */
export function recordPendingGrant(
  db: Database.Database,
  input: PendingGrantInput,
  now: number,
): boolean {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO kofi_pending
         (transaction_id, email_hash, plan, days, seats, created_at, claimed_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(input.transactionId, input.emailHash, input.plan, input.days, input.seats, now);
  return res.changes > 0;
}

function rowToPending(row: {
  transaction_id: string;
  email_hash: string | null;
  plan: string;
  days: number;
  seats: number;
  created_at: number;
  claimed_at: number | null;
}): PendingGrant {
  return {
    transactionId: row.transaction_id,
    emailHash: row.email_hash,
    plan: row.plan,
    days: row.days,
    seats: row.seats,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
  };
}

/** Pendente NÃO reclamado com este tx id, ou null. */
export function findUnclaimedPendingByTx(
  db: Database.Database,
  transactionId: string,
): PendingGrant | null {
  const row = db
    .prepare('SELECT * FROM kofi_pending WHERE transaction_id = ? AND claimed_at IS NULL')
    .get(transactionId) as Parameters<typeof rowToPending>[0] | undefined;
  return row ? rowToPending(row) : null;
}

/**
 * TODOS os pendentes NÃO reclamados com este hash de email (renovações órfãs: quem comprou
 * várias vezes sem nunca reclamar tem vários pendentes — o claim aplica todos). Um pendente
 * sem email (email_hash NULL) nunca casa aqui (só é reclamável pelo tx id).
 */
export function listUnclaimedPendingByEmailHash(
  db: Database.Database,
  emailHash: string,
): PendingGrant[] {
  const rows = db
    .prepare(
      'SELECT * FROM kofi_pending WHERE email_hash = ? AND claimed_at IS NULL ORDER BY created_at',
    )
    .all(emailHash) as Parameters<typeof rowToPending>[0][];
  return rows.map(rowToPending);
}

/**
 * Marca o pendente como reclamado. Idempotente: só afeta linhas ainda por reclamar
 * (claimed_at IS NULL), por isso um 2.º claim do mesmo tx devolve false sem re-aplicar.
 */
export function markPendingClaimed(
  db: Database.Database,
  transactionId: string,
  now: number,
): boolean {
  const res = db
    .prepare(
      'UPDATE kofi_pending SET claimed_at = ? WHERE transaction_id = ? AND claimed_at IS NULL',
    )
    .run(now, transactionId);
  return res.changes > 0;
}

/**
 * Purga pendentes criados antes de `cutoff` (minimização de dados — mesmo espírito da purga
 * de guilds saídas). Apaga reclamados e não-reclamados velhos: os reclamados já foram
 * aplicados e o ledger kofi_transaction continua a garantir a idempotência do webhook.
 * Devolve o nº de linhas removidas.
 */
export function purgeOldPendingGrants(db: Database.Database, cutoff: number): number {
  const res = db.prepare('DELETE FROM kofi_pending WHERE created_at < ?').run(cutoff);
  return res.changes;
}

/** Retenção de um pendente (90 dias). Depois disto a compra abandonada é apagada
 * (minimização de dados). O comprador reclama muito antes; as renovações não dependem de
 * pendentes antigos (usam o mapa email->Discord ID memorizado no 1.º claim). */
export const PENDING_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Intervalo do job de purga (1x/dia). */
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Arranca o job de purga de pendentes: corre 1x no arranque e depois 1x/dia. Nunca lança
 * (uma corrida não pode derrubar o bot). O timer é unref'd (não segura o processo). Devolve
 * um `stop()` para testes/encerramento. A lógica pura está em `purgeOldPendingGrants`.
 */
export function startPendingPurgeJob(
  db: Database.Database,
  onPurged?: (removed: number) => void,
): () => void {
  const tick = (): void => {
    try {
      const removed = purgeOldPendingGrants(db, Date.now() - PENDING_RETENTION_MS);
      if (removed > 0 && onPurged) onPurged(removed);
    } catch {
      // best-effort: nunca crashar o loop de manutenção.
    }
  };
  tick();
  const timer = setInterval(tick, PURGE_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
