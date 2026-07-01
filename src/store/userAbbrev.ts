import type Database from 'better-sqlite3';

/**
 * Abreviaturas personalizadas POR-UTILIZADOR, GLOBAIS (a chave e SO o user_id —
 * seguem o utilizador entre servidores). Espelha o padrao de `pronunciation.ts`:
 * prepared statements, upsert idempotente. A tabela e criada em `db.ts`
 * (CREATE TABLE IF NOT EXISTS user_abbreviation), como as restantes stores.
 */

export interface UserAbbrevEntry {
  term: string;
  replacement: string;
}

/** Resultado de addUserAbbrev. `reason` (codigo) so quando ok=false. */
export type AddUserAbbrevResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-term' | 'empty-replacement' | 'too-long-replacement' | 'cap' };

/** Cap de abreviaturas por utilizador. */
export const USER_ABBREV_CAP = 10;

/** Comprimento maximo do termo e do replacement. */
const MAX_TERM_LEN = 50;
const MAX_REPLACEMENT_LEN = 200;

// Termo: UMA unica palavra de letras/digitos unicode (sem espacos nem pontuacao),
// no estilo unicode do resto do projeto (\p{L}\p{N}, nao o ASCII \w).
const TERM_RE = /^[\p{L}\p{N}]+$/u;

export function getUserAbbrev(db: Database.Database, userId: string): UserAbbrevEntry[] {
  const rows = db
    .prepare('SELECT term, replacement FROM user_abbreviation WHERE user_id = ? ORDER BY term ASC')
    .all(userId) as UserAbbrevEntry[];
  return rows;
}

export function countUserAbbrev(db: Database.Database, userId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM user_abbreviation WHERE user_id = ?')
    .get(userId) as { n: number };
  return row.n;
}

/**
 * Cria/edita uma abreviatura pessoal. Term guardado em MINUSCULAS. Valida ANTES de
 * tocar na BD:
 *  - termo: uma unica palavra (\p{L}\p{N}), 1..50 chars -> senao 'invalid-term';
 *  - replacement: nao-vazio apos trim -> senao 'empty-replacement'; <=200 -> senao
 *    'too-long-replacement'.
 * Cap de 10 POR UTILIZADOR: se o termo for NOVO e ja houver 10, rejeita com 'cap'.
 * ATUALIZAR um termo existente e sempre permitido (nao conta como novo).
 */
export function addUserAbbrev(
  db: Database.Database,
  userId: string,
  term: string,
  replacement: string,
): AddUserAbbrevResult {
  const t = term.trim().toLowerCase();
  if (!TERM_RE.test(t) || t.length > MAX_TERM_LEN) {
    return { ok: false, reason: 'invalid-term' };
  }
  const r = replacement.trim();
  if (r === '') {
    return { ok: false, reason: 'empty-replacement' };
  }
  if (r.length > MAX_REPLACEMENT_LEN) {
    return { ok: false, reason: 'too-long-replacement' };
  }

  // O cap so trava TERMOS NOVOS: se `t` ja existe, e um update (permitido no cap).
  const existing = db
    .prepare('SELECT 1 FROM user_abbreviation WHERE user_id = ? AND term = ?')
    .get(userId, t) as { 1: number } | undefined;
  if (!existing && countUserAbbrev(db, userId) >= USER_ABBREV_CAP) {
    return { ok: false, reason: 'cap' };
  }

  db.prepare(
    `INSERT INTO user_abbreviation (user_id, term, replacement) VALUES (?, ?, ?)
     ON CONFLICT(user_id, term) DO UPDATE SET replacement = excluded.replacement`,
  ).run(userId, t, r);
  return { ok: true };
}

export function removeUserAbbrev(db: Database.Database, userId: string, term: string): void {
  db.prepare('DELETE FROM user_abbreviation WHERE user_id = ? AND term = ?').run(
    userId,
    term.trim().toLowerCase(),
  );
}
