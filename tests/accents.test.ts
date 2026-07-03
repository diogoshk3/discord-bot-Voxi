import { describe, it, expect } from 'vitest';
import { restoreAccents, accentLangOfModel } from '../src/textCleaning/accents';
import { prepareSpeech } from '../src/commands/prepareSpeech';

describe('restoreAccents — repõe acentos da língua', () => {
  it('PT: palavras comuns sem acento -> com acento', () => {
    expect(restoreAccents('nao', 'por')).toBe('não');
    expect(restoreAccents('voce e portugues', 'por')).toBe('você e português'); // "e" fica (ambíguo)
    expect(restoreAccents('ate amanha', 'por')).toBe('até amanhã');
    expect(restoreAccents('isto e muito rapido e facil', 'por')).toBe('isto e muito rápido e fácil');
  });

  it('PT: cedilha e nasais', () => {
    expect(restoreAccents('servico', 'por')).toBe('serviço');
    expect(restoreAccents('vamos comecar', 'por')).toBe('vamos começar');
    expect(restoreAccents('bom preco', 'por')).toBe('bom preço');
    expect(restoreAccents('coracao', 'por')).toBe('coração');
    expect(restoreAccents('a minha mae', 'por')).toBe('a minha mãe');
  });

  it('PT: preserva a capitalização e a fronteira de palavra', () => {
    expect(restoreAccents('Nao', 'por')).toBe('Não');
    expect(restoreAccents('NAO', 'por')).toBe('NÃO');
    expect(restoreAccents('Voce', 'por')).toBe('Você');
    expect(restoreAccents('nao!', 'por')).toBe('não!');
    expect(restoreAccents('naopode', 'por')).toBe('naopode'); // não casa dentro de palavra
  });

  it('PT: pares AMBÍGUOS NÃO são tocados (não estraga palavras válidas)', () => {
    for (const w of ['esta', 'e', 'so', 'musica', 'pratica', 'pais', 'pode', 'publico']) {
      expect(restoreAccents(w, 'por')).toBe(w);
    }
  });

  it('outras línguas: ES/FR restauram; sem dicionário = no-op', () => {
    expect(restoreAccents('informacion', 'spa')).toBe('información');
    expect(restoreAccents('francais', 'fra')).toBe('français');
    expect(restoreAccents('nao', 'eng')).toBe('nao'); // inglês não tem dict
    // alemão TEM dict, mas 'nao' não é chave alemã -> no-op (não toca).
    expect(restoreAccents('nao', 'deu')).toBe('nao');
    expect(restoreAccents('nao', '')).toBe('nao');
  });

  it('DE: repõe o Umlaut de palavras seguras (forma sem-trema não é palavra alemã)', () => {
    expect(restoreAccents('fur', 'deu')).toBe('für');
    expect(restoreAccents('konnen', 'deu')).toBe('können');
    expect(restoreAccents('grun', 'deu')).toBe('grün');
    expect(restoreAccents('ich mochte funf', 'deu')).toBe('ich mochte fünf'); // "mochte" fica (ambíguo)
    expect(restoreAccents('naturlich', 'deu')).toBe('natürlich');
  });

  it('DE: preserva capitalização e fronteira', () => {
    expect(restoreAccents('Tur', 'deu')).toBe('Tür'); // 1.ª maiúscula
    expect(restoreAccents('FUNF', 'deu')).toBe('FÜNF'); // tudo maiúsculas
    expect(restoreAccents('fur!', 'deu')).toBe('für!'); // pontuação = fronteira
    expect(restoreAccents('furcht', 'deu')).toBe('furcht'); // não casa dentro de palavra
  });

  it('DE: pares MÍNIMOS ambíguos NÃO são tocados (a forma sem-trema é outra palavra)', () => {
    // Landmines: cada um é uma palavra alemã comum por si só -> tem de ficar intacto.
    for (const w of [
      'schon', 'wurde', 'mochte', 'hatte', 'konnte', 'musste', 'durfte',
      'ware', 'wahlen', 'zahlen', 'lauft', 'uber',
    ]) {
      expect(restoreAccents(w, 'deu')).toBe(w);
    }
  });

  it('accentLangOfModel: prefixo do modelo -> ISO (só línguas com dict)', () => {
    expect(accentLangOfModel('pt_PT-tugao-medium')).toBe('por');
    expect(accentLangOfModel('es_ES-davefx-medium')).toBe('spa');
    expect(accentLangOfModel('fr_FR-siwis-medium')).toBe('fra');
    expect(accentLangOfModel('de_DE-thorsten-medium')).toBe('deu');
    expect(accentLangOfModel('en_US-amy-medium')).toBe('');
  });
});

describe('prepareSpeech — integra o restauro de acentos', () => {
  const available = ['en_US-amy-medium', 'pt_PT-tugao-medium', 'es_ES-davefx-medium'];
  const base = {
    pronunciations: [],
    userVoice: null,
    available,
    defaultVoice: 'en_US-amy-medium',
    defaultSpeed: 1,
    autoDetect: true,
  } as const;

  it('língua-base PT (via memória) => o texto falado leva os acentos', () => {
    const r = prepareSpeech({ ...base, personal: 'nao quero fazer isto amanha', recentLang: 'por' });
    expect(r.req.model.startsWith('pt_')).toBe(true);
    expect(r.spoken).toContain('não');
    expect(r.spoken).toContain('amanhã');
  });

  it('voz fixa (autoDetect OFF) PT => restaura pela língua da voz', () => {
    const r = prepareSpeech({
      ...base,
      personal: 'nao voce',
      autoDetect: false,
      userVoice: { model: 'pt_PT-tugao-medium', speed: 1 },
    });
    expect(r.spoken).toBe('não você');
    expect(r.req.singleVoice).toBe(true);
  });
});
