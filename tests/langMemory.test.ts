import { describe, it, expect, beforeEach } from 'vitest';
import {
  rememberLang,
  recallLang,
  __setClock,
  __resetLangMemory,
} from '../src/language/langMemory';
import { detectLangDetailed } from '../src/language/detect';
import { prepareSpeech } from '../src/commands/prepareSpeech';

describe('langMemory — memória adaptativa por-user', () => {
  let clock = 0;
  beforeEach(() => {
    __resetLangMemory();
    clock = 1_000_000;
    __setClock(() => clock);
  });

  it('recorda a língua memorizada para (guild, user)', () => {
    rememberLang('g1', 'u1', 'por');
    expect(recallLang('g1', 'u1')).toBe('por');
    // Isolado por user e por guild.
    expect(recallLang('g1', 'u2')).toBe('');
    expect(recallLang('g2', 'u1')).toBe('');
  });

  it('lang vazio não apaga uma memória anterior', () => {
    rememberLang('g1', 'u1', 'por');
    rememberLang('g1', 'u1', ''); // no-op
    expect(recallLang('g1', 'u1')).toBe('por');
  });

  it('expira após o TTL (15 min)', () => {
    rememberLang('g1', 'u1', 'eng');
    clock += 15 * 60 * 1000 - 1; // ainda dentro
    expect(recallLang('g1', 'u1')).toBe('eng');
    clock += 2; // ultrapassa o TTL
    expect(recallLang('g1', 'u1')).toBe('');
  });

  it('uma deteção nova renova o timestamp (desliza a janela)', () => {
    rememberLang('g1', 'u1', 'por');
    clock += 10 * 60 * 1000;
    rememberLang('g1', 'u1', 'por'); // renova
    clock += 10 * 60 * 1000; // 20min desde o 1.º, mas 10 desde o 2.º
    expect(recallLang('g1', 'u1')).toBe('por');
  });
});

describe('detectLangDetailed — sinal de confiança', () => {
  it('match de léxico de saudação => confiante', () => {
    expect(detectLangDetailed('olá')).toEqual({ lang: 'por', confident: true });
    expect(detectLangDetailed('hello')).toEqual({ lang: 'eng', confident: true });
  });

  it('frase longa e clara => confiante', () => {
    const r = detectLangDetailed(
      'hello everyone this is a clearly english sentence with plenty of words for detection',
    );
    expect(r.lang).toBe('eng');
    expect(r.confident).toBe(true);
  });

  it('fragmento PT curto ambíguo (franc dá spa quase empatado) => NÃO confiante', () => {
    const r = detectLangDetailed('isto ta a funcionar');
    // franc devolve spa com por logo atrás (margem ~0.01) -> não confiante.
    expect(r.confident).toBe(false);
  });

  it('texto vazio => lang "" e não confiante', () => {
    expect(detectLangDetailed('')).toEqual({ lang: '', confident: false });
  });
});

describe('prepareSpeech — usa recentLang em ambíguo, memoriza confiante', () => {
  const available = ['en_US-amy-medium', 'pt_PT-tugao-medium', 'es_ES-davefx-medium'];
  // Sem `as const`: tornava `pronunciations` um readonly [] incompatível com o
  // PronunciationEntry[] (mutável) do PrepareSpeechInput.
  const base = {
    pronunciations: [] as { term: string; replacement: string }[],
    userVoice: null,
    available,
    defaultVoice: 'en_US-amy-medium',
    defaultSpeed: 1,
    autoDetect: true,
  };

  it('fragmento ambíguo + recentLang=por => usa voz pt_ (não o palpite espanhol)', () => {
    const r = prepareSpeech({ ...base, personal: 'isto ta a funcionar', recentLang: 'por' });
    expect(r.req.model.startsWith('pt_')).toBe(true);
    expect(r.learnedLang).toBe(''); // ambíguo: não memoriza
  });

  it('fragmento ambíguo SEM recentLang => comportamento de hoje (palpite do franc)', () => {
    const r = prepareSpeech({ ...base, personal: 'isto ta a funcionar' });
    // Sem memória, cai no palpite (spa) — voz es_ (o comportamento aceite).
    expect(r.req.model.startsWith('es_')).toBe(true);
    expect(r.learnedLang).toBe('');
  });

  it('deteção confiante => learnedLang preenchido (para o caller memorizar) e IGNORA recentLang', () => {
    const r = prepareSpeech({
      ...base,
      personal: 'hello everyone this is a clearly english sentence for detection today',
      recentLang: 'por', // deve ser ignorado porque a deteção é confiante
    });
    expect(r.req.model.startsWith('en_')).toBe(true);
    expect(r.learnedLang).toBe('eng');
  });

  it('saudação de léxico é confiante e memoriza a sua língua', () => {
    const r = prepareSpeech({ ...base, personal: 'olá' });
    expect(r.req.model.startsWith('pt_')).toBe(true);
    expect(r.learnedLang).toBe('por');
  });
});
