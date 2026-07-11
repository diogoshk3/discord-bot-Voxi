import type Database from 'better-sqlite3';

// Códigos de presente (gift codes): o dono gera com /gencode (owner-only), a pessoa
// resgata com /redeem. USO ÚNICO — o resgate é atómico (transação + UPDATE ... WHERE
// redeemed_by IS NULL) para dois resgates simultâneos não gastarem o mesmo código duas
// vezes. Ver a tabela premium_code em db.ts. O grant em si reutiliza grantUserPremium/
// grantGuildPass (como o Ko-fi e o /vozengrant), com source 'code'.

export type CodePlan = 'premium' | 'plus';

export interface PremiumCodeInput {
  code: string;
  plan: CodePlan;
  days: number;
  /** Só relevante para 'premium' (nº de licenças do passe); 0 para 'plus'. */
  seats: number;
  createdBy: string;
  createdAt: number;
  /** Validade do CÓDIGO (unix ms) — null = nunca expira. Não confundir com a duração do premium. */
  expiresAt: number | null;
}

export interface PremiumCodeRow extends PremiumCodeInput {
  redeemedBy: string | null;
  redeemedAt: number | null;
}

export type RedeemResult =
  | { ok: true; plan: CodePlan; days: number; seats: number }
  | { ok: false; reason: 'not-found' | 'used' | 'expired' };

/** Insere um novo código. Devolve false se o código já existir (colisão — o chamador regera). */
export function insertPremiumCode(db: Database.Database, c: PremiumCodeInput): boolean {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO premium_code
         (code, plan, days, seats, created_by, created_at, expires_at, redeemed_by, redeemed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    )
    .run(c.code, c.plan, c.days, c.seats, c.createdBy, c.createdAt, c.expiresAt);
  return res.changes > 0;
}

/** Lê um código pelo valor (já normalizado). null se não existir. */
export function getPremiumCode(db: Database.Database, code: string): PremiumCodeRow | null {
  const r = db.prepare('SELECT * FROM premium_code WHERE code = ?').get(code) as
    | {
        code: string;
        plan: string;
        days: number;
        seats: number;
        created_by: string;
        created_at: number;
        expires_at: number | null;
        redeemed_by: string | null;
        redeemed_at: number | null;
      }
    | undefined;
  if (!r) return null;
  return {
    code: r.code,
    plan: r.plan as CodePlan,
    days: r.days,
    seats: r.seats,
    createdBy: r.created_by,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    redeemedBy: r.redeemed_by,
    redeemedAt: r.redeemed_at,
  };
}

/** O que o código concede — passado ao `applyGrant` para ele aplicar o premium. */
export interface RedeemClaim {
  plan: CodePlan;
  days: number;
  seats: number;
}

/**
 * Resgata um código ATOMICAMENTE (uso único). Numa transação: valida existência/uso/
 * expiração, reclama a linha com UPDATE ... WHERE redeemed_by IS NULL e — na MESMA
 * transação — aplica o grant via `applyGrant`. Se dois resgates corressem juntos, só um
 * vê changes>0; o outro recebe 'used'. Se o `applyGrant` rebentar, a transação reverte e o
 * código NÃO fica queimado (mesmo padrão do webhook Ko-fi: reclamar+conceder é atómico).
 * `applyGrant` recebe o MESMO `db` (dentro da transação) e é síncrono (better-sqlite3).
 */
export function redeemPremiumCode(
  db: Database.Database,
  code: string,
  userId: string,
  now: number,
  applyGrant?: (db: Database.Database, claim: RedeemClaim) => void,
): RedeemResult {
  return db.transaction((): RedeemResult => {
    const row = getPremiumCode(db, code);
    if (!row) return { ok: false, reason: 'not-found' };
    if (row.redeemedBy) return { ok: false, reason: 'used' };
    if (row.expiresAt != null && row.expiresAt <= now) return { ok: false, reason: 'expired' };
    const upd = db
      .prepare(
        'UPDATE premium_code SET redeemed_by = ?, redeemed_at = ? WHERE code = ? AND redeemed_by IS NULL',
      )
      .run(userId, now, code);
    if (upd.changes === 0) return { ok: false, reason: 'used' }; // corrida: alguém resgatou primeiro
    // Grant DENTRO da transação: se rebentar, o UPDATE acima reverte junto.
    applyGrant?.(db, { plan: row.plan, days: row.days, seats: row.seats });
    return { ok: true, plan: row.plan, days: row.days, seats: row.seats };
  })();
}
