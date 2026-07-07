import type Database from 'better-sqlite3';
import { isVoiceEffect, type VoiceEffect } from '../tts/effects';
// Tabela CACHEADA (lida a cada mensagem): todo o setter TEM de chamar invalidate.
import { cached, invalidate } from './cache';

// Efeito de voz por-(guild,user): o filtro aplicado às mensagens lidas dessa pessoa
// (robot/echo/deep...). Ausente/'none' => voz limpa. Valor inválido lê-se como 'none'.
// O GATE de premium é validado no comando /voice effect (ao GUARDAR), não aqui.

const keyOf = (guildId: string, userId: string): string => `${guildId}:${userId}`;

export function getVoiceEffect(db: Database.Database, guildId: string, userId: string): VoiceEffect {
  return cached(db, 'user_effect', keyOf(guildId, userId), () => {
    const row = db
      .prepare('SELECT effect FROM user_effect WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as { effect: string } | undefined;
    if (!row || !isVoiceEffect(row.effect)) return 'none';
    return row.effect;
  });
}

export function setVoiceEffect(
  db: Database.Database,
  guildId: string,
  userId: string,
  effect: VoiceEffect,
): void {
  if (effect === 'none') {
    clearVoiceEffect(db, guildId, userId);
    return;
  }
  db.prepare(
    `INSERT INTO user_effect (guild_id, user_id, effect)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET effect = excluded.effect`,
  ).run(guildId, userId, effect);
  invalidate(db, 'user_effect', keyOf(guildId, userId));
}

export function clearVoiceEffect(db: Database.Database, guildId: string, userId: string): void {
  db.prepare('DELETE FROM user_effect WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  invalidate(db, 'user_effect', keyOf(guildId, userId));
}
