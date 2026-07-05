import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  buildGreeting,
  isJoinIntoChannel,
  GREETINGS,
  GREET_LOCALES,
  GREET_LANGUAGE_CHOICES,
} from '../src/voice/greeting';
import { initDb } from '../src/store/db';
import { getGuildConfig, setGuildConfig } from '../src/store/guildConfig';

const MODELS = ['en_US-amy-medium', 'pt_BR-faber-medium', 'de_DE-thorsten-medium'];

describe('isJoinIntoChannel — deteção de ENTRADA no canal do bot', () => {
  it('true quando entra no canal do bot (não estava lá antes)', () => {
    expect(isJoinIntoChannel(null, 'voz-1', 'voz-1')).toBe(true); // ligou-se
    expect(isJoinIntoChannel('voz-2', 'voz-1', 'voz-1')).toBe(true); // mudou de canal
  });
  it('false quando já estava no canal (ex.: mute/deafen — canal não muda)', () => {
    expect(isJoinIntoChannel('voz-1', 'voz-1', 'voz-1')).toBe(false);
  });
  it('false quando entra NOUTRO canal, ou o bot não está em call', () => {
    expect(isJoinIntoChannel(null, 'voz-2', 'voz-1')).toBe(false); // outro canal
    expect(isJoinIntoChannel(null, 'voz-1', null)).toBe(false); // bot sem call
    expect(isJoinIntoChannel('voz-1', null, 'voz-1')).toBe(false); // saiu (não é entrada)
  });
});

describe('buildGreeting — texto + voz da saudação', () => {
  it('inglês por defeito: "Hello {name}" em voz inglesa', () => {
    const req = buildGreeting({ locale: 'en', name: 'Ana', availableModels: MODELS, defaultVoice: 'en_US-amy-medium', defaultSpeed: 1 });
    expect(req.text).toBe('Hello Ana');
    expect(req.model).toBe('en_US-amy-medium');
    expect(req.singleVoice).toBe(true);
  });
  it('usa a língua escolhida (pt -> "Olá") e uma voz dessa língua', () => {
    const req = buildGreeting({ locale: 'pt-BR', name: 'Rui', availableModels: MODELS, defaultVoice: 'en_US-amy-medium', defaultSpeed: 1 });
    expect(req.text).toBe('Olá Rui');
    expect(req.model).toBe('pt_BR-faber-medium'); // voz PT, não a default EN
  });
  it('língua sem saudação -> cai no inglês (texto E voz)', () => {
    const req = buildGreeting({ locale: 'ja', name: 'Yuki', availableModels: MODELS, defaultVoice: 'en_US-amy-medium', defaultSpeed: 1 });
    expect(req.text).toBe('Hello Yuki');
    expect(req.model).toBe('en_US-amy-medium');
  });
  it('sem nome -> só a saudação, sem espaço a mais', () => {
    expect(buildGreeting({ locale: 'en', name: '', availableModels: MODELS, defaultVoice: 'en_US-amy-medium', defaultSpeed: 1 }).text).toBe('Hello');
    expect(buildGreeting({ locale: 'pt', name: '', availableModels: MODELS, defaultVoice: 'en_US-amy-medium', defaultSpeed: 1 }).text).toBe('Olá');
  });
  it('língua sem voz instalada -> texto na língua, voz default', () => {
    const req = buildGreeting({ locale: 'fr', name: 'Léa', availableModels: MODELS, defaultVoice: 'en_US-amy-medium', defaultSpeed: 1 });
    expect(req.text).toBe('Bonjour Léa');
    expect(req.model).toBe('en_US-amy-medium'); // não há voz FR nos MODELS
  });
});

describe('GREET_LANGUAGE_CHOICES / GREET_LOCALES', () => {
  it('cada choice tem uma saudação e o código está no conjunto válido', () => {
    expect(GREET_LANGUAGE_CHOICES.length).toBeLessThanOrEqual(25); // cap do Discord
    for (const c of GREET_LANGUAGE_CHOICES) {
      expect(GREETINGS[c.value]).toBeDefined();
      expect(GREET_LOCALES.has(c.value)).toBe(true);
    }
    expect(GREET_LOCALES.has('en')).toBe(true);
  });
});

describe('guildConfig — greet fields', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });
  it('default: greetOnJoin ligado, greetLocale "en"', () => {
    const cfg = getGuildConfig(db, 'g1');
    expect(cfg.greetOnJoin).toBe(true);
    expect(cfg.greetLocale).toBe('en');
  });
  it('persiste toggle e língua sem perder outros campos', () => {
    setGuildConfig(db, 'g1', { greetOnJoin: false, greetLocale: 'pt' });
    const cfg = getGuildConfig(db, 'g1');
    expect(cfg.greetOnJoin).toBe(false);
    expect(cfg.greetLocale).toBe('pt');
    expect(cfg.enabled).toBe(true); // outros defaults intactos
  });
});
