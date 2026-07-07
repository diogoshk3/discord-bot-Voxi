import type Database from 'better-sqlite3';

// Clone de voz por-UTILIZADOR (GLOBAL, como as abreviaturas — a voz é da pessoa, não
// do servidor). CONSENT-FIRST: a linha só existe depois de haver consentimento, e
// `consent_at` regista quando. O DONO (`user_id`) é quem gravou e vai FALAR com a voz;
// `target_id` é a pessoa cuja VOZ foi gravada (== dono num auto-clone; diferente quando
// A grava a voz de B). O dono usa/apaga o seu clone; ALÉM disso, a pessoa gravada
// (`target_id`) pode SEMPRE revogar qualquer clone feito a partir da sua voz (RGPD).

export interface CloneRow {
  samplePath: string;
  consentAt: number;
  enabled: boolean;
  /** Pessoa cuja voz foi gravada (dono quando é auto-clone). */
  targetId: string;
}

export function getClone(db: Database.Database, userId: string): CloneRow | null {
  const row = db
    .prepare('SELECT sample_path, consent_at, enabled, target_id FROM user_clone WHERE user_id = ?')
    .get(userId) as
    | { sample_path: string; consent_at: number; enabled: number; target_id: string }
    | undefined;
  if (!row) return null;
  return {
    samplePath: row.sample_path,
    consentAt: row.consent_at,
    enabled: row.enabled === 1,
    targetId: row.target_id,
  };
}

/**
 * Guarda/substitui a amostra do dono (upsert). `targetId` é a pessoa cuja voz foi
 * gravada (default = o próprio dono, um auto-clone). Uma regravação PRESERVA o estado
 * `enabled` (quem já usava o clone continua a usá-lo com a amostra nova).
 */
export function saveClone(
  db: Database.Database,
  userId: string,
  samplePath: string,
  now: number,
  targetId: string = userId,
): void {
  db.prepare(
    `INSERT INTO user_clone (user_id, sample_path, consent_at, enabled, target_id)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       sample_path = excluded.sample_path,
       consent_at  = excluded.consent_at,
       target_id   = excluded.target_id`,
  ).run(userId, samplePath, now, targetId);
}

/** Liga/desliga o uso do clone. Devolve false se a pessoa ainda não tem amostra. */
export function setCloneEnabled(db: Database.Database, userId: string, on: boolean): boolean {
  const res = db
    .prepare('UPDATE user_clone SET enabled = ? WHERE user_id = ?')
    .run(on ? 1 : 0, userId);
  return res.changes > 0;
}

/** Apaga o clone do dono; devolve o caminho da amostra (para o chamador apagar o WAV) ou null. */
export function deleteClone(db: Database.Database, userId: string): string | null {
  const row = getClone(db, userId);
  if (!row) return null;
  db.prepare('DELETE FROM user_clone WHERE user_id = ?').run(userId);
  return row.samplePath;
}

/**
 * Revogação pela pessoa gravada: apaga TODOS os clones feitos a partir da voz de
 * `targetId` por OUTRAS pessoas (dono ≠ alvo), retira o consentimento. Devolve os pares
 * (dono, caminho da amostra) para o chamador apagar os WAVs. Um auto-clone (dono == alvo)
 * NÃO é tocado aqui — esse remove-se com `deleteClone` (o dono é a mesma pessoa).
 */
export function deleteClonesByTarget(
  db: Database.Database,
  targetId: string,
): { ownerId: string; samplePath: string }[] {
  const rows = db
    .prepare('SELECT user_id, sample_path FROM user_clone WHERE target_id = ? AND user_id <> ?')
    .all(targetId, targetId) as { user_id: string; sample_path: string }[];
  if (rows.length === 0) return [];
  db.prepare('DELETE FROM user_clone WHERE target_id = ? AND user_id <> ?').run(targetId, targetId);
  return rows.map((r) => ({ ownerId: r.user_id, samplePath: r.sample_path }));
}
