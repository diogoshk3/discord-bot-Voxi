export interface CleanOptions {
  maxChars: number;
  resolveUser: (id: string) => string;
  resolveChannel: (id: string) => string;
}

import type { MediaKind } from '../language/spokenPhrases';

const RE_CODE_BLOCK = /```[\s\S]*?```/g;
const RE_INLINE_CODE = /`[^`]*`/g;
// Spoiler do Discord: ||conteudo oculto||. NAO deve ser LIDO (expor o segredo em voz
// alta anula o spoiler) — o conteudo e removido do corpo e anunciado como "spoiler".
const RE_SPOILER = /\|\|[\s\S]*?\|\|/g;
const RE_URL = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi;

// Um URL e um GIF quando: (a) o caminho termina em .gif (media direta), ou (b) o
// host e de um provedor de GIFs (Tenor/Giphy). Os GIFs do picker do Discord chegam
// como link tenor.com no content, por isso esta deteccao cobre o caso dominante.
// Substring simples em vez de match de host exato — para LEITURA em voz alta um
// falso-positivo raro ("evil-tenor.com") e inofensivo, e a simplicidade vale mais.
function isGifUrl(url: string): boolean {
  const s = url.toLowerCase();
  return /\.gif\b/.test(s) || s.includes('tenor.com') || s.includes('giphy.com');
}

/**
 * Recolhe os URLs de `raw` como itens de media a ANUNCIAR (gif vs link), partilhando
 * EXATAMENTE o mesmo RE_URL + isGifUrl que o `cleanText` usa para os REMOVER — assim
 * o que é removido e o que é anunciado nunca dessincronizam. A localização do anúncio
 * ("um link"/"a gif") acontece a jusante (prepareSpeech), quando já se sabe a voz.
 * PURO. Ordem preservada; um item por URL.
 */
export function collectUrlMedia(raw: string): MediaKind[] {
  const matches = raw.match(RE_URL);
  if (!matches) return [];
  return matches.map((u) => (isGifUrl(u) ? 'gif' : 'link'));
}

/**
 * Recolhe SPOILERS e CÓDIGO de `raw` como itens a ANUNCIAR ("spoiler"/"código"), na
 * MESMA ordem de remoção do cleanText (spoiler primeiro, depois blocos e inline code)
 * — por isso código DENTRO de um spoiler não é contado duas vezes. O corpo perde-os
 * (cleanText remove-os); aqui só se anuncia que existiram. A localização é a jusante
 * (prepareSpeech). PURO. Um item por ocorrência.
 */
export function collectMarkdownMedia(raw: string): MediaKind[] {
  const out: MediaKind[] = [];
  const spoilers = raw.match(RE_SPOILER);
  if (spoilers) for (let n = 0; n < spoilers.length; n++) out.push('spoiler');
  // Conta código SÓ no que resta depois de tirar os spoilers (evita dupla-contagem).
  const rest = raw.replace(RE_SPOILER, ' ');
  const blocks = rest.match(RE_CODE_BLOCK)?.length ?? 0;
  const inline = rest.replace(RE_CODE_BLOCK, ' ').match(RE_INLINE_CODE)?.length ?? 0;
  for (let n = 0; n < blocks + inline; n++) out.push('code');
  return out;
}
const RE_ROLE = /<@&\d+>/g;
const RE_USER = /<@!?(\d+)>/g;
const RE_CHANNEL = /<#(\d+)>/g;
const RE_CUSTOM_EMOJI = /<a?:(\w+):\d+>/g;
const RE_UNICODE_EMOJI = /\p{Extended_Pictographic}/gu;
// Componentes zero-width de emoji modernos + regional indicators (bandeiras). O
// strip de \p{Extended_Pictographic} remove o pictograma BASE mas NAO estes:
//   U+200D  ZWJ            (junta as partes de sequencias como 👨‍💻)
//   U+FE0F  VS16           (torna o char anterior "emoji", ex.: ❤️, 1️⃣)
//   U+20E3  keycap combining (o quadrado do 1️⃣)
//   U+1F1E6..U+1F1FF        regional indicators -> \p{Regional_Indicator} (bandeiras)
// Nenhum e \s, por isso sobreviviam ao colapso de whitespace e ao trim, deixando
// residuo invisivel *truthy* que ia parar ao synth. Escrito com \u (nao os chars
// literais, que seriam invisiveis no diff). IMPORTANTE: so componentes/RI — o
// DIGITO/LETRA base fica, por isso "1️⃣" -> "1" (so VS16+keycap sao removidos).
const RE_EMOJI_EXTRA = /[\u200D\uFE0F\u20E3]|\p{Regional_Indicator}/gu;
const RE_REPEAT_LOWER = /([a-z])\1{2,}/g;
const RE_REPEAT_UPPER = /([A-Z])\1{1,}/g;
const RE_WS = /\s+/g;

export function cleanText(raw: string, opts: CleanOptions): string {
  let t = raw;

  // 0. remover SPOILERS (||...||) do corpo — o conteudo oculto NAO e lido; e anunciado
  // como "spoiler" a jusante (collectMarkdownMedia). Antes do code para que um bloco de
  // codigo dentro de um spoiler saia junto (contado como spoiler, nao como codigo).
  t = t.replace(RE_SPOILER, ' ');

  // 1. remover code blocks (fenced primeiro, depois inline)
  t = t.replace(RE_CODE_BLOCK, ' ');
  t = t.replace(RE_INLINE_CODE, ' ');

  // 2. URLs -> REMOVIDAS do corpo (o Diogo nao quer o URL cru falado). O ANÚNCIO
  // ("um link"/"um gif") e feito a jusante, ja localizado na lingua da voz: o
  // messageHandler/`/tts` recolhem os URLs via `collectUrlMedia` (mesmo RE_URL, sem
  // dessync) e passam-nos como media ao prepareSpeech, que os acrescenta no fim.
  t = t.replace(RE_URL, ' ');

  // 3. mencoes de role (sem resolver: removidas para nao serem lidas como "<@&id>")
  t = t.replace(RE_ROLE, ' ');

  // 4. mencoes de user e canal
  t = t.replace(RE_USER, (_m, id: string) => opts.resolveUser(id));
  t = t.replace(RE_CHANNEL, (_m, id: string) => opts.resolveChannel(id));

  // 5. emojis:
  //  - CUSTOM do Discord (<:nome:id> / <a:nome:id>): o Diogo quer que sejam LIDOS,
  //    por isso substitui-se pelo NOME (underscores -> espacos, ex. party_blob ->
  //    "party blob"). Espacos a volta para separar do texto adjacente.
  //  - UNICODE (😀) e os componentes zero-width/bandeiras: REMOVIDOS (o Piper nao
  //    fala emojis unicode; o Diogo pediu so os custom).
  t = t.replace(RE_CUSTOM_EMOJI, (_m, name: string) => ` ${name.replace(/_/g, ' ')} `);
  t = t.replace(RE_UNICODE_EMOJI, ' ');
  t = t.replace(RE_EMOJI_EXTRA, '');

  // 6. colapsar repeticoes (minusculas cap 3, maiusculas cap 2)
  t = t.replace(RE_REPEAT_LOWER, '$1$1$1');
  t = t.replace(RE_REPEAT_UPPER, '$1$1');

  // 7. colapsar whitespace + trim
  t = t.replace(RE_WS, ' ').trim();

  // 8. truncar (sem partir surrogate pairs: se o ultimo code unit ficar
  // um high surrogate orfao, recua um para nao emitir lixo ao Piper)
  if (t.length > opts.maxChars) {
    let end = opts.maxChars;
    const last = t.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
      end -= 1;
    }
    t = t.slice(0, end);
  }

  // 9. vazio -> ''
  return t;
}
