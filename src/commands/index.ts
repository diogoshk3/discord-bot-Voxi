import { ChatInputCommandInteraction, AutocompleteInteraction, MessageFlags } from 'discord.js';
import type { BotDeps } from '../bot/deps';
import { voiceDisplayName, makeLocalizedNamer } from '../language/voiceMap';
import { JOKE_LANGUAGES } from '../content/jokes';
import { filterGameChoices, filterWordChainLanguages } from '../games/index';
import { log } from '../logging/logger';
import { t, SUPPORTED_LOCALES, LOCALE_DISPLAY_NAMES } from '../i18n/index';

// Handlers extraídos por domínio (plano 015): index.ts fica como registry/dispatcher fino.
import { handleJoin, handleLeave, handleTts, handleSkip, handleShutup } from './handlers/core';
import { handleVoice } from './handlers/voice';
import { handleConfig, handleSetup, handleStats } from './handlers/config';
import { handleGame } from './handlers/games';
import {
  handleLaugh,
  handleJoke,
  handleRizz,
  handleSound,
  handleMicroFun,
  handleBirthday,
} from './handlers/fun';
import {
  handleHelp,
  handleInvite,
  handleVote,
  handleUptime,
  handleBotstats,
  handleTopSpeakers,
  handlePremium,
  handleVozenGrant,
  handleGenCode,
  handleRedeem,
} from './handlers/meta';
import {
  handlePronunciation,
  handleServerPronunciation,
  handleRandomizer,
} from './handlers/personal';
import { handlePrivacy } from './handlers/privacy';
import { localeFor } from './helpers';

// Re-exports: mantêm os caminhos de import públicos inalterados para quem já importa daqui.
export { localeForUser, INVITE_PERMISSIONS, localePrefixOf, formatDuration } from './helpers';
export { joinUserVoice, handleMessageContextMenu, type JoinOutcome } from './handlers/core';

export { commandDefs, ownerCommandDefs } from './definitions';

/**
 * Filtra os modelos disponíveis pelo que o utilizador escreveu (case-insensitive),
 * limitado a 25 (máximo do Discord para autocomplete). Função pura e testável.
 *
 * `locale` (o locale do cliente Discord de quem escreve, `i.locale`) escreve os nomes
 * das línguas NA LÍNGUA DO UTILIZADOR (ex.: "Alemão"/"Allemand"/"German") via
 * makeLocalizedNamer. Sem `locale` -> autónimos (comportamento antigo, usado nos testes).
 */
export function filterModelChoices(
  models: string[],
  query: string,
  locale?: string,
): { name: string; value: string }[] {
  const q = query.trim().toLowerCase();
  // voice:false -> o picker mostra só a LÍNGUA (como sempre), agora na língua do user.
  const namer = makeLocalizedNamer(locale, models, { voice: false });
  return (
    models
      .map((m) => ({ name: namer(m), value: m }))
      // Procura pelo nome localizado E pelo id cru (o user pode escrever na sua língua
      // OU o nome técnico/voz). Também casa o autónimo para não regredir a pesquisa.
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.value.toLowerCase().includes(q) ||
          voiceDisplayName(c.value).toLowerCase().includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 25)
  );
}

/**
 * Filtra as linguas suportadas do /joke pelo que o utilizador escreve na opcao
 * `idioma` (case-insensitive, por substring do display name em INGLES), limitado a
 * 25 (maximo do Discord para autocomplete). Suportamos 34 linguas > 25, por isso o
 * cap e mesmo necessario (uma query vazia excederia o limite). Pura e testavel.
 */
export function filterJokeLanguages(query: string): { name: string; value: string }[] {
  const q = query.trim().toLowerCase();
  return JOKE_LANGUAGES.filter((l) => l.display.toLowerCase().includes(q))
    .map((l) => ({ name: l.display, value: l.key }))
    .slice(0, 25);
}

/**
 * Filtra os locales da INTERFACE suportados pelo que o utilizador escreve na opcao
 * `locale` do /config language (case-insensitive, por substring do endonimo OU do
 * codigo), limitado a 25 (maximo do Discord para autocomplete). Suportamos 34
 * linguas > 25, por isso o cap e mesmo necessario (uma query vazia excederia o
 * limite) — foi por isto que este comando passou de choices estaticas a
 * autocomplete. Pura e testavel. name = endonimo (LOCALE_DISPLAY_NAMES), value =
 * codigo (o que se grava em guild_config.locale).
 */
