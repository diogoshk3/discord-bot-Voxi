import { describe, it, expect } from 'vitest';
import { expandAbbreviations, isAllEnglishAbbrev } from '../src/textCleaning/abbreviations';

describe('expandAbbreviations', () => {
  // ── EN: girias inglesas expandem (sem argumento de lingua) ─────────────────
  it('expande abreviaturas EN comuns', () => {
    expect(expandAbbreviations('btw isto acabou')).toBe('by the way isto acabou');
    expect(expandAbbreviations('idk what to do')).toBe("I don't know what to do");
    expect(expandAbbreviations('imo this is fine')).toBe('in my opinion this is fine');
    expect(expandAbbreviations('come asap please')).toBe('come as soon as possible please');
  });

  // ── aplicadas em QUALQUER lingua ───────────────────────────────────────────
  // O ponto do novo contrato: as girias EN aplicam-se independentemente da lingua
  // do texto envolvente (nao ha mais deteccao de lingua neste passo).
  it('expande girias EN mesmo em texto de outra lingua', () => {
    // 'btw' no meio de uma frase claramente PT expande na mesma.
    expect(expandAbbreviations('btw isto foi ontem à noite no servidor')).toBe(
      'by the way isto foi ontem à noite no servidor',
    );
    // Frase EN-em-francês: 'brb' expande.
    expect(expandAbbreviations('je reviens brb')).toBe('je reviens be right back');
  });

  // ── abreviaturas NAO-inglesas ja NAO expandem (por design) ─────────────────
  it('nao expande abreviaturas nao-inglesas (pt/es/fr/de/…)', () => {
    // Antigas chaves PT: 'vc'/'pq'/'tb'/'obg' — deixaram de existir.
    expect(expandAbbreviations('vc viste isto')).toBe('vc viste isto');
    expect(expandAbbreviations('pq fizeste isso')).toBe('pq fizeste isso');
    expect(expandAbbreviations('eu tbm acho')).toBe('eu tbm acho');
    expect(expandAbbreviations('obg pela ajuda')).toBe('obg pela ajuda');
    // FR/DE/ES/IT/NL exemplos das antigas chaves — todas inalteradas agora.
    expect(expandAbbreviations('mdr trop drôle')).toBe('mdr trop drôle');
    expect(expandAbbreviations('vllt komme ich')).toBe('vllt komme ich');
    expect(expandAbbreviations('porfa ven')).toBe('porfa ven');
    expect(expandAbbreviations('cmq va bene')).toBe('cmq va bene');
    expect(expandAbbreviations('idd goed idee')).toBe('idd goed idee');
  });

  // ── colisao cruzada: tokens dropados NAO expandem ──────────────────────────
  // 'ty' = "you" em polaco, 'np' = "na przykład" (e.g.) em polaco -> DROPADOS.
  it("nao expande 'ty' nem 'np' (colisao com palavras polacas)", () => {
    expect(expandAbbreviations('ty')).toBe('ty');
    expect(expandAbbreviations('np')).toBe('np');
    expect(expandAbbreviations('ty i np')).toBe('ty i np');
    // Mesmo capitalizados / no meio de frase, ficam intactos.
    expect(expandAbbreviations('Ty jesteś tutaj')).toBe('Ty jesteś tutaj');
    expect(expandAbbreviations('to jest np dobre')).toBe('to jest np dobre');
  });

  // ── case-insensitive ──────────────────────────────────────────────────────
  it('e case-insensitive no match', () => {
    expect(expandAbbreviations('BTW algo')).toBe('By the way algo');
    expect(expandAbbreviations('Btw algo')).toBe('By the way algo');
  });

  // ── preservacao de capitalizacao ──────────────────────────────────────────
  it('capitaliza a 1.a letra da expansao quando o token comeca por maiuscula', () => {
    expect(expandAbbreviations('Btw isto')).toBe('By the way isto');
    expect(expandAbbreviations('btw isto')).toBe('by the way isto');
    expect(expandAbbreviations('BTW isto')).toBe('By the way isto');
  });

  it('a expansao que ja comeca por maiuscula mantem-se (idempotente)', () => {
    expect(expandAbbreviations('idk')).toBe("I don't know");
    expect(expandAbbreviations('Idk')).toBe("I don't know");
    expect(expandAbbreviations('IDK')).toBe("I don't know");
  });

  // ── fronteira de palavra ──────────────────────────────────────────────────
  it('so expande em fronteira de palavra (nao dentro de palavras)', () => {
    expect(expandAbbreviations('btwx')).toBe('btwx');
    expect(expandAbbreviations('xbtw')).toBe('xbtw');
    // 'ppl' e um token; 'apple' contem-no como substring mas nao expande.
    expect(expandAbbreviations('apple')).toBe('apple');
  });

  // ── pontuacao adjacente ───────────────────────────────────────────────────
  it('preserva pontuacao a volta do token', () => {
    expect(expandAbbreviations('(btw)')).toBe('(by the way)');
    expect(expandAbbreviations('brb...')).toBe('be right back...');
  });

  // ── multiplas no mesmo texto ──────────────────────────────────────────────
  it('expande multiplas abreviaturas diferentes', () => {
    expect(expandAbbreviations('idk tbh')).toBe("I don't know to be honest");
    expect(expandAbbreviations('omg brb')).toBe('oh my god be right back');
  });

  // ── adjacentes (fronteira zero-width) ─────────────────────────────────────
  it('expande abreviaturas adjacentes (ambas)', () => {
    expect(expandAbbreviations('btw btw')).toBe('by the way by the way');
  });

  // ── texto vazio -> vazio ──────────────────────────────────────────────────
  it('texto vazio -> vazio', () => {
    expect(expandAbbreviations('')).toBe('');
  });

  // ── determinismo / pureza ─────────────────────────────────────────────────
  it('e deterministico para o mesmo input', () => {
    const out1 = expandAbbreviations('btw idk tbh brb');
    const out2 = expandAbbreviations('btw idk tbh brb');
    expect(out1).toBe(out2);
    expect(out1).toBe("by the way I don't know to be honest be right back");
  });

  // ── nao toca em palavras normais ──────────────────────────────────────────
  it('nao expande palavras normais que contem um token como substring', () => {
    expect(expandAbbreviations('snap')).toBe('snap');
    expect(expandAbbreviations('typical')).toBe('typical');
  });

  // ── EN refino: chaves adicionadas em P17 ──────────────────────────────────
  it('EN refino: novas chaves expandem e nao colidem', () => {
    expect(expandAbbreviations('afaik isto e assim')).toBe('as far as I know isto e assim');
    expect(expandAbbreviations('pls help')).toBe('please help');
    expect(expandAbbreviations('thx a lot')).toBe('thanks a lot');
  });
});

