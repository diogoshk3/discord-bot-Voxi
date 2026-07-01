import { describe, it, expect } from 'vitest';
import { expandAbbreviations } from '../src/textCleaning/abbreviations';

describe('expandAbbreviations', () => {
  // ── EN ────────────────────────────────────────────────────────────────────
  it('expande abreviaturas EN comuns', () => {
    expect(expandAbbreviations('btw isto acabou', 'eng')).toBe('by the way isto acabou');
    expect(expandAbbreviations('idk what to do', 'eng')).toBe("I don't know what to do");
    expect(expandAbbreviations('imo this is fine', 'eng')).toBe('in my opinion this is fine');
    expect(expandAbbreviations('come asap please', 'eng')).toBe('come as soon as possible please');
  });

  // ── PT ────────────────────────────────────────────────────────────────────
  it('expande abreviaturas PT comuns', () => {
    expect(expandAbbreviations('vc viste isto', 'por')).toBe('você viste isto');
    expect(expandAbbreviations('pq fizeste isso', 'por')).toBe('porque fizeste isso');
    expect(expandAbbreviations('eu tbm acho', 'por')).toBe('eu também acho');
    expect(expandAbbreviations('obg pela ajuda', 'por')).toBe('obrigado pela ajuda');
  });

  // ── case-insensitive ──────────────────────────────────────────────────────
  it('e case-insensitive no match', () => {
    expect(expandAbbreviations('BTW algo', 'eng')).toBe('By the way algo');
    expect(expandAbbreviations('Btw algo', 'eng')).toBe('By the way algo');
  });

  // ── preservacao de capitalizacao ──────────────────────────────────────────
  it('capitaliza a 1.a letra da expansao quando o token comeca por maiuscula', () => {
    // token capitalizado -> expansao capitalizada
    expect(expandAbbreviations('Btw isto', 'eng')).toBe('By the way isto');
    // token em minusculas -> expansao tal e qual
    expect(expandAbbreviations('btw isto', 'eng')).toBe('by the way isto');
    // token tudo-maiusculas tambem capitaliza so a 1.a letra (regra unica)
    expect(expandAbbreviations('BTW isto', 'eng')).toBe('By the way isto');
  });

  it('a expansao que ja comeca por maiuscula mantem-se (idempotente)', () => {
    // 'idk' -> "I don't know" comeca por 'I' (maiuscula) em qualquer caso do token
    expect(expandAbbreviations('idk', 'eng')).toBe("I don't know");
    expect(expandAbbreviations('Idk', 'eng')).toBe("I don't know");
    expect(expandAbbreviations('IDK', 'eng')).toBe("I don't know");
  });

  // ── fronteira de palavra ──────────────────────────────────────────────────
  it('so expande em fronteira de palavra (nao dentro de palavras)', () => {
    expect(expandAbbreviations('btwx', 'eng')).toBe('btwx');
    expect(expandAbbreviations('xbtw', 'eng')).toBe('xbtw');
    expect(expandAbbreviations('vcs', 'por')).toBe('vocês'); // 'vcs' e um token proprio
    expect(expandAbbreviations('avc', 'por')).toBe('avc'); // 'vc' dentro de palavra -> intacto
  });

  // ── pontuacao adjacente ───────────────────────────────────────────────────
  it('preserva pontuacao a volta do token', () => {
    expect(expandAbbreviations('foste tu, vc, certo?', 'por')).toBe('foste tu, você, certo?');
    expect(expandAbbreviations('pq.', 'por')).toBe('porque.');
    expect(expandAbbreviations('(btw)', 'eng')).toBe('(by the way)');
  });

  // ── multiplas no mesmo texto ──────────────────────────────────────────────
  it('expande multiplas abreviaturas diferentes', () => {
    expect(expandAbbreviations('vc e tb eu, pq sim', 'por')).toBe(
      'você e também eu, porque sim',
    );
    expect(expandAbbreviations('idk tbh', 'eng')).toBe("I don't know to be honest");
  });

  // ── adjacentes (fronteira zero-width) ─────────────────────────────────────
  it('expande abreviaturas adjacentes (ambas)', () => {
    expect(expandAbbreviations('btw btw', 'eng')).toBe('by the way by the way');
    expect(expandAbbreviations('vc vc', 'por')).toBe('você você');
  });

  // ── lingua desconhecida / vazia -> inalterado ─────────────────────────────
  it('lingua desconhecida/vazia/und -> texto inalterado', () => {
    expect(expandAbbreviations('btw vc pq', '')).toBe('btw vc pq');
    expect(expandAbbreviations('btw vc pq', 'und')).toBe('btw vc pq');
    // 'jpn' NAO tem dict -> caminho no-op verdadeiro (sem dict registado).
    expect(expandAbbreviations('btw vc pq', 'jpn')).toBe('btw vc pq');
    // fra/deu AGORA tem dict, mas 'btw'/'vc'/'pq' NAO sao chaves nesses dicts
    // -> dupla funcao: garante que o dict certo e escolhido E que nao ha colisao
    // cruzada com chaves EN/PT.
    expect(expandAbbreviations('btw vc pq', 'fra')).toBe('btw vc pq');
    expect(expandAbbreviations('btw vc pq', 'deu')).toBe('btw vc pq');
  });

  // ── nao cruza linguas ─────────────────────────────────────────────────────
  it('nao aplica dicionario PT a texto marcado como EN (e vice-versa)', () => {
    // 'vc' so existe no dicionario PT -> com lang 'eng' fica intacto
    expect(expandAbbreviations('vc', 'eng')).toBe('vc');
    // 'btw' so existe no dicionario EN -> com lang 'por' fica intacto
    expect(expandAbbreviations('btw', 'por')).toBe('btw');
  });

  // ── texto vazio -> vazio ──────────────────────────────────────────────────
  it('texto vazio -> vazio', () => {
    expect(expandAbbreviations('', 'eng')).toBe('');
    expect(expandAbbreviations('', 'por')).toBe('');
  });

  // ── determinismo / pureza ─────────────────────────────────────────────────
  it('e deterministico para o mesmo input', () => {
    const out1 = expandAbbreviations('vc tb pq vc', 'por');
    const out2 = expandAbbreviations('vc tb pq vc', 'por');
    expect(out1).toBe(out2);
    expect(out1).toBe('você também porque você');
  });

  // ── nao toca em palavras normais ──────────────────────────────────────────
  it('nao expande palavras normais que contem um token como substring', () => {
    // 'np' -> 'no problem', mas 'snap' nao deve mudar
    expect(expandAbbreviations('snap', 'eng')).toBe('snap');
    // 'ty' -> 'thank you', mas 'tyrano' (inventado) nao muda
    expect(expandAbbreviations('typical', 'eng')).toBe('typical');
  });

  // ══ P17: novos dicionarios por lingua ═════════════════════════════════════
  // Por cada lingua: (1) expansao correta, (2) NAO-colisao (frase normal —
  // sobretudo as palavras que EXCLUIMOS — passa inalterada), (3) fronteira.

  // ── DE ────────────────────────────────────────────────────────────────────
  it('DE: expande + nao colide + fronteira', () => {
    expect(expandAbbreviations('vllt komme ich', 'deu')).toBe('vielleicht komme ich');
    expect(expandAbbreviations('mfg', 'deu')).toBe('mit freundlichen Grüßen');
    expect(expandAbbreviations('ka was das ist', 'deu')).toBe('keine Ahnung was das ist');
    // NAO-colisao: palavras normais que ficaram DE FORA (da/so/am/im) intactas.
    expect(expandAbbreviations('da war so am Rand im Haus', 'deu')).toBe(
      'da war so am Rand im Haus',
    );
    // fronteira: 'ka' dentro de palavra ("Karte") nao expande.
    expect(expandAbbreviations('Karte', 'deu')).toBe('Karte');
  });

  // ── FR ────────────────────────────────────────────────────────────────────
  it('FR: expande + nao colide + fronteira', () => {
    expect(expandAbbreviations('mdr trop drôle', 'fra')).toBe('mort de rire trop drôle');
    expect(expandAbbreviations('stp aide-moi', 'fra')).toBe("s'il te plaît aide-moi");
    expect(expandAbbreviations('pk tu fais ça', 'fra')).toBe('pourquoi tu fais ça');
    // NAO-colisao: car/or/ou/on/ma/si — palavras normais excluidas — intactas.
    expect(expandAbbreviations('car il a ou on ma si', 'fra')).toBe('car il a ou on ma si');
    // fronteira: 'pk' dentro de token maior nao expande.
    expect(expandAbbreviations('pkoi', 'fra')).toBe('pkoi');
  });

  // ── ES ────────────────────────────────────────────────────────────────────
  it('ES: expande + nao colide + fronteira', () => {
    expect(expandAbbreviations('pq no vienes', 'spa')).toBe('porque no vienes');
    expect(expandAbbreviations('porfa ven', 'spa')).toBe('por favor ven');
    expect(expandAbbreviations('nos vemos el finde', 'spa')).toBe(
      'nos vemos el fin de semana',
    );
    // NAO-colisao: frase normal sem chaves.
    expect(expandAbbreviations('el sol brilla todo el dia', 'spa')).toBe(
      'el sol brilla todo el dia',
    );
    // fronteira: 'tb' dentro de palavra nao expande.
    expect(expandAbbreviations('estable', 'spa')).toBe('estable');
  });

  // ── IT ────────────────────────────────────────────────────────────────────
  it('IT: expande + nao colide + fronteira', () => {
    expect(expandAbbreviations('cmq va bene', 'ita')).toBe('comunque va bene');
    expect(expandAbbreviations('nn lo so', 'ita')).toBe('non lo so');
    expect(expandAbbreviations('tvb amico', 'ita')).toBe('ti voglio bene amico');
    // NAO-colisao: ho/da/se/sa/te — palavras normais excluidas — intactas.
    expect(expandAbbreviations('ho da se sa te', 'ita')).toBe('ho da se sa te');
    // fronteira: 'nn' dentro de palavra ("anno") nao expande.
    expect(expandAbbreviations('anno', 'ita')).toBe('anno');
  });

  // ── NL ────────────────────────────────────────────────────────────────────
  it('NL: expande + nao colide + fronteira', () => {
    expect(expandAbbreviations('idd goed idee', 'nld')).toBe('inderdaad goed idee');
    expect(expandAbbreviations('doe ff rustig', 'nld')).toBe('doe even rustig');
    expect(expandAbbreviations('wrm niet', 'nld')).toBe('waarom niet');
    // NAO-colisao: en/je/ik/me/we — palavras normais excluidas — intactas.
    expect(expandAbbreviations('en je ik me we', 'nld')).toBe('en je ik me we');
    // fronteira: 'ff' dentro de palavra ("offer") nao expande.
    expect(expandAbbreviations('offer', 'nld')).toBe('offer');
  });

  // ── RU (cirilico) ─────────────────────────────────────────────────────────
  it('RU: expande + nao colide + fronteira (cirilico)', () => {
    expect(expandAbbreviations('спс большое', 'rus')).toBe('спасибо большое');
    expect(expandAbbreviations('прив как дела', 'rus')).toBe('привет как дела');
    expect(expandAbbreviations('оч красиво', 'rus')).toBe('очень красиво');
    // NAO-colisao: frase normal sem chaves.
    expect(expandAbbreviations('я не знаю что делать', 'rus')).toBe(
      'я не знаю что делать',
    );
    // fronteira: 'спс' dentro de palavra maior nao expande.
    expect(expandAbbreviations('спсхх', 'rus')).toBe('спсхх');
  });

  // ── PL ────────────────────────────────────────────────────────────────────
  it('PL: expande + nao colide + fronteira', () => {
    expect(expandAbbreviations('nwm co robić', 'pol')).toBe('nie wiem co robić');
    expect(expandAbbreviations('nara', 'pol')).toBe('na razie');
    expect(expandAbbreviations('pzdr', 'pol')).toBe('pozdrawiam');
    // NAO-colisao: frase normal sem chaves.
    expect(expandAbbreviations('nie wiem co dzisiaj robić', 'pol')).toBe(
      'nie wiem co dzisiaj robić',
    );
    // fronteira: 'nwm' dentro de palavra nao expande.
    expect(expandAbbreviations('nwmx', 'pol')).toBe('nwmx');
  });

  // ── TR (caracteres turcos) ────────────────────────────────────────────────
  it('TR: expande + nao colide + fronteira', () => {
    expect(expandAbbreviations('slm dostum', 'tur')).toBe('selam dostum');
    expect(expandAbbreviations('nbr', 'tur')).toBe('ne haber');
    expect(expandAbbreviations('tşk ederim', 'tur')).toBe('teşekkürler ederim');
    // NAO-colisao: palavras normais TR intactas.
    expect(expandAbbreviations('sen ben onu bugün', 'tur')).toBe('sen ben onu bugün');
    // fronteira: 'slm' dentro de palavra nao expande.
    expect(expandAbbreviations('slmx', 'tur')).toBe('slmx');
  });

  // ── UK vazio (no-op de proposito) ─────────────────────────────────────────
  it('UK: dict vazio -> texto inalterado (curadoria conservadora)', () => {
    expect(expandAbbreviations('я не знаю що робити', 'ukr')).toBe('я не знаю що робити');
    // 'дяки' foi EXCLUIDO (colide com plural de 'дяк') -> passa inalterado.
    expect(expandAbbreviations('дяки тобі', 'ukr')).toBe('дяки тобі');
  });

  // ── EN/PT refino: novas chaves + nao-colisao ──────────────────────────────
  it('EN refino: novas chaves expandem e nao colidem', () => {
    expect(expandAbbreviations('afaik isto e assim', 'eng')).toBe(
      'as far as I know isto e assim',
    );
    expect(expandAbbreviations('pls help', 'eng')).toBe('please help');
    expect(expandAbbreviations('thx a lot', 'eng')).toBe('thanks a lot');
    // 'ppl' -> 'people', mas 'apple' nao muda (fronteira/substring).
    expect(expandAbbreviations('apple', 'eng')).toBe('apple');
  });

  it('PT refino: novas chaves expandem e nao colidem', () => {
    expect(expandAbbreviations('bjs para todos', 'por')).toBe('beijos para todos');
    expect(expandAbbreviations('vemo-nos no fds', 'por')).toBe('vemo-nos no fim de semana');
    // 'abs' -> 'abraços', mas 'absurdo' nao muda (fronteira).
    expect(expandAbbreviations('absurdo', 'por')).toBe('absurdo');
    // 'agr' -> 'agora', mas 'agradecer' nao muda (fronteira).
    expect(expandAbbreviations('agradecer', 'por')).toBe('agradecer');
  });
});
