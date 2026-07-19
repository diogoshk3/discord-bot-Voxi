import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { bumpTalk } from '../src/store/talkStats';
import { bumpTalkUsage, getDominantTalkUsage, voiceLocale } from '../src/store/talkUsage';
import { setUserVoice } from '../src/store/userVoice';

describe('talkUsage — aggregate language/engine counters', () => {
  let db: Database.Database;
  beforeEach(() => (db = initDb(':memory:')));
  afterEach(() => db.close());

  it('extracts the locale from a voice id', () => {
    expect(voiceLocale('pt_PT-tugao-medium')).toBe('pt_PT');
    expect(voiceLocale('')).toBe('unknown');
  });

  it('returns independent most-used language and engine across exact usage rows', () => {
    const now = new Date('2026-07-19T12:00:00Z');
    for (let i = 0; i < 4; i += 1) bumpTalk(db, 'G', 'U', now);

    // Portuguese wins 3-1; Piper also wins 3-1, independently of the pair distribution.
    bumpTalkUsage(db, 'G', 'U', 'pt_PT-a-medium', 'piper');
    bumpTalkUsage(db, 'G', 'U', 'pt_PT-a-medium', 'piper');
    bumpTalkUsage(db, 'G', 'U', 'en_US-amy-medium', 'piper');
    bumpTalkUsage(db, 'G', 'U', 'pt_PT-a-medium', 'kokoro');

    expect(getDominantTalkUsage(db, ['U']).get('U')).toEqual({
      language: 'pt_PT',
      engine: 'piper',
    });
  });

  it('uses the current voice only for legacy messages not yet covered by exact counters', () => {
    const now = new Date('2026-07-19T12:00:00Z');
    for (let i = 0; i < 5; i += 1) bumpTalk(db, 'G', 'U', now);
    setUserVoice(db, 'G', 'U', 'fr_FR-siwis-medium', 1, 'gcloud');

    // Two exact new messages; the three historical messages use the current preference as the
    // best available estimate, so French/Google HD win 3-2 until exact data replaces them.
    bumpTalkUsage(db, 'G', 'U', 'pt_PT-a-medium', 'piper');
    bumpTalkUsage(db, 'G', 'U', 'pt_PT-a-medium', 'piper');

    expect(getDominantTalkUsage(db, ['U']).get('U')).toEqual({
      language: 'fr_FR',
      engine: 'gcloud',
    });
  });

  it('returns nulls for a requested user with no messages', () => {
    expect(getDominantTalkUsage(db, ['missing']).get('missing')).toEqual({
      language: null,
      engine: null,
    });
  });
});
