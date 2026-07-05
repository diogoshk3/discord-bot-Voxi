import { describe, it, expect } from 'vitest';
import { prepareSpeech } from '../src/commands/prepareSpeech';

// Catalogo: EN + PT + ES (mesmo dos testes de resolveSynth).
const AVAILABLE = ['en_US-amy-medium', 'pt_PT-tugao-medium', 'es_ES-davefx-medium'];

const BASE = {
  pronunciations: [],
  userVoice: null,
  available: AVAILABLE,
  defaultVoice: 'en_US-amy-medium',
  defaultSpeed: 1,
  autoDetect: true,
} as const;

describe('prepareSpeech — texto sem girias (single voice)', () => {
  it('frase PT longa -> req sem `segments`, model pt_', () => {
    const { req } = prepareSpeech({
      ...BASE,
      personal: 'isto e uma frase em portugues bem comprida para deteccao de lingua correta e fiavel',
    });
    expect(req.model.startsWith('pt_')).toBe(true);
    expect(req.segments).toBeUndefined();
    expect(req.singleVoice).toBeUndefined();
  });
});

describe('prepareSpeech — so girias (single voice EN)', () => {
  it('"brb omg" -> req sem `segments`, model en_', () => {
    const { req, spoken } = prepareSpeech({ ...BASE, personal: 'brb omg' });
    expect(req.model.startsWith('en_')).toBe(true);
    expect(req.segments).toBeUndefined();
    // As girias foram expandidas no texto falado.
    expect(spoken).toBe('be right back oh my god');
  });
});

describe('prepareSpeech — teto de saída (anti-amplificação)', () => {
  it('limita o req.text a 2400 chars; o spoken fica inteiro (blocklist)', () => {
    // Texto que, mesmo sem expansão, já ultrapassa o teto de síntese.
    const long = 'palavra '.repeat(500); // ~4000 chars
    const { req, spoken } = prepareSpeech({ ...BASE, personal: long });
    expect(req.text.length).toBe(2400); // o que vai para a síntese é limitado
    expect(spoken.length).toBeGreaterThan(2400); // o spoken (blocklist) NÃO é truncado
  });

  it('não mexe em texto normal (abaixo do teto)', () => {
    const { req } = prepareSpeech({ ...BASE, personal: 'uma frase normal e curta' });
    expect(req.text.length).toBeLessThan(2400);
  });
});

describe('prepareSpeech — MISTURADO (voz por-segmento)', () => {
  it('"isto esta a funcionar muito bem hoje btw" -> segments length 2, base pt_, giria en_', () => {
    const { req, spoken } = prepareSpeech({
      ...BASE,
      personal: 'isto esta a funcionar muito bem hoje btw',
    });
    expect(req.segments).toBeDefined();
    expect(req.segments).toHaveLength(2);
    // 1.o segmento = base PT (frase longa deteta 'por').
    expect(req.segments![0].text).toBe('isto esta a funcionar muito bem hoje');
    expect(req.segments![0].model.startsWith('pt_')).toBe(true);
    // 2.o segmento = giria expandida em voz EN.
    expect(req.segments![1].text).toBe('by the way');
    expect(req.segments![1].model.startsWith('en_')).toBe(true);
    // Voz-base/fallback do req = pt_.
    expect(req.model.startsWith('pt_')).toBe(true);
    expect(req.singleVoice).toBeUndefined();
    expect(spoken).toBe('isto esta a funcionar muito bem hoje by the way');
  });
});

describe('prepareSpeech — anúncios (xsaid + media) localizados na voz', () => {
  it('xsaid: prefixo "{nome} said" na língua da voz (single voice EN)', () => {
    const { req, spoken } = prepareSpeech({
      ...BASE,
      autoDetect: false, // voz fixa EN (amy)
      personal: 'hello there',
      announceSpeaker: 'Alex',
    });
    expect(spoken).toBe('Alex said hello there');
    expect(req.text).toBe('Alex said hello there');
  });

  it('xsaid localizado: voz PT -> "disse"', () => {
    const { spoken } = prepareSpeech({
      ...BASE,
      personal: 'isto e uma frase longa em portugues para detetar a lingua de forma fiavel',
      announceSpeaker: 'Alex',
    });
    expect(spoken.startsWith('Alex disse ')).toBe(true);
  });

  it('media: sufixo no fim, corpo vazio -> "{nome} said a gif"', () => {
    const { spoken } = prepareSpeech({
      ...BASE,
      autoDetect: false,
      personal: '',
      announceSpeaker: 'Alex',
      media: [{ kind: 'gif' }],
    });
    expect(spoken).toBe('Alex said a gif');
  });

  it('MISTURADO: xsaid e media entram como segmentos extra na voz-base', () => {
    const { req } = prepareSpeech({
      ...BASE,
      personal: 'isto esta a funcionar muito bem hoje btw',
      announceSpeaker: 'Alex',
      media: [{ kind: 'link' }],
    });
    expect(req.segments).toHaveLength(4); // [xsaid, base pt, giria en, media]
    expect(req.segments![0].text).toBe('Alex disse'); // voz-base é pt_ -> "disse"
    expect(req.segments![0].model.startsWith('pt_')).toBe(true);
    expect(req.segments![3].text).toBe('um link'); // pt_ -> "um link"
    expect(req.segments![3].model.startsWith('pt_')).toBe(true);
    // req.text carrega tudo (fallback single-voice + base da cache).
    expect(req.text).toBe('Alex disse isto esta a funcionar muito bem hoje by the way um link');
  });
});

describe('prepareSpeech — /pronunciation sobrepoe a lista de girias embutida', () => {
  it('OFF: pronuncia btw->batata GANHA a giria (nao "by the way")', () => {
    const { spoken, req } = prepareSpeech({
      ...BASE,
      personal: 'btw',
      pronunciations: [{ term: 'btw', replacement: 'batata' }],
      userVoice: { model: 'es_ES-davefx-medium', speed: 1 },
      autoDetect: false,
    });
    expect(spoken).toBe('batata');
    expect(req.singleVoice).toBe(true);
  });

  it('OFF: SEM pronuncia, btw expande normalmente para "by the way"', () => {
    const { spoken } = prepareSpeech({
      ...BASE,
      personal: 'btw',
      userVoice: { model: 'es_ES-davefx-medium', speed: 1 },
      autoDetect: false,
    });
    expect(spoken).toBe('by the way');
  });

  it('ON: pronuncia btw->batata evita o split de giria (uma voz base, sem "by the way")', () => {
    const { req, spoken } = prepareSpeech({
      ...BASE,
      personal: 'isto esta a funcionar muito bem hoje btw',
      pronunciations: [{ term: 'btw', replacement: 'batata' }],
    });
    expect(spoken).toContain('batata');
    expect(spoken).not.toContain('by the way');
    // Sem giria EN reconhecida -> nao ha split misturado; uma so voz base (pt_).
    expect(req.segments).toBeUndefined();
    expect(req.model.startsWith('pt_')).toBe(true);
  });
});

describe('prepareSpeech — autoDetect OFF (voz fixa)', () => {
  it('autoDetect:false -> singleVoice:true, model = preferida, sem segments', () => {
    const { req } = prepareSpeech({
      ...BASE,
      personal: 'isto e uma frase em portugues bem comprida para deteccao de lingua',
      userVoice: { model: 'en_US-amy-medium', speed: 1.3 },
      autoDetect: false,
    });
    expect(req.singleVoice).toBe(true);
    expect(req.model).toBe('en_US-amy-medium');
    expect(req.speed).toBe(1.3);
    expect(req.segments).toBeUndefined();
  });
});
