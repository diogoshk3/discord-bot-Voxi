// src/store/voteReward.ts
//
// Recompensa por VOTO no top.gg (growth loop, GROWTH·1). Um upvote elegível dá
// VOTE_REWARD_HOURS de Vozen Plus por-utilizador (source 'vote' — EXTRA, nunca a
// qualidade base). A recompensa tem um COOLDOWN de VOTE_REWARD_COOLDOWN_MS: cada
// conta só a ganha 1× a cada 30 dias, mesmo que o top.gg permita votar a cada 12h.
// Sem isto, 24h de recompensa + cooldown de 12h do top.gg fariam o Plus ACUMULAR
// sem teto (votar 1 mês ≈ bancar ~1 ano de Plus grátis), a canibalizar o Plus pago.
//
// A tabela vote_reward guarda só { user_id, rewarded_at } — o instante do último
// Plus ganho por voto, para medir o cooldown. É dado pessoal minimalista, apagável
// por /privacy erase (ver dataLifecycle USER_ERASE_TABLES + PRIVACY.md).
import type Database from 'better-sqlite3';
import { grantUserPremium } from './premium';

/** Duração da recompensa por voto elegível: estas horas de Plus por-utilizador. */
export const VOTE_REWARD_HOURS = 24;
/** Cooldown da RECOMPENSA (não do voto): a mesma conta só ganha Plus 1× por mês. */
export const VOTE_REWARD_COOLDOWN_MS = 30 * 86_400_000;

export interface VoteRewardResult {
  /** true se concedeu Plus agora; false se estava em cooldown. */
  granted: boolean;
  /** Novo expiry do Plus (ms) — presente quando granted=true. */
  expiresAt?: number;
  /** Quando o cooldown termina (ms) — presente quando granted=false. */
  nextEligibleAt?: number;
}

/** Instante do último Plus ganho por voto (ms), ou null se nunca ganhou. */
export function getVoteRewardAt(db: Database.Database, userId: string): number | null {
  const row = db.prepare('SELECT rewarded_at FROM vote_reward WHERE user_id = ?').get(userId) as
    { rewarded_at: number } | undefined;
  return row ? row.rewarded_at : null;
}

/**
 * Tenta conceder a recompensa por voto a `userId`. Transacional (lê o cooldown,
 * concede e regista atomicamente) para dois webhooks quase-simultâneos do top.gg
 * não darem duas recompensas. Se ainda dentro do cooldown, NÃO concede nada (o
 * voto em si já contou na métrica, à parte). Devolve o resultado para o chamador
 * logar. Idempotente na prática: um retry dentro do cooldown devolve granted=false.
 */
export function claimVoteReward(
  db: Database.Database,
  userId: string,
  now: number,
): VoteRewardResult {
  const tx = db.transaction((): VoteRewardResult => {
    const last = getVoteRewardAt(db, userId);
    if (last !== null && now - last < VOTE_REWARD_COOLDOWN_MS) {
      return { granted: false, nextEligibleAt: last + VOTE_REWARD_COOLDOWN_MS };
    }
    const expiresAt = grantUserPremium(db, userId, VOTE_REWARD_HOURS / 24, 'vote', now);
    db.prepare(
      `INSERT INTO vote_reward (user_id, rewarded_at) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET rewarded_at = excluded.rewarded_at`,
    ).run(userId, now);
    return { granted: true, expiresAt };
  });
  return tx();
}

export interface VoteRewardStatus {
  /** Pode ganhar a recompensa por voto agora? */
  eligible: boolean;
  /** Se em cooldown, quando volta a ser elegível (ms); senão null. */
  nextEligibleAt: number | null;
}

/** Estado da recompensa por voto para EXIBIÇÃO (/vote, /premium). Só leitura. */
export function voteRewardStatus(
  db: Database.Database,
  userId: string,
  now: number,
): VoteRewardStatus {
  const last = getVoteRewardAt(db, userId);
  if (last === null || now - last >= VOTE_REWARD_COOLDOWN_MS) {
    return { eligible: true, nextEligibleAt: null };
  }
  return { eligible: false, nextEligibleAt: last + VOTE_REWARD_COOLDOWN_MS };
}