export function filterLocaleChoices(query: string): { name: string; value: string }[] {
  const q = query.trim().toLowerCase();
  return SUPPORTED_LOCALES.filter(
    (code) =>
      LOCALE_DISPLAY_NAMES[code].toLowerCase().includes(q) || code.toLowerCase().includes(q),
  )
    .map((code) => ({ name: LOCALE_DISPLAY_NAMES[code], value: code }))
    .slice(0, 25);
}

/**
 * Autocomplete das opções `model` (/voice set, /voice preview, /config
 * default-voice) e `idioma` (/joke): mostra as vozes REALMENTE instaladas / as
 * linguas suportadas para o utilizador escolher de uma lista, em vez de escrever o
 * nome à mão. Beginner-friendly. Qualquer outra opção -> [] (sem sugestões).
 */
/**
 * Sanitiza choices de autocomplete para os limites do Discord: máx. 25 entradas,
 * `name` 1–100 chars, `value` ≤100 chars. UMA entrada inválida faz a API rejeitar o
 * payload INTEIRO com 400 → o cliente mostra "Falha ao carregar opções". Este é o
 * único ponto de passagem antes do respond(), por isso a garantia é estrutural.
 */
export function sanitizeAutocompleteChoices(
  choices: { name: string; value: string }[],
): { name: string; value: string }[] {
  return choices.slice(0, 25).map((c) => ({
    name: (String(c.name).trim() || '—').slice(0, 100),
    value: String(c.value).slice(0, 100),
  }));
}

/** Calcula as choices de UMA interação de autocomplete. Síncrono e sem I/O — o
 *  orçamento de ~3s do autocomplete (sem defer possível) gasta-se na REDE, não aqui. */
function computeAutocompleteChoices(
  i: AutocompleteInteraction,
  deps: BotDeps,
  focused: { name: string; value: string },
): { name: string; value: string }[] {
  if (focused.name === 'model') {
    // i.locale = locale do cliente Discord de quem escreve -> nomes das línguas
    // escritos NA LÍNGUA DELE (ex.: "Alemão" para PT, "Allemand" para FR).
    return filterModelChoices(deps.availableModels, focused.value, i.locale);
  }
  if (focused.name === 'language') {
    // A opção `language` existe em DOIS comandos: /joke (~34 línguas) e /game play
    // word-chain (só as 4 línguas latinas com wordlist). Roteamos por comando.
    if (i.commandName === 'game') return filterWordChainLanguages(focused.value);
    return filterJokeLanguages(focused.value);
  }
  // /config language: a opcao chama-se `locale` (NAO `language` — essa e do /joke).
  // 34 linguas > 25 choices estaticas do Discord, por isso e autocomplete.
  if (focused.name === 'locale') {
    return filterLocaleChoices(focused.value);
  }
  // /game play: nomes dos jogos na LINGUA do utilizador. filterGameChoices espera o
  // codigo base ('pt', 'fr'); normalizamos o i.locale do Discord ('pt-BR' -> 'pt').
  if (focused.name === 'game') {
    const base = (i.locale || '').split('-')[0].toLowerCase() || 'en';
    return filterGameChoices(focused.value, base);
  }
  // /voice clone record `user`: lista quem está na call COM o bot (os únicos alvos
  // válidos — gravar exige estar no canal do bot). Fora de uma call, lista vazia.
  if (focused.name === 'user') {
    const botChannel = i.guild?.members.me?.voice?.channel ?? null;
    const q = focused.value.trim().toLowerCase();
    return botChannel
      ? [...botChannel.members.values()]
          .filter((m) => !m.user.bot)
          .filter(
            (m) =>
              !q ||
              m.displayName.toLowerCase().includes(q) ||
              m.user.username.toLowerCase().includes(q),
          )
          .slice(0, 25)
          .map((m) => ({ name: m.displayName, value: m.id }))
      : [];
  }
  return [];
}