// ── OPTIONAL STRETCH: isAllEnglishAbbrev ─────────────────────────────────────
describe('isAllEnglishAbbrev', () => {
  it('true quando TODOS os tokens sao girias EN conhecidas', () => {
    expect(isAllEnglishAbbrev('brb')).toBe(true);
    expect(isAllEnglishAbbrev('omg lol')).toBe(false); // 'lol' nao e chave -> false
    expect(isAllEnglishAbbrev('brb omg')).toBe(true);
    expect(isAllEnglishAbbrev('BRB OMG')).toBe(true); // case-insensitive
  });

  it('false quando ha pelo menos um token nao-giria', () => {
    expect(isAllEnglishAbbrev('brb amigo')).toBe(false);
    expect(isAllEnglishAbbrev('ola omg')).toBe(false);
  });

  it('false para texto vazio / so espacos (nada a forcar)', () => {
    expect(isAllEnglishAbbrev('')).toBe(false);
    expect(isAllEnglishAbbrev('   ')).toBe(false);
  });

  it('tokens dropados (ty, np) nao contam como girias EN', () => {
    expect(isAllEnglishAbbrev('ty')).toBe(false);
    expect(isAllEnglishAbbrev('brb np')).toBe(false);
  });

  // ── pontuacao a volta do token: tem de ser IGNORADA ─────────────────────────
  // O `expandAbbreviations` JA expande "omg!"/"wyd?"/"brb..." (a fronteira trata a
  // pontuacao como limite). Sem strip, o isAllEnglishAbbrev falhava a lookup do
  // token cru e devolvia false — derrotando o forceLang='eng' na forma MAIS natural
  // de escrever giria (com !/?/...). Espelhamos a semantica de fronteira.
  it('ignora pontuacao a volta do token (omg! wyd? brb...)', () => {
    expect(isAllEnglishAbbrev('omg!')).toBe(true);
    expect(isAllEnglishAbbrev('wyd?')).toBe(true);
    expect(isAllEnglishAbbrev('brb...')).toBe(true);
    expect(isAllEnglishAbbrev('OMG! BRB')).toBe(true);
  });

  it('token que reduz a vazio (so pontuacao) -> false', () => {
    expect(isAllEnglishAbbrev('!!!')).toBe(false);
  });

  it('misto giria+palavra normal (mesmo com pontuacao) -> false', () => {
    expect(isAllEnglishAbbrev('omg carro')).toBe(false);
  });
});
