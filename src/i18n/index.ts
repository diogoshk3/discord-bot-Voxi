import { catalog } from './catalog';
import { locales } from './locales/index';

/**
 * i18n — traducao PURA do texto da INTERFACE.
 *
 * `en` e a base/default; `pt` e a primeira lingua adicional. O idioma da
 * VOZ/TTS e independente e NAO passa por aqui.
 */

export const DEFAULT_LOCALE = 'en' as const;
/**
 * Linguas da INTERFACE suportadas: as MESMAS 34 linguas de voz do Voxi. Em Fase A
 * so `en`/`pt` estao realmente traduzidas (inline no catalogo); as outras 32 estao
 * na lista mas caem no fallback `en` via t() ate um ficheiro `locales/<code>.ts`
 * ser adicionado (Fase B). Como sao 34 (> 25, o cap de choices estaticas do
 * Discord), o `/config language` usa AUTOCOMPLETE em vez de choices.
 */
export const SUPPORTED_LOCALES = [
  'en', 'pt', 'es', 'fr', 'de', 'nl', 'pl', 'tr', 'cs', 'sv', 'fi', 'da',
  'ro', 'hu', 'cy', 'is', 'lb', 'lv', 'sk', 'sl', 'sw', 'vi', 'ca', 'it',
  'el', 'ru', 'uk', 'kk', 'sr', 'ar', 'fa', 'ka', 'ne', 'zh',
] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Nome legivel de cada locale, na PROPRIA lingua (endonimo). Usado no autocomplete
 * do `/config language` e na confirmacao. Tipado como `Record<SupportedLocale,
 * string>` (a uniao finita, nao `Record<string, string>`): assim, adicionar um
 * locale a `SUPPORTED_LOCALES` sem lhe dar um nome aqui e um ERRO de compilacao — o
 * mapa nunca fica dessincronizado do array em silencio.
 */
export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  pt: 'Português',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  nl: 'Nederlands',
  pl: 'Polski',
  tr: 'Türkçe',
  cs: 'Čeština',
  sv: 'Svenska',
  fi: 'Suomi',
  da: 'Dansk',
  ro: 'Română',
  hu: 'Magyar',
  cy: 'Cymraeg',
  is: 'Íslenska',
  lb: 'Lëtzebuergesch',
  lv: 'Latviešu',
  sk: 'Slovenčina',
  sl: 'Slovenščina',
  sw: 'Kiswahili',
  vi: 'Tiếng Việt',
  ca: 'Català',
  it: 'Italiano',
  el: 'Ελληνικά',
  ru: 'Русский',
  uk: 'Українська',
  kk: 'Қазақша',
  sr: 'Српски',
  ar: 'العربية',
  fa: 'فارسی',
  ka: 'ქართული',
  ne: 'नेपाली',
  zh: '中文',
};

/**
 * Interpola placeholders `{param}` numa string. Params ausentes ficam intactos
 * (nao rebenta): so substitui as chaves fornecidas.
 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Traduz `key` no `locale` pedido.
 *
 * Regra de resolucao (nunca crasha):
 *   1. traducao no ficheiro POR-LOCALE do registry (`locales/<locale>.ts`), se
 *      existir a lingua E a chave la (Fase B: cada lingua nova cai aqui);
 *   2. senao, valor inline no catalogo para o `locale` pedido (en/pt);
 *   3. senao, fallback para `en` (base/fonte de verdade);
 *   4. senao (chave inexistente no catalogo), devolve a propria `key`.
 * Depois interpola os `{param}`.
 *
 * `locale` nao suportado (ou suportado mas ainda sem traducao) comporta-se como
 * ausente -> cai no fallback `en`.
 */
export function t(
  key: string,
  locale: string,
  params?: Record<string, string | number>,
): string {
  const entry = catalog[key];
  if (!entry) return key;
  // (1) Registry por-locale: um ficheiro locales/<locale>.ts pode sobrepor a chave.
  const fromRegistry = locales[locale]?.[key];
  // (2) Valor inline no catalogo (en/pt) para o locale pedido.
  const byLocale = entry as unknown as Record<string, string | undefined>;
  const inline = locale in entry ? byLocale[locale] : undefined;
  // (3) Fallback a `en`; (4) por fim a propria key.
  const value = fromRegistry ?? inline ?? entry.en ?? key;
  return interpolate(value, params);
}
