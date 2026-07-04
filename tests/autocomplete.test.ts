import { describe, it, expect, vi } from 'vitest';
import {
  filterModelChoices,
  filterLocaleChoices,
  handleAutocomplete,
  commandDefs,
} from '../src/commands/index';
import { modelDisplayName } from '../src/language/voiceMap';

describe('modelDisplayName', () => {
  it('mostra a lingua escrita na propria lingua (autonimo)', () => {
    expect(modelDisplayName('pt_PT-tugao-medium')).toBe('Português (Portugal)');
    expect(modelDisplayName('pt_BR-faber-medium')).toBe('Português'); // pt_BR mostra-se só "Português"
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

  it('com >25 modelos devolve exatamente 25, ordenados (sort ANTES do slice)', () => {
    // Locales nao mapeados -> modelDisplayName cai no id cru, por isso cada modelo
    // tem um nome DISTINTO (ao contrario dos en_US-… que colapsam em "English (US)").
    // Baralhamos a entrada para provar que a ordenacao acontece antes do corte: se
    // o slice viesse antes do sort, o resultado nao seria o prefixo ordenado.
    const ids = Array.from({ length: 30 }, (_, i) =>
      `zz_ZZ-v${String(i).padStart(2, '0')}-medium`,
    );
    const shuffled = [...ids].reverse(); // ordem de entrada != ordem final
    const out = filterModelChoices(shuffled, '');
    expect(out.length).toBe(25);
    // Os 25 primeiros por nome (id cru) ordenado — nao os 25 primeiros da entrada.
    const expected = [...ids].sort((a, b) => a.localeCompare(b)).slice(0, 25);
    expect(out.map((c) => c.value)).toEqual(expected);
  });

  it('query que nao bate em nada devolve [] (sem sugestoes)', () => {
    expect(filterModelChoices(models, 'zzzz-nao-existe')).toEqual([]);
  });
});

// Pedido do Diogo: os nomes das línguas no picker do /voice set aparecem NA LÍNGUA DO
// UTILIZADOR (o locale do cliente Discord), via Intl.DisplayNames. Sem locale -> autónimo.
describe('filterModelChoices — nomes das línguas no locale do utilizador', () => {
  const models = ['pt_PT-tugao-medium', 'en_US-amy-medium', 'fr_FR-siwis-medium', 'de_DE-thorsten-medium'];

  it('locale pt-BR -> nomes em português', () => {
    const names = filterModelChoices(models, '', 'pt-BR').map((c) => c.name);
    expect(names).toContain('Alemão');
    expect(names).toContain('Francês');
    expect(names).toContain('Português');
    expect(names).toContain('Inglês'); // região só aparece se houver >1 região da base
  });

  it('locale fr -> nomes em francês', () => {
    const names = filterModelChoices(models, '', 'fr').map((c) => c.name);
    expect(names).toContain('Allemand');
    expect(names).toContain('Anglais');
    expect(names).toContain('Portugais');
  });

  it('locale de -> nomes em alemão', () => {
    const names = filterModelChoices(models, '', 'de').map((c) => c.name);
    expect(names).toContain('Deutsch');
    expect(names).toContain('Englisch');
  });

  it('mostra a REGIÃO (localizada) quando a base tem >1 região instalada', () => {
    const multi = ['en_US-amy-medium', 'en_GB-alan-medium'];
    const names = filterModelChoices(multi, '', 'pt-BR').map((c) => c.name);
    expect(names).toContain('Inglês (Estados Unidos)');
    expect(names).toContain('Inglês (Reino Unido)');
  });

  it('o utilizador pode PROCURAR na sua própria língua (ex.: "alemão")', () => {
    expect(filterModelChoices(models, 'alemão', 'pt-BR').map((c) => c.value)).toEqual([
      'de_DE-thorsten-medium',
    ]);
  });

  it('locale estranho -> não rebenta e devolve todas as vozes', () => {
    // Intl é tolerante (cai em en para tags desconhecidas mas bem-formadas); o que
    // importa é NUNCA rebentar e nunca esconder uma voz.
    const out = filterModelChoices(models, '', 'zz-nonsense');
    expect(out.length).toBe(models.length);
    expect(out.map((c) => c.value)).toContain('de_DE-thorsten-medium');
  });
});

describe('handleAutocomplete', () => {
  // Deps minimo: o handler so le deps.availableModels no ramo 'model'.
  const deps = { availableModels: ['pt_PT-tugao-medium', 'en_US-amy-medium'] } as any;

  it('opcao focada e "model": responde com as choices filtradas', async () => {
    const respond = vi.fn();
    const i = {
      options: { getFocused: () => ({ name: 'model', value: 'amy' }) },
      respond,
    } as any;
    await handleAutocomplete(i, deps);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith([{ name: 'English (US)', value: 'en_US-amy-medium' }]);
  });

  it('opcao focada NAO e "model": responde [] (ramo nao-model)', async () => {
    const respond = vi.fn();
    const i = {
      options: { getFocused: () => ({ name: 'speed', value: '1.0' }) },
      respond,
    } as any;
    await handleAutocomplete(i, deps);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith([]);
  });

  it('opcao focada e "locale" (/config language): responde com locales filtrados (<=25)', async () => {
    const respond = vi.fn();
    const i = {
      options: { getFocused: () => ({ name: 'locale', value: 'portu' }) },
      respond,
    } as any;
    await handleAutocomplete(i, deps);
    expect(respond).toHaveBeenCalledTimes(1);
    const arg = respond.mock.calls[0][0] as { name: string; value: string }[];
    expect(arg.length).toBeLessThanOrEqual(25);
    expect(arg).toContainEqual({ name: 'Português', value: 'pt' });
  });

  it('opcao focada e "locale" com query vazia: corta a 25 (34 > 25)', async () => {
    const respond = vi.fn();
    const i = {
      options: { getFocused: () => ({ name: 'locale', value: '' }) },
      respond,
    } as any;
    await handleAutocomplete(i, deps);
    const arg = respond.mock.calls[0][0] as unknown[];
    expect(arg.length).toBe(25);
  });
});

describe('/config language — option locale usa autocomplete (34 > 25 choices)', () => {
  it('o option `locale` do /config language e autocomplete e SEM choices estaticas', () => {
    const config = commandDefs.find((c) => c.name === 'config') as any;
    const langSub = config.options.find((o: any) => o.name === 'language');
    expect(langSub, 'subcomando language nao encontrado').toBeDefined();
    const localeOpt = langSub.options.find((o: any) => o.name === 'locale');
    expect(localeOpt, 'option locale nao encontrado').toBeDefined();
    expect(localeOpt.autocomplete).toBe(true);
    // Com autocomplete NAO pode ter choices estaticas (Discord rejeita ambos e o
    // limite de 25 seria excedido pelas 34 linguas).
    expect(localeOpt.choices ?? []).toHaveLength(0);
  });
});
