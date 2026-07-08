import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  getUserPronunciations,
  addUserPronunciation,
  removeUserPronunciation,
  addPronunciation,
  getPronunciations,
  USER_PRON_LIMIT_FREE,
  USER_PRON_LIMIT_PREMIUM,
} from '../src/store/pronunciation';
import { applyPronunciation } from '../src/textCleaning/pronunciation';

const A = 'user-a';
const B = 'user-b';
const G = 'guild-1';

describe('pronúncias pessoais — limites e isolamento', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('Free: aceita 3, bloqueia a 4.ª', () => {
    for (let n = 1; n <= USER_PRON_LIMIT_FREE; n++) {
      expect(addUserPronunciation(db, A, `t${n}`, `r${n}`, USER_PRON_LIMIT_FREE)).toBe('ok');
    }
    expect(addUserPronunciation(db, A, 'extra', 'x', USER_PRON_LIMIT_FREE)).toBe('limit');
    expect(getUserPronunciations(db, A)).toHaveLength(USER_PRON_LIMIT_FREE);
  });

  it('EDITAR um termo existente não conta para o limite', () => {
    for (let n = 1; n <= USER_PRON_LIMIT_FREE; n++) {
      addUserPronunciation(db, A, `t${n}`, `r${n}`, USER_PRON_LIMIT_FREE);
    }
    // No cap, mas t1 já existe -> é UPDATE, passa.
    expect(addUserPronunciation(db, A, 't1', 'novo', USER_PRON_LIMIT_FREE)).toBe('ok');
    expect(getUserPronunciations(db, A).find((e) => e.term === 't1')?.replacement).toBe('novo');
  });

  it('Premium: aceita 50, bloqueia a 51.ª', () => {
    for (let n = 1; n <= USER_PRON_LIMIT_PREMIUM; n++) {
      expect(addUserPronunciation(db, A, `t${n}`, 'r', USER_PRON_LIMIT_PREMIUM)).toBe('ok');
    }
    expect(addUserPronunciation(db, A, 'extra', 'x', USER_PRON_LIMIT_PREMIUM)).toBe('limit');
  });

  it('as pronúncias do user A não aparecem ao user B (individuais)', () => {
    addUserPronunciation(db, A, 'gg', 'good game', USER_PRON_LIMIT_FREE);
    expect(getUserPronunciations(db, B)).toHaveLength(0);
    // ...e por isso a mensagem de B nunca é tocada pelo dicionário de A:
    const textOfB = applyPronunciation('gg wp', getUserPronunciations(db, B));
    expect(textOfB).toBe('gg wp');
  });

  it('remove: true quando existia, false quando não', () => {
    addUserPronunciation(db, A, 'gg', 'good game', USER_PRON_LIMIT_FREE);
    expect(removeUserPronunciation(db, A, 'gg')).toBe(true);
    expect(removeUserPronunciation(db, A, 'gg')).toBe(false);
    expect(getUserPronunciations(db, A)).toHaveLength(0);
  });

  it('precedência: o termo do USER ganha ao da guild (aplicado primeiro)', () => {
    addUserPronunciation(db, A, 'sql', 'sequel', USER_PRON_LIMIT_FREE);
    addPronunciation(db, G, 'sql', 'ess-cue-ell');
    // Ordem do messageHandler: [user do autor, guild].
    const dict = [...getUserPronunciations(db, A), ...getPronunciations(db, G)];
    expect(applyPronunciation('i love sql', dict)).toBe('i love sequel');
    // Um user SEM pronúncia própria continua a apanhar a da guild.
    const dictB = [...getUserPronunciations(db, B), ...getPronunciations(db, G)];
    expect(applyPronunciation('i love sql', dictB)).toBe('i love ess-cue-ell');
  });
});
