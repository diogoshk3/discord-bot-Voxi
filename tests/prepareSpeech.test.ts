import { describe, it, expect } from 'vitest';
import { prepareSpeech, redactRequest, hasReadableText } from '../src/commands/prepareSpeech';
import { emphasisGain } from '../src/tts/emphasis';
import type { SynthRequest } from '../src/tts/engine';

// Catalogo de modelos (usado só como strings — a deteção automática foi removida, por isso
// a voz é SEMPRE a preferida, nunca escolhida pela língua do texto).
const AVAILABLE = ['en_US-amy-medium', 'pt_PT-google-medium', 'es_ES-davefx-medium'];

// Sem `as const`: mantê-lo tornava `pronunciations` um `readonly []` que não encaixa
// no PronunciationEntry[] (mutável) esperado pelo PrepareSpeechInput.
const BASE = {
  pronunciations: [] as { term: string; replacement: string }[],
  userVoice: null,
  available: AVAILABLE,
  defaultVoice: 'en_US-amy-medium',
  defaultSpeed: 1,
};

describe('prepareSpeech — voz FIXA (deteção removida)', () => {
  it('lê SEMPRE na voz preferida, singleVoice, sem segments — mesmo texto de outra língua', () => {
    const { req } = prepareSpeech({
      ...BASE,
      personal: 'isto e uma frase em portugues bem comprida que ANTES era detetada como portugues',
    });
    // Sem deteção: a voz é a preferida (.env => en_US-amy), não a da língua do texto.
    expect(req.model).toBe('en_US-amy-medium');
    expect(req.singleVoice).toBe(true);
    expect(req.segments).toBeUndefined();
  });

  it('honra a voz do user (user > guild > .env)', () => {
    const { req } = prepareSpeech({
      ...BASE,
      personal: 'texto qualquer',
      userVoice: { model: 'es_ES-davefx-medium', speed: 1.3 },
    });
    expect(req.model).toBe('es_ES-davefx-medium');
    expect(req.speed).toBe(1.3);
    expect(req.singleVoice).toBe(true);
    expect(req.segments).toBeUndefined();
  });

  it('expande gírias embutidas no texto falado (btw -> by the way)', () => {
    const { req, spoken } = prepareSpeech({ ...BASE, personal: 'brb omg' });
    expect(req.segments).toBeUndefined();
    expect(spoken).toBe('be right back oh my god');
  });
});

