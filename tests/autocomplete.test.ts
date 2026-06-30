import { describe, it, expect } from 'vitest';
import { filterModelChoices } from '../src/commands/index';
import { modelDisplayName } from '../src/language/voiceMap';

describe('modelDisplayName', () => {
  it('mostra a lingua escrita na propria lingua (autonimo)', () => {
    expect(modelDisplayName('pt_PT-tugao-medium')).toBe('Português (Portugal)');
    expect(modelDisplayName('pt_BR-faber-medium')).toBe('Português (Brasil)');
    expect(modelDisplayName('en_US-amy-medium')).toBe('English (US)');
    expect(modelDisplayName('fr_FR-siwis-medium')).toBe('Français');
    expect(modelDisplayName('de_DE-thorsten-medium')).toBe('Deutsch');
    expect(modelDisplayName('zh_CN-huayan-medium')).toBe('中文');
  });
  it('faz fallback ao id quando o locale nao esta mapeado (nunca esconde a voz)', () => {
    expect(modelDisplayName('xx_YY-foo-medium')).toBe('xx_YY-foo-medium');
  });
});

describe('filterModelChoices (autocomplete)', () => {
  const models = ['pt_PT-tugao-medium', 'en_US-amy-medium', 'fr_FR-siwis-medium'];

  it('name = autonimo, value = id, ordenado por nome', () => {
    expect(filterModelChoices(models, '')).toEqual([
      { name: 'English (US)', value: 'en_US-amy-medium' },
      { name: 'Français', value: 'fr_FR-siwis-medium' },
      { name: 'Português (Portugal)', value: 'pt_PT-tugao-medium' },
    ]);
  });

  it('filtra pelo nome da lingua (o utilizador escreve "portu")', () => {
    expect(filterModelChoices(models, 'portu').map((c) => c.value)).toEqual(['pt_PT-tugao-medium']);
  });

  it('filtra tambem pelo id do modelo (ex. nome da voz)', () => {
    expect(filterModelChoices(models, 'siwis').map((c) => c.value)).toEqual(['fr_FR-siwis-medium']);
  });

  it('e case-insensitive e ignora espacos', () => {
    expect(filterModelChoices(models, '  ENGLISH ').map((c) => c.value)).toEqual(['en_US-amy-medium']);
  });

  it('limita a 25 sugestoes (maximo do Discord)', () => {
    const many = Array.from({ length: 40 }, (_, i) => `en_US-voz${i}-medium`);
    expect(filterModelChoices(many, '').length).toBe(25);
  });
});
