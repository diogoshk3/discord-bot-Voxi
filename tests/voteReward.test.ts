import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { isUserPremium, getUserPremiumExpiry } from '../src/store/premium';
import {
  claimVoteReward,
  voteRewardStatus,
  getVoteRewardAt,
  VOTE_REWARD_HOURS,
  VOTE_REWARD_COOLDOWN_MS,
} from '../src/store/voteReward';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const U = 'voter-1';

describe('voteReward — recompensa de 24h com cooldown de 30 dias', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => db.close());

  it('constantes: recompensa = 24h, cooldown = 30 dias', () => {
    // Pin dos literais (o Diogo escolheu 24h + 1 mês). NÃO derivar da constante nos
    // dois lados — senão o teste é tautológico e não protege o valor.
    expect(VOTE_REWARD_HOURS).toBe(24);
    expect(VOTE_REWARD_COOLDOWN_MS).toBe(30 * DAY_MS);
  });

  it('1º voto: concede 24h de Plus e regista o momento', () => {
    const NOW = 1_000_000_000;
    const res = claimVoteReward(db, U, NOW);
    expect(res.granted).toBe(true);
    expect(res.expiresAt).toBe(NOW + 24 * HOUR_MS);
    expect(isUserPremium(db, U, NOW + 1000)).toBe(true);
    expect(isUserPremium(db, U, NOW + 24 * HOUR_MS + 1)).toBe(false);
    expect(getVoteRewardAt(db, U)).toBe(NOW);
  });

  it('2º voto dentro dos 30 dias: NÃO concede nada (cooldown) e não estende o Plus', () => {
    const NOW = 1_000_000_000;
    claimVoteReward(db, U, NOW);
    const expiryDepoisDo1 = getUserPremiumExpiry(db, U);

    // 12h depois (pode votar no top.gg, mas a recompensa está em cooldown).
    const res2 = claimVoteReward(db, U, NOW + 12 * HOUR_MS);
    expect(res2.granted).toBe(false);
    expect(res2.nextEligibleAt).toBe(NOW + VOTE_REWARD_COOLDOWN_MS);
    // O Plus NÃO acumulou — continua a expirar no mesmo instante do 1º voto.
    expect(getUserPremiumExpiry(db, U)).toBe(expiryDepoisDo1);
    // O marcador de cooldown também não recuou nem avançou.
    expect(getVoteRewardAt(db, U)).toBe(NOW);
  });

  it('voto exatamente aos 30 dias: elegível outra vez, concede novo 24h', () => {
    const NOW = 1_000_000_000;
    claimVoteReward(db, U, NOW);
    const LATER = NOW + VOTE_REWARD_COOLDOWN_MS; // fronteira: já elegível
    const res = claimVoteReward(db, U, LATER);
    expect(res.granted).toBe(true);
    expect(res.expiresAt).toBe(LATER + 24 * HOUR_MS);
    expect(getVoteRewardAt(db, U)).toBe(LATER);
  });

  it('voteRewardStatus: elegível quando nunca ganhou; em cooldown mostra o próximo instante', () => {
    const NOW = 1_000_000_000;
    expect(voteRewardStatus(db, U, NOW)).toEqual({ eligible: true, nextEligibleAt: null });

    claimVoteReward(db, U, NOW);
    expect(voteRewardStatus(db, U, NOW + DAY_MS)).toEqual({
      eligible: false,
      nextEligibleAt: NOW + VOTE_REWARD_COOLDOWN_MS,
    });
    expect(voteRewardStatus(db, U, NOW + VOTE_REWARD_COOLDOWN_MS)).toEqual({
      eligible: true,
      nextEligibleAt: null,
    });
  });

  it('utilizador sem histórico: getVoteRewardAt devolve null', () => {
    expect(getVoteRewardAt(db, 'ninguem')).toBeNull();
  });
});
