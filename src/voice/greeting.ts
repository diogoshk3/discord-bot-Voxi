import type { SynthRequest } from '../tts/engine';

/**
 * Saudação "Olá {name}" por lingua-base, para o Voxi dizer quando alguém ENTRA na call.
 * A principal é sempre o inglês ('en'); as outras são escolhíveis em /config
 * greet-language. `{name}` é substituído pelo nome (já sanitizado) de quem entra; sem
 * nome, o {name} sai vazio e fica só a saudação ("Hello"). Fallback: lingua sem entrada
 * aqui cai no inglês.
 */
export const GREETINGS: Record<string, string> = {
  en: 'Hello {name}',
  pt: 'Olá {name}',
  es: 'Hola {name}',
  fr: 'Bonjour {name}',
  de: 'Hallo {name}',
  it: 'Ciao {name}',
  nl: 'Hallo {name}',
  sv: 'Hej {name}',
  da: 'Hej {name}',
  fi: 'Hei {name}',
  pl: 'Cześć {name}',
  ru: 'Привет {name}',
  uk: 'Привіт {name}',
  tr: 'Merhaba {name}',
  cs: 'Ahoj {name}',
  el: 'Γεια σου {name}',
  ro: 'Salut {name}',
  ca: 'Hola {name}',
  hu: 'Szia {name}',
};

/** Choices (≤25) do /config greet-language: label legível + código. Derivado de GREETINGS. */
export const GREET_LANGUAGE_CHOICES: { name: string; value: string }[] = [
  { name: 'English', value: 'en' },
  { name: 'Português', value: 'pt' },
  { name: 'Español', value: 'es' },
  { name: 'Français', value: 'fr' },
  { name: 'Deutsch', value: 'de' },
  { name: 'Italiano', value: 'it' },
  { name: 'Nederlands', value: 'nl' },
  { name: 'Svenska', value: 'sv' },
  { name: 'Dansk', value: 'da' },
  { name: 'Suomi', value: 'fi' },
  { name: 'Polski', value: 'pl' },
  { name: 'Русский', value: 'ru' },
  { name: 'Українська', value: 'uk' },
  { name: 'Türkçe', value: 'tr' },
  { name: 'Čeština', value: 'cs' },
  { name: 'Ελληνικά', value: 'el' },
  { name: 'Română', value: 'ro' },
  { name: 'Català', value: 'ca' },
  { name: 'Magyar', value: 'hu' },
];

/**
 * Parabéns "Feliz aniversário {name}" por lingua-base, para o Voxi dizer quando alguém
 * ENTRA na call no seu dia de anos (em vez da saudação normal). Mesmas línguas do
 * GREETINGS; fallback ao inglês. `{name}` já sanitizado.
 */
export const BIRTHDAY_WISHES: Record<string, string> = {
  en: 'Happy birthday {name}',
  pt: 'Feliz aniversário {name}',
  es: 'Feliz cumpleaños {name}',
  fr: 'Joyeux anniversaire {name}',
  de: 'Alles Gute zum Geburtstag {name}',
  it: 'Buon compleanno {name}',
  nl: 'Gefeliciteerd met je verjaardag {name}',
  sv: 'Grattis på födelsedagen {name}',
  da: 'Tillykke med fødselsdagen {name}',
  fi: 'Hyvää syntymäpäivää {name}',
  pl: 'Wszystkiego najlepszego {name}',
  ru: 'С днём рождения {name}',
  uk: 'З днем народження {name}',
  tr: 'Doğum günün kutlu olsun {name}',
  cs: 'Všechno nejlepší {name}',
  el: 'Χρόνια πολλά {name}',
  ro: 'La mulți ani {name}',
  ca: 'Per molts anys {name}',
  hu: 'Boldog születésnapot {name}',
};

/** Códigos de saudação válidos (para validar o /config greet-language). */
export const GREET_LOCALES: ReadonlySet<string> = new Set(Object.keys(GREETINGS));

/**
 * É uma ENTRADA no canal `botChannelId`? True se a pessoa passou a estar nesse canal
 * (`newChannelId`) e ANTES não estava lá (`oldChannelId`). Cobre ligar-se de novo e
 * mudar de outro canal para o do bot. False se o bot não está em call (`botChannelId`
 * null), se já lá estava, ou se é um evento de mute/deafen (canal não mudou). PURA.
 */
export function isJoinIntoChannel(
  oldChannelId: string | null | undefined,
  newChannelId: string | null | undefined,
  botChannelId: string | null | undefined,
): boolean {
  if (!botChannelId) return false;
  return newChannelId === botChannelId && oldChannelId !== botChannelId;
}

/** Código base da língua a partir de um id de modelo Piper ('de_DE-thorsten' -> 'de'). */
function baseOfModel(model: string): string {
  return model.split('-')[0].split('_')[0].toLowerCase();
}

/**
 * Constrói o SynthRequest da saudação: texto "Olá {nome}" na língua `locale` e voz
 * dessa língua (1.º modelo instalado com o prefixo; senão a voz default). Se a língua
 * não tiver saudação, cai no inglês (texto E voz). `name` já vem sanitizado; vazio ->
 * só a saudação. `singleVoice` para a língua escolhida não ser sobreposta pela deteção.
 * PURA.
 */
export function buildGreeting(opts: {
  locale: string;
  name: string;
  availableModels: string[];
  defaultVoice: string;
  defaultSpeed: number;
  /** Se true, usa os PARABÉNS (BIRTHDAY_WISHES) em vez do "Olá" — dia de anos. */
  birthday?: boolean;
}): SynthRequest {
  const requested = (opts.locale || 'en').split('-')[0].toLowerCase();
  const table = opts.birthday ? BIRTHDAY_WISHES : GREETINGS;
  const base = table[requested] ? requested : 'en';
  const text = table[base].replace('{name}', opts.name).replace(/\s+/g, ' ').trim();
  const model = opts.availableModels.find((m) => baseOfModel(m) === base) ?? opts.defaultVoice;
  return { text, model, speed: opts.defaultSpeed, singleVoice: true };
}
