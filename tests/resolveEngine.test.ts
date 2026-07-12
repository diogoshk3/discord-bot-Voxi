import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  grantUserPremium,
  grantGuildPremium,
  grantGuildPass,
  activateSeat,
} from '../src/store/premium';
import { resolveUserEngine } from '../src/tts/resolveEngine';

const G = 'guild-1';
const U = 'user-1';
const NOW = 1_000_000;

describe('resolveUserEngine — gate runtime do motor Google HD (gcloud)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('motores não-gcloud passam intactos (sem tocar em premium)', () => {
    for (const eng of ['google', 'piper', 'kokoro', undefined] as const) {
      expect(resolveUserEngine(db, G, U, eng, NOW).engine).toBe(eng);
    }
  });

  it('gcloud SEM Premium -> despromovido a google (gate)', () => {
    expect(resolveUserEngine(db, G, U, 'gcloud', NOW).engine).toBe('google');
  });

  it('gcloud COM Vozen Plus (user) -> mantém gcloud', () => {
    grantUserPremium(db, U, 30, 'test', NOW);
    expect(resolveUserEngine(db, G, U, 'gcloud', NOW).engine).toBe('gcloud');
  });

  it('gcloud COM Premium do servidor (guild) -> mantém gcloud', () => {
    grantGuildPremium(db, G, 30, 'test', NOW);
    expect(resolveUserEngine(db, G, U, 'gcloud', NOW).engine).toBe('gcloud');
  });

  it('gcloud com Premium EXPIRADO -> despromovido a google', () => {
    grantUserPremium(db, U, 30, 'test', NOW - 60 * 86_400_000); // expirou há muito
    expect(resolveUserEngine(db, G, U, 'gcloud', NOW).engine).toBe('google');
  });
});

describe('resolveUserEngine — descritor de orçamento (pool a debitar)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('Plus -> pool PESSOAL (scope user, key = userId)', () => {
    grantUserPremium(db, U, 30, 'test', NOW);
    const r = resolveUserEngine(db, G, U, 'gcloud', NOW);
    expect(r.gcloudBudget).toEqual({ scope: 'user', key: U });
  });

  it('sem Plus mas passe cobre a guild -> pool do PASSE (scope pass, key = dono, seats)', () => {
    const OWNER = 'owner-1';
    grantGuildPass(db, OWNER, 8, 30, 'test', NOW); // passe de 8 servidores
    activateSeat(db, OWNER, G, NOW); // ativa neste servidor
    const r = resolveUserEngine(db, G, U, 'gcloud', NOW);
    expect(r.engine).toBe('gcloud');
    expect(r.gcloudBudget).toEqual({ scope: 'pass', key: OWNER, seats: 8 });
  });

  it('Plus TEM precedência sobre o passe (não drena o dono do passe)', () => {
    const OWNER = 'owner-1';
    grantGuildPass(db, OWNER, 8, 30, 'test', NOW);
    activateSeat(db, OWNER, G, NOW);
    grantUserPremium(db, U, 30, 'test', NOW); // o próprio user tem Plus
    const r = resolveUserEngine(db, G, U, 'gcloud', NOW);
    expect(r.gcloudBudget).toEqual({ scope: 'user', key: U }); // pool pessoal, não o do passe
  });

  it('Premium DIRETO do servidor (sem passe) -> pool do servidor (scope guild, key = guildId)', () => {
    grantGuildPremium(db, G, 30, 'test', NOW); // redeem/discord/manual, sem passe
    const r = resolveUserEngine(db, G, U, 'gcloud', NOW);
    expect(r.gcloudBudget).toEqual({ scope: 'guild', key: G });
  });

  it('desempate do dono do passe: activated_at mais ANTIGO ganha', () => {
    const A = 'owner-early';
    const B = 'owner-late';
    grantGuildPass(db, A, 3, 30, 'test', NOW);
    grantGuildPass(db, B, 8, 30, 'test', NOW);
    activateSeat(db, A, G, NOW); // A ativa primeiro (mais antigo)
    activateSeat(db, B, G, NOW + 1000); // B ativa depois
    const r = resolveUserEngine(db, G, U, 'gcloud', NOW + 2000);
    expect(r.gcloudBudget?.key).toBe(A);
    expect(r.gcloudBudget?.seats).toBe(3);
  });
});
