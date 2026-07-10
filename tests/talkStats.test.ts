import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  bumpTalk,
  getTopSpeakers,
  dateKey,
  prevDateKey,
  dayKeyMinus,
  effectiveStreak,
} from '../src/store/talkStats';

const G = 'guild-1';
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe('dateKey / prevDateKey / dayKeyMinus — chaves de dia local', () => {
  it('formata YYYY-MM-DD com zero-padding', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05'); // 5 jan
    expect(dateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
  it('prevDateKey atravessa fronteiras de mês/ano', () => {
    expect(prevDateKey(new Date(2026, 2, 1))).toBe('2026-02-28'); // 1 mar -> 28 fev (2026 não bissexto)
    expect(prevDateKey(new Date(2026, 0, 1))).toBe('2025-12-31'); // 1 jan -> 31 dez ano anterior
  });
  it('dayKeyMinus(n) recua n dias (DST-safe, atravessa fronteiras)', () => {
    expect(dayKeyMinus(new Date(2026, 6, 10), 2)).toBe('2026-07-08');
    expect(dayKeyMinus(new Date(2026, 2, 2), 2)).toBe('2026-02-28'); // 2 mar -> 28 fev
  });
});

describe('bumpTalk — contagem + streak (regras Duolingo)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('primeira mensagem cria a linha com count 1 e streak 1', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    expect(getTopSpeakers(db, G, d(2026, 7, 5))).toEqual([
      { userId: 'u1', count: 1, streak: 1, bestStreak: 1 },
    ]);
  });

  it('várias mensagens no MESMO dia -> count sobe, streak fica 1', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    expect(getTopSpeakers(db, G, d(2026, 7, 5))[0]).toEqual({
      userId: 'u1',
      count: 3,
      streak: 1,
      bestStreak: 1,
    });
  });

  it('dias SEGUIDOS aumentam o streak', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    bumpTalk(db, G, 'u1', d(2026, 7, 6));
    bumpTalk(db, G, 'u1', d(2026, 7, 7));
    expect(getTopSpeakers(db, G, d(2026, 7, 7))[0]).toEqual({
      userId: 'u1',
      count: 3,
      streak: 3,
      bestStreak: 3,
    });
  });

  it('FALHAR 1 dia (freeze): o streak CONTINUA, sem contar o dia falhado', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5)); // streak 1
    bumpTalk(db, G, 'u1', d(2026, 7, 6)); // streak 2
    // falha o dia 7 (1 dia); volta no dia 8 -> freeze: continua a 3 (o dia falhado nao conta)
    const bump = bumpTalk(db, G, 'u1', d(2026, 7, 8));
    expect(bump.streak).toBe(3);
    expect(getTopSpeakers(db, G, d(2026, 7, 8))[0]).toMatchObject({ streak: 3, bestStreak: 3 });
  });

  it('FALHAR 2 dias SEGUIDOS: perde o streak (recomeça a 1), mantém o melhor', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5)); // streak 1
    bumpTalk(db, G, 'u1', d(2026, 7, 6)); // streak 2
    // falha os dias 7 e 8 (2 seguidos); volta no dia 9 -> perde -> 1
    const bump = bumpTalk(db, G, 'u1', d(2026, 7, 9));
    expect(bump.streak).toBe(1);
    expect(getTopSpeakers(db, G, d(2026, 7, 9))[0]).toMatchObject({ streak: 1, bestStreak: 2 });
  });

  it('é por-guild', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    expect(getTopSpeakers(db, 'outra', d(2026, 7, 5))).toEqual([]);
  });
});

describe('effectiveStreak — streak VIVO no dia de referência', () => {
  it('vivo hoje / ontem / anteontem (dentro do freeze) -> valor guardado', () => {
    const now = d(2026, 7, 10);
    expect(effectiveStreak(dateKey(now), 5, now)).toBe(5); // hoje
    expect(effectiveStreak(dayKeyMinus(now, 1), 5, now)).toBe(5); // ontem
    expect(effectiveStreak(dayKeyMinus(now, 2), 5, now)).toBe(5); // anteontem (1 dia falhado)
  });
  it('3+ dias sem falar (2 dias seguidos falhados) -> 0 (perdido)', () => {
    const now = d(2026, 7, 10);
    expect(effectiveStreak(dayKeyMinus(now, 3), 5, now)).toBe(0);
    expect(effectiveStreak(dayKeyMinus(now, 30), 99, now)).toBe(0);
  });
});

describe('getTopSpeakers — leaderboard ranqueado por DIAS de streak (não por contagem)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('quem tem mais DIAS de streak vivo fica no topo (mesmo com menos mensagens)', () => {
    // u1: fala muito num só dia (count alto, streak 1). u2: 3 dias seguidos (streak 3).
    bumpTalk(db, G, 'u1', d(2026, 7, 10));
    bumpTalk(db, G, 'u1', d(2026, 7, 10));
    bumpTalk(db, G, 'u1', d(2026, 7, 10));
    bumpTalk(db, G, 'u2', d(2026, 7, 8));
    bumpTalk(db, G, 'u2', d(2026, 7, 9));
    bumpTalk(db, G, 'u2', d(2026, 7, 10));
    const top = getTopSpeakers(db, G, d(2026, 7, 10));
    expect(top.map((r) => r.userId)).toEqual(['u2', 'u1']); // u2 (3 dias) > u1 (1 dia)
    expect(top[0].streak).toBe(3);
  });

  it('um streak MORTO (3+ dias sem falar) aparece com 0 e afunda', () => {
    bumpTalk(db, G, 'morto', d(2026, 7, 1)); // streak 1, mas há muito
    bumpTalk(db, G, 'vivo', d(2026, 7, 10)); // streak 1, hoje
    const top = getTopSpeakers(db, G, d(2026, 7, 10));
    expect(top[0].userId).toBe('vivo');
    const dead = top.find((r) => r.userId === 'morto');
    expect(dead?.streak).toBe(0);
  });

  it('empate de streak -> desempata por contagem de mensagens', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 10)); // streak 1, count 1
    bumpTalk(db, G, 'u2', d(2026, 7, 10)); // streak 1, count 2
    bumpTalk(db, G, 'u2', d(2026, 7, 10));
    const top = getTopSpeakers(db, G, d(2026, 7, 10));
    expect(top.map((r) => r.userId)).toEqual(['u2', 'u1']);
  });
});

describe('bumpTalk — sinal de streak (return) para o aviso 🔥', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('primeira mensagem de sempre -> { firstOfDay:true, streak:1 }', () => {
    expect(bumpTalk(db, G, 'u1', d(2026, 7, 5))).toEqual({ firstOfDay: true, streak: 1 });
  });

  it('repetição no MESMO dia -> firstOfDay:false', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    expect(bumpTalk(db, G, 'u1', d(2026, 7, 5))).toEqual({ firstOfDay: false, streak: 1 });
  });

  it('dia SEGUINTE -> firstOfDay:true, streak sobe', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    expect(bumpTalk(db, G, 'u1', d(2026, 7, 6))).toEqual({ firstOfDay: true, streak: 2 });
  });

  it('2 dias SEGUIDOS falhados -> firstOfDay:true, streak recomeça a 1', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    bumpTalk(db, G, 'u1', d(2026, 7, 6));
    expect(bumpTalk(db, G, 'u1', d(2026, 7, 9))).toEqual({ firstOfDay: true, streak: 1 });
  });
});
