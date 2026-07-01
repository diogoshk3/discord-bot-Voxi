import { describe, it, expect } from 'vitest';
import { resolveSynth } from '../src/commands/resolveSynth';

// Frases LONGAS verificadas empiricamente com franc v5: PT -> 'por', EN -> 'eng'.
// (franc precisa de texto suficiente; frases curtas devolvem '' e cairiam na voz
// preferida — evitamos isso para que as asercoes de troca de voz sejam reais.)
const PT_LONG = 'isto e uma frase em portugues para deteccao de lingua correta e sem duvidas nenhumas';
const EN_LONG = 'hello world this is a longer test sentence for reliable language detection here today';

describe('resolveSynth — a lingua da mensagem decide a voz', () => {
  // Catalogo com duas vozes inglesas (para provar "honra a voz especifica") + PT + ES.
  const available = ['en_GB-alan-medium', 'en_US-amy-medium', 'pt_PT-tugao-medium', 'es_ES-davefx-medium'];

  // ── O BUG DO DONO: voz inglesa fixa NAO pode ler portugues ────────────────
  it('user com voz inglesa + texto PORTUGUES => troca para voz pt_ (nao le PT na voz EN)', () => {
    const r = resolveSynth({
      text: PT_LONG,
      userVoice: { model: 'en_US-amy-medium', speed: 1.3 },
      available,
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    expect(r.model.startsWith('pt_')).toBe(true);
    expect(r.model).toBe('pt_PT-tugao-medium');
    // velocidade: ha userVoice => usa a do user.
    expect(r.speed).toBe(1.3);
    expect(r.text).toBe(PT_LONG);
  });

  it('user com voz inglesa + texto INGLES => mantem a voz inglesa do user', () => {
    const r = resolveSynth({
      text: EN_LONG,
      userVoice: { model: 'en_US-amy-medium', speed: 1.3 },
      available,
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    expect(r.model).toBe('en_US-amy-medium');
    expect(r.speed).toBe(1.3);
  });

  it('user com en_GB-alan + texto INGLES (havendo tambem en_US-amy) => honra a voz especifica alan', () => {
    const r = resolveSynth({
      text: EN_LONG,
      userVoice: { model: 'en_GB-alan-medium', speed: 0.9 },
      available,
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    // Nao troca para a 1.ª voz en_ alfabetica — mantem a escolha especifica do user.
    expect(r.model).toBe('en_GB-alan-medium');
    expect(r.speed).toBe(0.9);
  });

  it('sem userVoice + texto PORTUGUES => voz pt_', () => {
    const r = resolveSynth({
      text: PT_LONG,
      userVoice: null,
      available,
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    expect(r.model.startsWith('pt_')).toBe(true);
    // sem userVoice => velocidade default.
    expect(r.speed).toBe(1.0);
  });

  it('sem userVoice, guild default na lingua do texto => usa o guild default especifico', () => {
    // guild default en_GB-alan; texto EN => bate a lingua => honra alan (nao amy).
    const r = resolveSynth({
      text: EN_LONG,
      userVoice: null,
      available,
      guildDefaultVoice: 'en_GB-alan-medium',
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    expect(r.model).toBe('en_GB-alan-medium');
    expect(r.speed).toBe(1.0);
  });

  it('deteccao falha (texto vazio) => devolve a voz preferida', () => {
    const r = resolveSynth({
      text: '',
      userVoice: null,
      available,
      guildDefaultVoice: 'pt_PT-tugao-medium',
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    // lingua '' => honra preferida (guild default aqui).
    expect(r.model).toBe('pt_PT-tugao-medium');
  });

  it('lingua detetada sem modelo disponivel => fallback a voz preferida', () => {
    // Texto EN detetado como 'eng', mas nao ha nenhum modelo en_ disponivel.
    const noEnglish = ['pt_PT-tugao-medium', 'es_ES-davefx-medium'];
    const r = resolveSynth({
      text: EN_LONG,
      userVoice: null,
      available: noEnglish,
      guildDefaultVoice: 'pt_PT-tugao-medium',
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    expect(r.model).toBe('pt_PT-tugao-medium'); // preferida (guild default)
  });
});

describe('resolveSynth — precedencia da voz PREFERIDA (user > guild > .env > amy)', () => {
  const available = ['en_US-amy-medium', 'pt_PT-tugao-medium'];

  // Textos vazios => deteccao falha => a voz resultante e exatamente a preferida,
  // por isso estes casos isolam a cadeia de precedencia.
  it('user vence guild default e .env', () => {
    const r = resolveSynth({
      text: '',
      userVoice: { model: 'pt_PT-tugao-medium', speed: 0.8 },
      available,
      guildDefaultVoice: 'en_US-amy-medium',
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    expect(r.model).toBe('pt_PT-tugao-medium');
    expect(r.speed).toBe(0.8);
  });

  it('sem user, guild default definido => guild default vence o .env', () => {
    const r = resolveSynth({
      text: '',
      userVoice: null,
      available,
      guildDefaultVoice: 'pt_PT-tugao-medium',
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    expect(r.model).toBe('pt_PT-tugao-medium');
  });

  it('guild default vazio => cai no .env defaultVoice', () => {
    const r = resolveSynth({
      text: '',
      userVoice: null,
      available,
      guildDefaultVoice: '',
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    expect(r.model).toBe('en_US-amy-medium');
  });

  it('guild default ausente (undefined) => cai no .env defaultVoice', () => {
    const r = resolveSynth({
      text: '',
      userVoice: null,
      available,
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    expect(r.model).toBe('en_US-amy-medium');
  });

  it('sem guild default e sem .env => fallback final en_US-amy-medium', () => {
    const r = resolveSynth({
      text: '',
      userVoice: null,
      available,
      guildDefaultVoice: '',
      defaultVoice: '',
      defaultSpeed: 1.0,
    });
    expect(r.model).toBe('en_US-amy-medium');
  });
});

describe('resolveSynth — forceLang (stretch: girias EM SO ingles forcam voz EN)', () => {
  const available = ['pt_PT-tugao-medium', 'en_US-amy-medium'];

  it('forceLang="eng" ignora o detectLang e escolhe voz EN mesmo com texto curto', () => {
    // 'be right back' e curto -> detectLang devolveria '' e cairia na preferida (pt).
    // Com forceLang='eng', escolhe uma voz en_ na mesma.
    const r = resolveSynth({
      text: 'be right back',
      userVoice: { model: 'pt_PT-tugao-medium', speed: 1.0 },
      available,
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
      forceLang: 'eng',
    });
    expect(r.model.startsWith('en_')).toBe(true);
    expect(r.model).toBe('en_US-amy-medium');
  });

  it('forceLang vazio/undefined mantem o comportamento normal (detecta a lingua)', () => {
    const r = resolveSynth({
      text: PT_LONG,
      userVoice: null,
      available,
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
      forceLang: undefined,
    });
    expect(r.model.startsWith('pt_')).toBe(true);
  });
});

describe('resolveSynth — velocidade', () => {
  const available = ['en_US-amy-medium', 'pt_PT-tugao-medium'];

  it('com userVoice usa userVoice.speed', () => {
    const r = resolveSynth({
      text: EN_LONG,
      userVoice: { model: 'en_US-amy-medium', speed: 1.7 },
      available,
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.0,
    });
    expect(r.speed).toBe(1.7);
  });

  it('sem userVoice usa defaultSpeed', () => {
    const r = resolveSynth({
      text: EN_LONG,
      userVoice: null,
      available,
      defaultVoice: 'en_US-amy-medium',
      defaultSpeed: 1.25,
    });
    expect(r.speed).toBe(1.25);
  });
});
