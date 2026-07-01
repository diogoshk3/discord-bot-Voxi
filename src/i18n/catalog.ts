/**
 * Catalogo de traducoes da INTERFACE (texto), keyed por chave estavel.
 *
 * Contrato:
 *  - `en` e a FONTE DE VERDADE (base/default). Toda a chave TEM de ter `en`.
 *  - `pt` e OPCIONAL/parcial: quando falta, o t() faz fallback para `en`.
 *  - As chaves sao strings estaveis (ex. 'help.title'); os valores podem conter
 *    placeholders `{param}` interpolados por t().
 *
 * NB: isto cobre so o texto da INTERFACE. O idioma da VOZ/TTS e independente e
 * NAO se toca aqui.
 *
 * P16.1 (este item): chrome do /help. As descricoes dos comandos ficam inline
 * (em ingles) nos builders. As restantes respostas/erros/embeds sao P16.2 e
 * ainda NAO estao aqui.
 */

export interface Entry {
  /** Ingles — obrigatorio (fonte de verdade). */
  en: string;
  /** Portugues — opcional (fallback para `en` quando ausente). */
  pt?: string;
}

export const catalog: Record<string, Entry> = {
  // ── /help chrome (tudo o que NAO e a lista de comandos, que vem de commandDefs) ──
  'help.title': {
    en: '**Voxi — type it, hear it.**',
    // Sem `pt`: a marca/tagline e a mesma em qualquer idioma (fallback a en).
  },
  'help.intro': {
    en: "Here are the bot's commands.",
    pt: 'Aqui ficam os comandos do bot.',
  },
  'help.groupGeneral': {
    en: 'General',
    pt: 'Geral',
  },
  'help.groupVoice': {
    en: 'Voice (per user)',
    pt: 'Voz (por utilizador)',
  },
  'help.groupAdmin': {
    en: 'Admin (needs Manage Server)',
    pt: 'Admin (precisa de Gerir Servidor)',
  },
  'help.subcommands': {
    en: 'subcommands',
    pt: 'subcomandos',
  },
  'help.configNote': {
    en: '   (/config has several subcommands — use /config show to see the current config)',
    pt: '   (/config tem varios subcomandos — usa /config show para veres a config atual)',
  },
  'help.footer': {
    en: 'Recommended first step: run {command} on your server.',
    pt: 'Primeiro passo recomendado: corre {command} no teu servidor.',
  },
};
