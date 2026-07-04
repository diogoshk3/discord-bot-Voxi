import { describe, it, expect } from 'vitest';
import { cleanText, collectUrlMedia } from '../src/textCleaning/clean';
import type { CleanOptions } from '../src/textCleaning/clean';

const opts: CleanOptions = {
  maxChars: 200,
  resolveUser: (id: string) => `@user${id}`,
  resolveChannel: (id: string) => `#chan${id}`,
};

describe('cleanText', () => {
  describe('URLs', () => {
    // O URL é REMOVIDO do corpo; o anúncio ("um link"/"um gif") é feito a jusante
    // (localizado na voz) via collectUrlMedia — testado no próprio describe abaixo.
    it('remove http(s) do corpo (nao le o URL cru)', () => {
      expect(cleanText('vai a https://exemplo.com agora', opts)).toBe('vai a agora');
      expect(cleanText('http://a.b/c?x=1', opts)).toBe('');
    });

    it('remove www. do corpo', () => {
      expect(cleanText('ve www.exemplo.com ja', opts)).toBe('ve ja');
    });
  });

  describe('collectUrlMedia — classifica URLs em link/gif p/ anúncio', () => {
    it('URL normal -> [link]', () => {
      expect(collectUrlMedia('vai a https://exemplo.com agora')).toEqual(['link']);
      expect(collectUrlMedia('ve www.exemplo.com ja')).toEqual(['link']);
    });

    it('GIF do Tenor/Giphy -> [gif]', () => {
      expect(collectUrlMedia('olha https://tenor.com/view/cat-gif-12345 lol')).toEqual(['gif']);
      expect(collectUrlMedia('https://giphy.com/gifs/funny-abc123')).toEqual(['gif']);
    });

    it('media .gif direta -> [gif]', () => {
      expect(collectUrlMedia('https://cdn.exemplo.com/animacao.gif')).toEqual(['gif']);
    });

    it('vários URLs -> um item por URL, ordem preservada', () => {
      expect(collectUrlMedia('a https://x.com b https://tenor.com/view/y c')).toEqual([
        'link',
        'gif',
      ]);
    });

    it('sem URL -> []', () => {
      expect(collectUrlMedia('mensagem normal sem links')).toEqual([]);
    });
  });

  describe('mencoes de utilizador', () => {
    it('resolve <@123> via resolveUser', () => {
      expect(cleanText('ola <@123>', opts)).toBe('ola @user123');
    });

    it('resolve <@!123> (nickname) via resolveUser', () => {
      expect(cleanText('ola <@!456>', opts)).toBe('ola @user456');
    });
  });

  describe('mencoes de canal', () => {
    it('resolve <#456> via resolveChannel', () => {
      expect(cleanText('vai a <#789>', opts)).toBe('vai a #chan789');
    });
  });

  describe('mencoes de role', () => {
    it('remove role mention <@&123> (nao a le literalmente)', () => {
      // Antes do fix, <@&123> sobrevivia a todas as fases e era lido como "<@&123>".
      const r = cleanText('atencao <@&123> pessoal', opts);
      expect(r).not.toContain('<@&123>');
      expect(r).not.toContain('123');
      expect(r).toBe('atencao pessoal');
    });
  });

  describe('emojis', () => {
    it('LE o nome do custom emoji <:nome:789>', () => {
      expect(cleanText('boa <:pog:789> festa', opts)).toBe('boa pog festa');
    });

    it('LE o nome do custom emoji animado <a:nome:789>', () => {
      expect(cleanText('boa <a:dance:111> festa', opts)).toBe('boa dance festa');
    });

    it('custom emoji com underscore -> nome com espacos', () => {
      expect(cleanText('<:party_blob:1>', opts)).toBe('party blob');
    });

    it('remove emoji unicode', () => {
      expect(cleanText('ola 😀 mundo 🎉', opts)).toBe('ola mundo');
    });
  });

  describe('code blocks', () => {
    it('remove blocos ```code```', () => {
      expect(cleanText('antes ```const x = 1;``` depois', opts)).toBe('antes depois');
    });

    it('remove blocos ```code``` multilinha', () => {
      expect(cleanText('antes ```\nlinha1\nlinha2\n``` depois', opts)).toBe('antes depois');
    });

    it('remove inline `code`', () => {
      expect(cleanText('usa `npm install` aqui', opts)).toBe('usa aqui');
    });
  });

  describe('colapsar repeticoes', () => {
    it('colapsa minusculas longas a 3 ("aaaaaa" -> "aaa")', () => {
      expect(cleanText('aaaaaa', opts)).toBe('aaa');
    });

    it('colapsa maiusculas a 2 ("WWWW" -> "WW")', () => {
      expect(cleanText('WWWW', opts)).toBe('WW');
    });

    it('nao toca em runs curtos', () => {
      expect(cleanText('aa BB', opts)).toBe('aa BB');
    });
  });

  describe('truncar', () => {
    it('trunca a maxChars', () => {
      const longo = 'abcd'.repeat(13); // 52 chars, sem runs de 3+ chars iguais para nao colapsar
      const r = cleanText(longo, { ...opts, maxChars: 10 });
      expect(r.length).toBe(10);
    });

    it('nao parte surrogate pairs ao truncar (sem lone surrogates)', () => {
      // 𝕏 (U+1D54F) e 2 code units UTF-16 e NAO e Extended_Pictographic,
      // por isso sobrevive a limpeza. Truncar a um limite impar partia o par
      // deixando um surrogate solitario -> lixo para o stdin do Piper.
      const text = 'ab' + '𝕏'.repeat(5); // 'a','b', depois pares de surrogates
      const r = cleanText(text, { ...opts, maxChars: 5 });
      // Nenhum code unit pode ser um surrogate solitario (0xD800-0xDFFF sem par).
      for (let idx = 0; idx < r.length; idx++) {
        const code = r.charCodeAt(idx);
        const isHigh = code >= 0xd800 && code <= 0xdbff;
        const isLow = code >= 0xdc00 && code <= 0xdfff;
        if (isHigh) {
          const next = r.charCodeAt(idx + 1);
          expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
          idx++; // saltar o low surrogate ja validado
        } else {
          expect(isLow).toBe(false); // low surrogate sem high antes = orfao
        }
      }
    });
  });

  describe('emojis com componentes zero-width / bandeiras (ZWJ/VS16/keycap/RI)', () => {
    // O strip de \p{Extended_Pictographic} removia o pictograma base mas deixava
    // os componentes zero-width (U+200D ZWJ, U+FE0F VS16, U+20E3 keycap) e os
    // regional indicators (bandeiras) — resíduo invisível mas TRUTHY que sobrevivia
    // ao trim e passava o guard de vazio. Agora tem de sair também.
    it('coracao ❤️ (U+2764 U+FE0F) -> "" (VS16 removido)', () => {
      expect(cleanText('❤️', opts)).toBe('');
    });

    it('sequencia ZWJ 👨‍💻 -> "" (base + ZWJ removidos, sem residuo)', () => {
      expect(cleanText('👨‍💻', opts)).toBe('');
    });

    it('keycap 1️⃣ -> "1" (VS16+keycap removidos, o DIGITO base sobrevive)', () => {
      expect(cleanText('1️⃣', opts)).toBe('1');
    });

    it('bandeira 🇦🇩 (regional indicators) -> "" (RI removidos)', () => {
      expect(cleanText('🇦🇩', opts)).toBe('');
    });

    it('emoji com componentes no meio de texto -> so o texto sobra', () => {
      expect(cleanText('ola ❤️ mundo', opts)).toBe('ola mundo');
    });
  });

  describe('vazio', () => {
    it('devolve "" se so houver emoji', () => {
      expect(cleanText('😀', opts)).toBe('');
    });

    it('devolve "" se so houver code block', () => {
      expect(cleanText('```apenas codigo```', opts)).toBe('');
    });

    it('devolve "" para string vazia ou so espacos', () => {
      expect(cleanText('   ', opts)).toBe('');
      expect(cleanText('', opts)).toBe('');
    });
  });

  describe('edge-cases: emoji + URL + mencao juntos', () => {
    it('limpa emoji + URL + mencao de user na mesma mensagem', () => {
      // emoji unicode removido, URL removida do corpo, mencao resolvida
      expect(cleanText('😀 https://example.com <@123>', opts)).toBe('@user123');
    });

    it('limpa role + custom emoji + URL na mesma mensagem', () => {
      // role removido, custom emoji LIDO (fire), URL removida do corpo
      expect(
        cleanText('check <@&999> <:fire:123> at https://x.com', opts),
      ).toBe('check fire at');
    });

    it('mensagem so de emojis unicode devolve ""', () => {
      expect(cleanText('😀🎉🔥', opts)).toBe('');
    });
  });

  describe('edge-cases: markdown aninhado', () => {
    it('remove inline code dentro de texto com bold, preservando o bold e o resto do texto', () => {
      // clean.ts nao remove bold/italic; apenas code fences e inline code sao removidos
      expect(cleanText('**negrito com `code` dentro**', opts)).toBe('**negrito com dentro**');
    });

    it('code fence que contem uma mencao: fence e removido, mencao nunca e resolvida', () => {
      // o code block e strippado na fase 1, antes das mencoes na fase 4
      expect(cleanText('antes ```\n<@123>\n``` depois', opts)).toBe('antes depois');
    });
  });

  describe('edge-cases: unicode', () => {
    it('preserva caracteres acentuados latinos (café, açaí)', () => {
      expect(cleanText('café açaí', opts)).toBe('café açaí');
    });

    it('preserva script nao-latino (japonês)', () => {
      expect(cleanText('こんにちは', opts)).toBe('こんにちは');
    });

    it('preserva char astral matematico 𝕏 (U+1D54F) que nao e Extended_Pictographic', () => {
      // 𝕏 ocupa 2 code units UTF-16 mas nao e emoji, logo sobrevive a limpeza
      expect(cleanText('a𝕏b', opts)).toBe('a𝕏b');
    });
  });
});
