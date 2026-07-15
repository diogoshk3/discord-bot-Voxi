import { describe, it, expect } from 'vitest';
import { t, SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_DISPLAY_NAMES } from '../src/i18n/index';
import { locales } from '../src/i18n/locales/index';
import { catalog } from '../src/i18n/catalog';

describe('i18n — t(key, locale, params)', () => {
  it('DEFAULT_LOCALE is "en" and "en" is a supported locale', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('pt');
  });

  it('returns the EN string by default (locale="en")', () => {
    // help.title exists in the catalog with a known EN value.
    expect(t('help.title', 'en')).toContain('Vozen');
  });

  it('returns the PT string when locale="pt"', () => {
    // help.groupStarted has distinct translations EN vs PT.
    const en = t('help.groupStarted', 'en');
    const pt = t('help.groupStarted', 'pt');
    expect(en).toBe('Getting started');
    expect(pt).toBe('Primeiros passos');
  });

  it('game.wordle.guess has an explicit VERB (does not read as a loss, even with nick "Perdeste")', () => {
    // Regression of the reported bug: with the nick "Perdeste", "**Perdeste** — faltam 4" read
    // as a result. The copy MUST have a verb (tentou/guessed) between the name and the rest.
    for (const [loc, verb] of [
      ['pt', 'tentou'],
      ['en', 'guessed'],
    ] as const) {
      const s = t('game.wordle.guess', loc, { user: 'Perdeste', left: 4 });
      expect(s).toContain(verb);
      expect(s).toContain('Perdeste');
      expect(s).toContain('4');
      // The name is never stuck to "faltam/left" without the verb in between.
      expect(s).not.toMatch(/Perdeste\*?\*? — (faltam|4)/);
    }
  });

  it('falls back to EN when the key is missing in the requested locale', () => {
    // help.title only has EN (pt partial); requesting in pt returns the EN value.
    expect(t('help.title', 'pt')).toBe(t('help.title', 'en'));
  });

  it('a nonexistent key returns the key itself (never crashes)', () => {
    expect(t('nao.existe.esta.chave', 'en')).toBe('nao.existe.esta.chave');
    expect(t('nao.existe.esta.chave', 'pt')).toBe('nao.existe.esta.chave');
  });

  it('interpolates {param} parameters', () => {
    // help.recommend uses {command}. We confirm that the placeholder is substituted.
    const out = t('help.footer', 'en', { command: '/setup' });
    expect(out).toContain('/setup');
    expect(out).not.toContain('{command}');
  });

  it('an unsupported locale falls back to EN', () => {
    expect(t('help.groupStarted', 'xx')).toBe('Getting started');
  });

  // Phase B: 'es' ALREADY has a translation (locales/es.ts) -> t() serves Spanish, not EN.
  it('a translated locale (es) serves the translation, not the EN fallback', () => {
    expect(t('help.groupStarted', 'es')).not.toBe('Getting started');
    expect(t('help.title', 'es')).not.toBe('');
  });

  // Proves the PHASE B architecture: when there is a locales/<code>.ts file with the
  // key, t() serves that translation (branch 1 of the chain). In Phase A the registry is
  // empty, so NO other test exercises this branch — without this, a bug in
  // `locales[locale]?.[key]` would only appear in Phase B. We register/clean up in-line.
  it('uses the per-locale registry translation when present (branch 1)', () => {
    locales['zz'] = { 'help.groupStarted': 'REG-WIN' };
    try {
      expect(t('help.groupStarted', 'zz')).toBe('REG-WIN');
    } finally {
      delete locales['zz'];
    }
  });

  it('the per-locale registry takes precedence over the catalog inline value (pt)', () => {
    // 'help.groupStarted' has `pt` inline ("Primeiros passos"); an override in the
    // registry for pt should WIN over that inline (branch 1 > branch 2).
    locales['pt'] = { 'help.groupStarted': 'OVERRIDE-PT' };
    try {
      expect(t('help.groupStarted', 'pt')).toBe('OVERRIDE-PT');
    } finally {
      delete locales['pt'];
    }
  });
});

describe('i18n — SUPPORTED_LOCALES + endonyms (35 voice languages)', () => {
  const EXPECTED = [
    'en',
    'pt',
    'es',
    'fr',
    'de',
    'nl',
    'pl',
    'tr',
    'cs',
    'sv',
    'fi',
    'da',
    'ro',
    'hu',
    'cy',
    'is',
    'lb',
    'lv',
    'sk',
    'sl',
    'sw',
    'vi',
    'ca',
    'it',
    'el',
    'ru',
    'uk',
    'kk',
    'sr',
    'ar',
    'fa',
    'ka',
    'ne',
    'zh',
    'ja',
  ];

  it('SUPPORTED_LOCALES has exactly the 35 voice languages', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(EXPECTED);
    expect(SUPPORTED_LOCALES.length).toBe(35);
  });

  it('LOCALE_DISPLAY_NAMES has an endonym (name in its own language) for EACH locale', () => {
    for (const code of EXPECTED) {
      const name = (LOCALE_DISPLAY_NAMES as Record<string, string>)[code];
      expect(name, `missing endonym for ${code}`).toBeTruthy();
      expect(typeof name).toBe('string');
    }
  });

  it('key endonyms are in their OWN language (endonym, not in English)', () => {
    const N = LOCALE_DISPLAY_NAMES as Record<string, string>;
    expect(N.en).toBe('English');
    expect(N.pt).toBe('Português');
    expect(N.de).toBe('Deutsch');
    expect(N.zh).toBe('中文');
    expect(N.ru).toBe('Русский');
    expect(N.ar).toBe('العربية');
    expect(N.el).toBe('Ελληνικά');
    expect(N.uk).toBe('Українська');
  });
});

// Regression guard for SILENT locale drift — the class of bug that let a renamed key
// fall back to EN forever (undetected), and a mangled {placeholder} break interpolation
// at runtime. Non-brittle by design: it does NOT require every catalog key to be
// translated (EN fallback is intentional), and it TOLERATES a value that OMITS a
// placeholder (graceful degradation). It only flags actual corruption.
describe('i18n — locale integrity (per-locale registry vs catalog)', () => {
  const catalogKeys = new Set(Object.keys(catalog));
  const codes = Object.keys(locales);
  const tokensOf = (s: string): Set<string> => new Set(s.match(/\{[^}]+\}/g) ?? []);

  it('registers translations for the voice languages (sanity: the registry is populated)', () => {
    expect(codes.length).toBeGreaterThanOrEqual(30);
  });

  it('no locale has a key ABSENT from the catalog (a renamed/typo key silently falls back to EN forever)', () => {
    const offenders: string[] = [];
    for (const code of codes) {
      for (const key of Object.keys(locales[code])) {
        if (!catalogKeys.has(key)) offenders.push(`${code}:${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every locale value is a non-empty string', () => {
    const offenders: string[] = [];
    for (const code of codes) {
      for (const [key, value] of Object.entries(locales[code])) {
        if (typeof value !== 'string' || value.trim().length === 0)
          offenders.push(`${code}:${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no locale INVENTS a placeholder absent from its English source (catches {name} -> {nome} mangling)', () => {
    const offenders: string[] = [];
    for (const code of codes) {
      for (const [key, value] of Object.entries(locales[code])) {
        const en = catalog[key]?.en;
        if (typeof en !== 'string') continue; // key-not-in-catalog is covered by the test above
        const enTokens = tokensOf(en);
        for (const tok of tokensOf(value)) {
          if (!enTokens.has(tok)) offenders.push(`${code}:${key} ${tok}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
