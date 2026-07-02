import type Database from 'better-sqlite3';

interface CountRow {
  n: number;
}

/**
 * Toggle da DETECAO AUTOMATICA de lingua, por-(guild,user). Espelha o padrao do
 * optout: a deteccao esta LIGADA por defeito (a pessoa fala e o bot le na lingua
 * detetada, misturando vozes num texto multi-lingua). O store so grava uma linha
 * para os utilizadores que a DESLIGARAM — sem linha => ligada. Assim nao precisamos
 * de sembrar linhas para toda a gente; o default e implicito na ausencia de linha.
 */
export function isDetectionOn(
  db: Database.Database,
  guildId: string,
  userId: string,
): boolean {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM tts_lang_detect_off WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as CountRow;
  // Ha linha => deteccao DESLIGADA. Sem linha => ligada (default).
  return row.n === 0;
}

/**
 * Liga (`on=true`) ou desliga (`on=false`) a deteccao para um (guild,user).
 * Ligar remove a linha (volta ao default); desligar insere-a (idempotente via
 * ON CONFLICT DO NOTHING). Mesmo modelo do setOptOut/setOptIn.
 */
export function setDetection(
  db: Database.Database,
  guildId: string,
  userId: string,
  on: boolean,
): void {
  if (on) {
    db.prepare('DELETE FROM tts_lang_detect_off WHERE guild_id = ? AND user_id = ?').run(
      guildId,
      userId,
    );
    return;
  }
  db.prepare(
    `INSERT INTO tts_lang_detect_off (guild_id, user_id) VALUES (?, ?)
     ON CONFLICT(guild_id, user_id) DO NOTHING`,
  ).run(guildId, userId);
}
