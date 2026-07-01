import { catalog } from './catalog';

/**
 * i18n — traducao PURA do texto da INTERFACE.
 *
 * `en` e a base/default; `pt` e a primeira lingua adicional. O idioma da
 * VOZ/TTS e independente e NAO passa por aqui.
 */

export const DEFAULT_LOCALE = 'en' as const;
export const SUPPORTED_LOCALES = ['en', 'pt'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Nome legivel de cada locale, na PROPRIA lingua (endonimo). Usado nas CHOICES do
 * `/config language` e na confirmacao. Tipado como `Record<SupportedLocale, string>`
 * (a uniao finita, nao `Record<string, string>`): assim, adicionar um locale a
 * `SUPPORTED_LOCALES` sem lhe dar um nome aqui e um ERRO de compilacao — o mapa
 * nunca fica dessincronizado do array em silencio.
 */
export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  pt: 'Português',
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
 *   1. valor no `locale` pedido (se existir e for suportado);
 *   2. senao, fallback para `en` (base/fonte de verdade);
 *   3. senao (chave inexistente no catalogo), devolve a propria `key`.
 * Depois interpola os `{param}`.
 *
 * `locale` nao suportado comporta-se como ausente -> cai no fallback `en`.
 */
export function t(
  key: string,
  locale: string,
  params?: Record<string, string | number>,
): string {
  const entry = catalog[key];
  if (!entry) return key;
  // Fallback chain: locale pedido (so se for uma chave presente no entry) -> en.
  const byLocale = entry as unknown as Record<string, string | undefined>;
  const value = (locale in entry ? byLocale[locale] : undefined) ?? entry.en ?? key;
  return interpolate(value, params);
}
