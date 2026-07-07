import type Database from 'better-sqlite3';
// Tabela CACHEADA (lida a cada mensagem): todo o setter TEM de chamar invalidate.
import { cached, invalidate } from './cache';

interface CountRow {
  n: number;
}

const keyOf = (guildId: string, userId: string): string => `${guildId}:${userId}`;

/**
 * Toggle da DETECAO AUTOMATICA de lingua, por-(guild,user).
 *
 * DEFAULT = **OFF**: por defeito o bot usa UMA voz fixa (a escolhida em `/voice set`,
 * senao a default da guild, senao a global) para TODAS as linguas — assim parece
 * sempre a mesma pessoa, mesmo quando a mensagem mistura linguas. As palavras
 * estrangeiras saem no sotaque dessa voz (limitacao do Piper: cada voz e um locutor
 * de UMA lingua; nao ha voz multilingue).
 *
 * Quem QUISER voz nativa por lingua (aceitando que o locutor mude) liga o opt-in com
 * `/voice detection on`. O store grava so uma linha para esses (uma linha => ON; sem
 * linha => OFF). Espelha o padrao do optout mas com o sinal INVERTIDO.
 */
export function isDetectionOn(
  db: Database.Database,
  guildId: string,
  userId: string,
): boolean {
  return cached(db, 'tts_lang_detect_on', keyOf(guildId, userId), () => {
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM tts_lang_detect_on WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as CountRow;
    // Ha linha => deteccao LIGADA (opt-in). Sem linha => desligada (default).
    return row.n > 0;
  });
}

/**
 * Liga (`on=true`) ou desliga (`on=false`) a deteccao para um (guild,user).
 * Ligar insere a linha (opt-in, idempotente via ON CONFLICT DO NOTHING); desligar
 * remove-a (volta ao default OFF). Simetrico do setOptOut/setOptIn.
 */
export function setDetection(
  db: Database.Database,
  guildId: string,
  userId: string,
  on: boolean,
): void {
  if (on) {
    db.prepare(
      `INSERT INTO tts_lang_detect_on (guild_id, user_id) VALUES (?, ?)
       ON CONFLICT(guild_id, user_id) DO NOTHING`,
    ).run(guildId, userId);
    invalidate(db, 'tts_lang_detect_on', keyOf(guildId, userId));
    return;
  }
  db.prepare('DELETE FROM tts_lang_detect_on WHERE guild_id = ? AND user_id = ?').run(
    guildId,
    userId,
  );
  invalidate(db, 'tts_lang_detect_on', keyOf(guildId, userId));
}
