// src/store/gcloudUsage.ts
//
// Contadores MENSAIS de chars do motor Google HD (gcloud), persistentes em SQLite
// (tabela gcloud_usage). Salvaguarda de custo: o motor conta os chars SÓ na chamada real
// à Google (cache-miss) e recusa (cai no gTTS) quando o pool do mês esgota. Em memória um
// restart zerava o mês — por isso vive na BD.
//
// `scope`: 'user' (pool pessoal do Plus), 'pass' (pool partilhado do passe, keyed pelo
// DONO do passe), 'guild' (servidor Premium direto sem passe) ou 'global'.
import type Database from 'better-sqlite3';

export type UsageScope = 'user' | 'pass' | 'guild' | 'global';

/**
 * Chave de mês 'YYYY-MM' em UTC (roda sozinha no dia 1). UTC e não fuso local para o
 * limite ser o mesmo em qualquer servidor/máquina. PURA.
 */
export function monthKeyUTC(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Chars já gastos por este pool (scope,key) no mês dado. Sem linha => 0. */
export function getGcloudMonthlyChars(
  db: Database.Database,
  scope: UsageScope,
  key: string,
  month: string,
): number {
  const row = db
    .prepare('SELECT chars FROM gcloud_usage WHERE scope = ? AND key = ? AND month = ?')
    .get(scope, key, month) as { chars: number } | undefined;
  return row ? row.chars : 0;
}

/**
 * Soma `chars` ao consumo do pool no mês (UPSERT atómico: chars = chars + ?). Uma única
 * escrita SQLite serializada — dois synths concorrentes do mesmo pool não perdem contagem.
 */
export function addGcloudMonthlyChars(
  db: Database.Database,
  scope: UsageScope,
  key: string,
  month: string,
  chars: number,
): void {
  db.prepare(
    `INSERT INTO gcloud_usage (scope, key, month, chars)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(scope, key, month) DO UPDATE SET chars = chars + excluded.chars`,
  ).run(scope, key, month, chars);
}
