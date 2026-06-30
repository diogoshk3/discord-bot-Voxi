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

  // 5. emojis: custom e unicode
  t = t.replace(RE_CUSTOM_EMOJI, ' ');
  t = t.replace(RE_UNICODE_EMOJI, ' ');

  // 6. colapsar repeticoes (minusculas cap 3, maiusculas cap 2)
  t = t.replace(RE_REPEAT_LOWER, '$1$1$1');
  t = t.replace(RE_REPEAT_UPPER, '$1$1');

  // 7. colapsar whitespace + trim
  t = t.replace(RE_WS, ' ').trim();

  // 8. truncar
  if (t.length > opts.maxChars) {
    t = t.slice(0, opts.maxChars);
  }

  // 9. vazio -> ''
  return t;
}
