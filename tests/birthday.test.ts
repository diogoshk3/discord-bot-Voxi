import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  getBirthday,
  setBirthday,
  clearBirthday,
  isValidBirthday,
  isBirthdayToday,
} from '../src/store/birthday';
import { buildGreeting, BIRTHDAY_WISHES } from '../src/voice/greeting';

const G = 'guild-1';
const U = 'user-1';

describe('isValidBirthday — combinação dia/mês', () => {
  it('aceita datas reais, incluindo 29/02', () => {
    expect(isValidBirthday(1, 1)).toBe(true);
    expect(isValidBirthday(12, 31)).toBe(true);
    expect(isValidBirthday(2, 29)).toBe(true); // aniversários bissextos
  });

  it('recusa dias impossíveis para o mês', () => {
    expect(isValidBirthday(2, 30)).toBe(false);
    expect(isValidBirthday(4, 31)).toBe(false); // abril tem 30
    expect(isValidBirthday(6, 31)).toBe(false);
  });

  it('recusa mês/dia fora de intervalo e não-inteiros', () => {
    expect(isValidBirthday(0, 10)).toBe(false);
    expect(isValidBirthday(13, 10)).toBe(false);
    expect(isValidBirthday(5, 0)).toBe(false);
    expect(isValidBirthday(5, 1.5)).toBe(false);
  });
});

describe('isBirthdayToday — compara mês/dia com a data dada', () => {
  it('true só quando mês E dia batem', () => {
    const now = new Date(2026, 6, 5); // 5 de julho (mês 0-based=6 -> julho)
    expect(isBirthdayToday({ month: 7, day: 5 }, now)).toBe(true);
    expect(isBirthdayToday({ month: 7, day: 6 }, now)).toBe(false);
    expect(isBirthdayToday({ month: 8, day: 5 }, now)).toBe(false);
  });
});

describe('store birthday', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('sem aniversário -> null', () => {
    expect(getBirthday(db, G, U)).toBeNull();
  });

  it('persiste, sobrescreve e limpa', () => {
    setBirthday(db, G, U, 3, 14);
    expect(getBirthday(db, G, U)).toEqual({ month: 3, day: 14 });
    setBirthday(db, G, U, 12, 25);
    expect(getBirthday(db, G, U)).toEqual({ month: 12, day: 25 });
    clearBirthday(db, G, U);
    expect(getBirthday(db, G, U)).toBeNull();
  });

  it('é por-(guild,user)', () => {
    setBirthday(db, G, U, 1, 1);
    expect(getBirthday(db, 'outra', U)).toBeNull();
    expect(getBirthday(db, G, 'u2')).toBeNull();
  });
});

describe('buildGreeting — parabéns no dia de anos', () => {
  const base = {
    name: 'Alex',
    availableModels: ['en_US-amy-medium', 'pt_PT-tugao-medium'],
    defaultVoice: 'en_US-amy-medium',
    defaultSpeed: 1,
  };

  it('birthday:true usa os parabéns em vez do "Olá"', () => {
    const en = buildGreeting({ ...base, locale: 'en', birthday: true });
    expect(en.text).toBe('Happy birthday Alex');
    const pt = buildGreeting({ ...base, locale: 'pt', birthday: true });
    expect(pt.text).toBe('Feliz aniversário Alex');
    expect(pt.model.startsWith('pt_')).toBe(true);
  });

  it('birthday:false/omitido mantém a saudação normal', () => {
    expect(buildGreeting({ ...base, locale: 'en' }).text).toBe('Hello Alex');
  });

  it('língua sem parabéns cai no inglês', () => {
    expect(BIRTHDAY_WISHES.xx).toBeUndefined();
    const out = buildGreeting({ ...base, locale: 'xx', birthday: true });
    expect(out.text).toBe('Happy birthday Alex');
  });
});
