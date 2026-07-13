import { describe, it, expect } from 'vitest';
import { filterPronunciationChoices } from '../src/commands/index';

// Autocomplete do /pronunciation remove (e /serverpronunciation remove): em vez de o
// utilizador ESCREVER o termo de cor, o picker lista as pronúncias GUARDADAS.
// name = "termo → como se diz" (legível); value = o termo cru (o que o handler apaga).

const DICT = [
  { term: 'gg', replacement: 'good game' },
  { term: 'brb', replacement: 'be right back' },
  { term: 'sql', replacement: 'sequel' },
];

describe('filterPronunciationChoices', () => {
  it('sem query lista tudo, name legível e value = termo cru', () => {
    const out = filterPronunciationChoices(DICT, '');
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ name: 'gg → good game', value: 'gg' });
    expect(out.map((c) => c.value)).toEqual(['gg', 'brb', 'sql']);
  });

  it('filtra por substring do TERMO (case-insensitive)', () => {
    expect(filterPronunciationChoices(DICT, 'BR').map((c) => c.value)).toEqual(['brb']);
  });

  it('filtra também pela SUBSTITUIÇÃO (quem só se lembra do "como se diz")', () => {
    expect(filterPronunciationChoices(DICT, 'sequel').map((c) => c.value)).toEqual(['sql']);
  });

  it('sem matches -> lista vazia', () => {
    expect(filterPronunciationChoices(DICT, 'xyz')).toEqual([]);
  });

  it('respeita o cap de 25 do Discord', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      term: `term-${i}`,
      replacement: `rep ${i}`,
    }));
    expect(filterPronunciationChoices(many, '')).toHaveLength(25);
  });
});