export async function handleAutocomplete(i: AutocompleteInteraction, deps: BotDeps): Promise<void> {
  // Instrumentação anti-"Falha ao carregar opções". O autocomplete NÃO pode ser
  // deferido e o token morre ~3s depois de o utilizador escrever; o orçamento
  // divide-se em: entrega gateway->bot (age), handler (síncrono, ~0ms) e o POST
  // REST da resposta. Medimos cada troço para que, quando falhar, o log diga QUAL
  // troço comeu o tempo — sem isto o sintoma é invisível e "recorrente".
  const t0 = Date.now();
  const age = t0 - (i.createdTimestamp ?? t0); // atraso JÁ gasto antes de chegarmos a correr
  let focusedName = '?';
  try {
    const focused = i.options.getFocused(true);
    focusedName = focused.name;
    if (age > 2500) {
      // O token está (quase) morto à chegada: responder só geraria um 10062. A causa
      // é a MONTANTE do handler — gateway/rede/CPU da máquina — e fica registada.
      log.warn(
        `[autocomplete] interação "${i.commandName}:${focusedName}" chegou ${age}ms atrasada — resposta já impossível (gateway/rede/CPU saturados).`,
      );
      return;
    }
    await i.respond(sanitizeAutocompleteChoices(computeAutocompleteChoices(i, deps, focused)));
    const restMs = Date.now() - t0;
    if (age + restMs > 1500) {
      log.warn(
        `[autocomplete] lento (respondeu, mas perto do limite): "${i.commandName}:${focusedName}" entrega=${age}ms resposta=${restMs}ms.`,
      );
    }
  } catch (err) {
    // 10062 = a resposta chegou ao Discord depois do token expirar. Não é bug do
    // handler (que é síncrono): é latência de rede/CPU — classificado à parte para
    // o diagnóstico do "Falha ao carregar opções" recorrente.
    if ((err as { code?: number }).code === 10062) {
      log.warn(
        `[autocomplete] resposta tardia (10062): "${i.commandName}:${focusedName}" entrega=${age}ms total=${Date.now() - t0}ms.`,
      );
      return;
    }
    log.error(`[autocomplete] erro em "${i.commandName}:${focusedName}"`, err);
  }
}

export async function handleInteraction(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
): Promise<void> {
  try {
    switch (i.commandName) {
      case 'join':
        return await handleJoin(i, deps);
      case 'leave':
        return await handleLeave(i, deps);
      case 'tts':
        return await handleTts(i, deps);
      case 'skip':
        return await handleSkip(i, deps);
      case 'shutup':
        return await handleShutup(i, deps);
      case 'laugh':
        return await handleLaugh(i, deps);
      case 'joke':
        return await handleJoke(i, deps);
      case 'rizz':
        return await handleRizz(i, deps);
      case 'sound':
        return await handleSound(i, deps);
      case '8ball':
        return await handleMicroFun(i, deps, '8ball');
      case 'fortune':
        return await handleMicroFun(i, deps, 'fortune');
      case 'fact':
        return await handleMicroFun(i, deps, 'fact');
      case 'wyr':
        return await handleMicroFun(i, deps, 'wyr');
      case 'birthday':
        return await handleBirthday(i, deps);
      case 'topspeakers':
        return await handleTopSpeakers(i, deps);
      case 'premium':
        return await handlePremium(i, deps);
      case 'vozengrant':
        return await handleVozenGrant(i, deps);
      case 'gencode':
        return await handleGenCode(i, deps);
      case 'redeem':
        return await handleRedeem(i, deps);
      case 'game':
        return await handleGame(i, deps);
      case 'voice':
        return await handleVoice(i, deps);
      case 'config':
        return await handleConfig(i, deps);
      case 'setup':
        return await handleSetup(i, deps);
      case 'stats':
        return await handleStats(i, deps);
      case 'uptime':
        return await handleUptime(i, deps);
      case 'botstats':
        return await handleBotstats(i, deps);
      case 'invite':
        return await handleInvite(i, deps);
      case 'vote':
        return await handleVote(i, deps);
      case 'help':
        return await handleHelp(i, deps);
      case 'pronunciation':
        return await handlePronunciation(i, deps);
      case 'serverpronunciation':
        return await handleServerPronunciation(i, deps);
      case 'randomizer':
        return await handleRandomizer(i, deps);
      case 'privacy':
        return await handlePrivacy(i, deps);
    }
  } catch (err) {
    log.error('[command] erro em', i.commandName, err);
    if (!i.isRepliable()) return;
    // localeFor nunca lanca (fallback DEFAULT_LOCALE em falha/db ausente), por isso
    // e seguro no catch — a mensagem de erro nunca fica presa por uma leitura de config.
    const locale = localeFor(deps, i.guildId);
    const msg = t('error.generic', locale);
    if (i.deferred && !i.replied) {
      // Ja foi deferido (caso do /tts): editReply para o utilizador receber o erro
      // em vez de ficar preso em "a pensar...".
      await i.editReply({ content: msg }).catch(() => {});
    } else if (!i.replied) {
      await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
