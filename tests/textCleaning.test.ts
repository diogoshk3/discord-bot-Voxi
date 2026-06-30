import { describe, it, expect } from 'vitest';
import { cleanText } from '../src/textCleaning/clean';
import type { CleanOptions } from '../src/textCleaning/clean';

const opts: CleanOptions = {
  maxChars: 200,
  resolveUser: (id: string) => `@user${id}`,
  resolveChannel: (id: string) => `#chan${id}`,
};

describe('cleanText', () => {
  describe('URLs', () => {
    it('substitui http(s) por "link"', () => {
      expect(cleanText('vai a https://exemplo.com agora', opts)).toBe('vai a link agora');
      expect(cleanText('http://a.b/c?x=1', opts)).toBe('link');
    });

    it('substitui www. por "link"', () => {
      expect(cleanText('ve www.exemplo.com ja', opts)).toBe('ve link ja');
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
    it('remove custom emoji <:nome:789>', () => {
      expect(cleanText('boa <:pog:789> festa', opts)).toBe('boa festa');
    });

    it('remove custom emoji animado <a:nome:789>', () => {
      expect(cleanText('boa <a:dance:111> festa', opts)).toBe('boa festa');
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
});
