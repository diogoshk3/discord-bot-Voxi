export interface CleanOptions {
  maxChars: number;
  resolveUser: (id: string) => string;
  resolveChannel: (id: string) => string;
}

const RE_CODE_BLOCK = /```[\s\S]*?```/g;
const RE_INLINE_CODE = /`[^`]*`/g;
const RE_URL = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi;
const RE_ROLE = /<@&\d+>/g;
const RE_USER = /<@!?(\d+)>/g;
const RE_CHANNEL = /<#(\d+)>/g;
const RE_CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
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

  // 1. remover code blocks (fenced primeiro, depois inline)
  t = t.replace(RE_CODE_BLOCK, ' ');
  t = t.replace(RE_INLINE_CODE, ' ');

  // 2. URLs -> "link"
  t = t.replace(RE_URL, 'link');

  // 3. mencoes de role (sem resolver: removidas para nao serem lidas como "<@&id>")
  t = t.replace(RE_ROLE, ' ');

  // 4. mencoes de user e canal
  t = t.replace(RE_USER, (_m, id: string) => opts.resolveUser(id));
  t = t.replace(RE_CHANNEL, (_m, id: string) => opts.resolveChannel(id));

  // 5. emojis: custom, unicode base, e os componentes zero-width/bandeiras que o
  // strip de \p{Extended_Pictographic} deixava para tras.
  t = t.replace(RE_CUSTOM_EMOJI, ' ');
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
