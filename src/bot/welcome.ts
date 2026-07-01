import { EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { t, DEFAULT_LOCALE } from '../i18n/index';

/**
 * Welcome embed no guildCreate — beginner onboarding quando o Voxi entra num
 * servidor novo. Toda a logica *testavel* vive aqui em funcoes PURAS; o handler
 * do evento (em client.ts) so as liga (guarda de perms + try/catch). Assim os
 * testes exercitam a escolha de canal e a construcao do embed com objetos fake,
 * sem simular o evento real do gateway.
 *
 * Tudo em ingles via t() (locale default 'en': uma guild nova nao tem config).
 */

// Forma minima de um canal de texto, suficiente para escolher o alvo do welcome.
// So dependemos do que precisamos (id, type, permissionsFor) para os testes
// poderem passar fakes com o mesmo padrao `permissionsFor: () => ({ has })` que
// os testes de /setup ja usam.
export interface WelcomeChannelLike {
  id: string;
  type: number;
  permissionsFor?: (target: unknown) => { has: (flag: bigint) => boolean } | null;
}

// Forma minima de uma guild para pickWelcomeChannel. `members.me` e a referencia
// do bot (para permissionsFor); `systemChannel` e o canal preferido; `channels`
// da acesso a colecao completa para o fallback.
export interface WelcomeGuildLike {
  members?: { me?: unknown } | null;
  systemChannel?: WelcomeChannelLike | null;
  channels: {
    // Iteravel de [id, channel] (como Collection do discord.js) OU um array de
    // canais — aceitamos ambos para o handler real e para os testes.
    cache: Iterable<[unknown, WelcomeChannelLike]> | WelcomeChannelLike[];
  };
}

/** Verdadeiro se o bot pode VER e ESCREVER no canal (welcome precisa de ambos). */
function botCanPost(channel: WelcomeChannelLike, me: unknown): boolean {
  if (channel.type !== ChannelType.GuildText) return false;
  const perms = me && channel.permissionsFor ? channel.permissionsFor(me) : null;
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages);
}

/**
 * Escolhe onde enviar o welcome, PURO e testavel:
 *  1. `guild.systemChannel` se o bot puder la enviar (ViewChannel+SendMessages);
 *  2. senao, o 1.º canal de texto (na ordem da cache) onde o bot possa enviar;
 *  3. senao, `null` (o handler simplesmente nao envia — nunca crasha).
 */
export function pickWelcomeChannel(guild: WelcomeGuildLike): WelcomeChannelLike | null {
  const me = guild.members?.me ?? null;
  if (!me) return null;

  if (guild.systemChannel && botCanPost(guild.systemChannel, me)) {
    return guild.systemChannel;
  }

  // Normaliza a cache: Collection<[id, ch]> ou array de canais -> lista de canais.
  const channels: WelcomeChannelLike[] = [];
  for (const item of guild.channels.cache as Iterable<unknown>) {
    // Entrada de Collection e um par [id, ch]; um array e so o canal.
    const ch = (Array.isArray(item) ? item[1] : item) as WelcomeChannelLike;
    if (ch && typeof ch === 'object' && 'type' in ch) channels.push(ch);
  }
  for (const ch of channels) {
    if (botCanPost(ch, me)) return ch;
  }
  return null;
}

/**
 * Constroi o welcome embed no `locale` dado (default 'en'). PURO: nao envia nada.
 * Menciona o que o Voxi faz, /setup como 1.º passo e /help para a lista completa.
 */
export function buildWelcomeEmbed(locale: string = DEFAULT_LOCALE): EmbedBuilder {
  // Reforca o diferenciador (voz neural gratis, sem paywall) logo no welcome: e o
  // que separa o Voxi do lider pago do mercado. Anexado a descricao para nao
  // colidir com o footer da marca ('welcome.footer').
  const description = `${t('welcome.description', locale, { setup: '`/setup`', help: '`/help`' })}\n\n${t('welcome.tagline', locale)}`;
  return new EmbedBuilder()
    .setColor(0x5865f2) // blurple — coerente com o embed do /help
    .setTitle(t('welcome.title', locale))
    .setDescription(description)
    .setFooter({ text: t('welcome.footer', locale) });
}