describe('prepareSpeech — teto de saída (anti-amplificação)', () => {
  it('limita o req.text a 2400 chars; o spoken fica inteiro (blocklist)', () => {
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

describe('prepareSpeech — anúncios (xsaid + media) localizados na voz', () => {
  it('xsaid: prefixo "{nome} said" na língua da voz (voz EN)', () => {
    const { req, spoken } = prepareSpeech({
      ...BASE,
      personal: 'hello there',
      announceSpeaker: 'Alex',
    });
    expect(spoken).toBe('Alex said hello there');
    expect(req.text).toBe('Alex said hello there');
  });

  it('emphasisSource = SÓ o corpo (sem o nome xsaid) — anti falso-grito', () => {
    // Bug: um nome/apelido em MAIÚSCULAS no prefixo xsaid fazia TODAS as mensagens
    // gritar. O emphasisSource tem de ser só o que o utilizador escreveu.
    const { req } = prepareSpeech({
      ...BASE,
      personal: 'hello there',
      announceSpeaker: 'DIOGO', // nome em MAIÚSCULAS
    });
    expect(req.text).toBe('DIOGO said hello there'); // o texto sintetizado leva o nome
    expect(req.emphasisSource).toBe('hello there'); // mas a ênfase vem só do corpo
    expect(emphasisGain(req.emphasisSource ?? req.text)).toBe(1); // corpo calmo -> não grita
    expect(emphasisGain(req.text)).toBeGreaterThan(1); // o texto decorado gritaria (bug antigo)
  });

  it('xsaid localizado na língua da VOZ: voz PT -> "disse"', () => {
    const { spoken } = prepareSpeech({
      ...BASE,
      personal: 'uma frase qualquer',
      userVoice: { model: 'pt_PT-google-medium', speed: 1 },
      announceSpeaker: 'Alex',
    });
    expect(spoken.startsWith('Alex disse ')).toBe(true);
  });

  it('media: sufixo no fim, corpo vazio -> "{nome} said a gif"', () => {
    const { spoken } = prepareSpeech({
      ...BASE,
      personal: '',
      announceSpeaker: 'Alex',
      media: [{ kind: 'gif' }],
    });
    expect(spoken).toBe('Alex said a gif');
  });
});

describe('prepareSpeech — /pronunciation sobrepoe a lista de girias embutida', () => {
  it('pronuncia btw->batata GANHA a giria (nao "by the way")', () => {
    const { spoken, req } = prepareSpeech({
      ...BASE,
      personal: 'btw',
      pronunciations: [{ term: 'btw', replacement: 'batata' }],
      userVoice: { model: 'es_ES-davefx-medium', speed: 1 },
    });
    expect(spoken).toBe('batata');
    expect(req.singleVoice).toBe(true);
  });

  it('SEM pronuncia, btw expande normalmente para "by the way"', () => {
    const { spoken } = prepareSpeech({
      ...BASE,
      personal: 'btw',
      userVoice: { model: 'es_ES-davefx-medium', speed: 1 },
    });
    expect(spoken).toBe('by the way');
  });
});

describe('hasReadableText — ha letra ou numero?', () => {
  it('true quando ha letra/numero', () => {
    expect(hasReadableText('abc')).toBe(true);
    expect(hasReadableText('  1  ')).toBe(true);
  });
  it('false quando so ha espacos/pontuacao', () => {
    expect(hasReadableText('')).toBe(false);
    expect(hasReadableText('   ')).toBe(false);
    expect(hasReadableText('!!! ,. ')).toBe(false);
  });
});

describe('redactRequest — redige a blocklist no SynthRequest', () => {
  const base: SynthRequest = { text: 'ola palavrao mundo', model: 'en_US-amy-medium', speed: 1 };

  it('blocklist vazia -> req inalterado (mesma referencia)', () => {
    expect(redactRequest(base, [])).toBe(base);
  });

  it('remove a palavra do req.text', () => {
    const out = redactRequest(base, ['palavrao']);
    expect(out.text).toBe('ola mundo');
    expect(out.model).toBe('en_US-amy-medium');
    expect(out.speed).toBe(1);
  });

  it('redige cada segmento e mantem os que ficam com texto', () => {
    const req: SynthRequest = {
      text: 'ola palavrao hi',
      model: 'en_US-amy-medium',
      speed: 1,
      segments: [
        { text: 'ola palavrao', model: 'pt_PT-google-medium' },
        { text: 'hi', model: 'en_US-amy-medium' },
      ],
    };
    const out = redactRequest(req, ['palavrao']);
    expect(out.segments).toEqual([
      { text: 'ola', model: 'pt_PT-google-medium' },
      { text: 'hi', model: 'en_US-amy-medium' },
    ]);
  });

  it('segmento que fica sem nada legivel e retirado', () => {
    const req: SynthRequest = {
      text: 'palavrao hi',
      model: 'en_US-amy-medium',
      speed: 1,
      segments: [
        { text: 'palavrao', model: 'pt_PT-google-medium' },
        { text: 'hi', model: 'en_US-amy-medium' },
      ],
    };
    const out = redactRequest(req, ['palavrao']);
    expect(out.segments).toEqual([{ text: 'hi', model: 'en_US-amy-medium' }]);
  });

  it('se todos os segmentos ficam vazios, segments vira undefined', () => {
    const req: SynthRequest = {
      text: 'palavrao',
      model: 'en_US-amy-medium',
      speed: 1,
      segments: [{ text: 'palavrao', model: 'pt_PT-google-medium' }],
    };
    const out = redactRequest(req, ['palavrao']);
    expect(out.segments).toBeUndefined();
    expect(hasReadableText(out.text)).toBe(false); // chamador nao fala
  });
});
