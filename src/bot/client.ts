import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  Interaction,
  Message,
  Guild,
  VoiceState,
} from 'discord.js';
import type { BotDeps } from './deps';
import { handleGuildDelete, getPlayer } from './deps';
import { handleInteraction, handleAutocomplete, handleMessageContextMenu } from '../commands/index';
import { handleMessage } from '../commands/messageHandler';
import { getGuildConfig } from '../store/guildConfig';
import { getNickname } from '../store/nickname';
import { sanitizeSpeakerName } from '../language/speakerName';
import { buildGreeting, isJoinIntoChannel } from '../voice/greeting';
import { getBirthday, isBirthdayToday } from '../store/birthday';
import { buildPresence } from './presence';
import { pickWelcomeChannel, buildWelcomeEmbed } from './welcome';
import { DEFAULT_LOCALE } from '../i18n/index';
import { createErrorReporter } from '../errorReporter';
import { log } from '../logging/logger';

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel],
  });
}

/**
 * Saudação de voz: o Voxi diz "Olá {nome}" quando um HUMANO entra no canal de voz onde
 * ele está. LIGADA por defeito (guild_config.greet_on_join); língua em greet_locale
 * (default inglês). Best-effort e defensiva: nunca crasha o gateway. Ignora bots (incl.
 * o próprio), respeita o kill-switch (enabled) e exige um player ativo. O nome é
 * resolvido e SANITIZADO como no xsaid (honra o /voice nickname).
 */
function greetOnJoin(deps: BotDeps, oldState: VoiceState, newState: VoiceState): void {
  try {
    const member = newState.member;
    if (!member || member.user.bot) return;
    const guildId = newState.guild?.id;
    if (!guildId) return;
    const player = getPlayer(deps, guildId);
    if (!player) return;
    const botChannelId = newState.guild.members.me?.voice?.channelId ?? null;
    if (!isJoinIntoChannel(oldState.channelId, newState.channelId, botChannelId)) return;
    const cfg = getGuildConfig(deps.db, guildId);
    if (!cfg.enabled || !cfg.greetOnJoin) return;
    const rawName =
      getNickname(deps.db, guildId, member.id) ?? member.displayName ?? member.user.username ?? '';
    // Dia de anos? Se a pessoa faz anos hoje, o Voxi diz "Parabéns {nome}" em vez do "Olá".
    const bd = getBirthday(deps.db, guildId, member.id);
    const isBirthday = bd !== null && isBirthdayToday(bd, new Date());
    const req = buildGreeting({
      locale: cfg.greetLocale,
      name: sanitizeSpeakerName(rawName),
      availableModels: deps.availableModels,
      defaultVoice: cfg.defaultVoice || deps.config.defaultVoice || 'en_US-amy-medium',
      defaultSpeed: deps.config.defaultSpeed,
      birthday: isBirthday,
    });
    void player.say(req);
  } catch (err) {
    log.warn('[client] falha na saudação de entrada (ignorado)', err);
  }
}

export function bindEvents(deps: BotDeps): void {
  const { client } = deps;

  client.once(Events.ClientReady, (c) => {
    log.info(`[client] online como ${c.user.tag}`);
    // P9.3 — presenca como auto-marketing subtil (marca + CTA). Defensivo: nunca
    // deixar uma falha na presenca crashar o arranque do bot.
    try {
      c.user.setPresence(buildPresence(deps.config));
    } catch (err) {
      log.warn('[client] falha ao definir a presenca (ignorado)', err);
    }
  });

  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    if (interaction.isAutocomplete()) {
      void handleAutocomplete(interaction, deps);
      return;
    }
    // Context-menu de mensagem (botão direito -> Apps -> Speak).
    if (interaction.isMessageContextMenuCommand()) {
      void handleMessageContextMenu(interaction, deps);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    void handleInteraction(interaction, deps);
  });

  client.on(Events.MessageCreate, (message: Message) => {
    void handleMessage(message, deps);
  });

  // VoiceStateUpdate — alguém entrou/saiu/mudou de canal de voz. Serve para a regra
  // "o bot só sai quando fica sozinho na call" (AloneWatcher re-avalia a guild).
  // ALTA-FREQUÊNCIA (dispara em cada mute/deafen do servidor inteiro), por isso o
  // bail cedo: só agir onde o bot TEM player (está numa call desta guild).
  client.on(Events.VoiceStateUpdate, (oldState: VoiceState, newState: VoiceState) => {
    const guildId = newState.guild?.id ?? oldState.guild?.id;
    if (!guildId || !deps.players.has(guildId)) return;
    deps.aloneWatcher?.evaluate(guildId);
    // Saudação: alguém ENTROU no canal do bot -> "Olá {nome}" (se ligado).
    greetOnJoin(deps, oldState, newState);
  });

  // guildCreate — o Voxi entrou num servidor novo. Enviamos UMA vez um welcome
  // embed (beginner onboarding) a um canal adequado. O evento ja e 1x por entrada,
  // por isso nao precisa de dedup. Toda a decisao testavel esta em welcome.ts
  // (pickWelcomeChannel/buildWelcomeEmbed); aqui so ligamos as pecas: null -> nao
  // envia; try/catch para NUNCA crashar (guild nova = locale default 'en').
  client.on(Events.GuildCreate, (guild: Guild) => {
    void (async () => {
      try {
        const channel = pickWelcomeChannel(guild as unknown as Parameters<typeof pickWelcomeChannel>[0]);
        if (!channel) return;
        const embed = buildWelcomeEmbed(DEFAULT_LOCALE);
        // O canal escolhido e sempre um GuildText enviavel (pickWelcomeChannel ja
        // validou ViewChannel+SendMessages); usamos a instancia real da cache.
        const sendable = guild.channels.cache.get(channel.id);
        if (sendable && 'send' in sendable && typeof sendable.send === 'function') {
          await sendable.send({ embeds: [embed] });
        }
      } catch (err) {
        log.warn('[client] falha ao enviar welcome embed (ignorado)', err);
      }
    })();
  });

  // guildDelete — o Voxi saiu (kick/leave) ou perdeu acesso a uma guild. Libertar
  // os recursos retidos por guildId (limiter + player) para nao vazar memoria em
  // uptime longo. Toda a logica testavel esta em handleGuildDelete (deps.ts).
  // IMPORTANTE: o Discord dispara isto TAMBEM em OUTAGES transitorios da guild
  // (guild.available === false). Nesse caso NAO destruimos a sessao — a ligacao de
  // voz sobrevive ao blip e a sua propria reconexao (VoiceConnectionStatus.Disconnected
  // -> handleDisconnect) trata do resto. Se destruissemos, o bot saia silenciosamente
  // da call e SO voltava quando alguem mandasse mensagem/`/join` (nada re-join automatico
  // em GuildAvailable). So libertamos recursos numa remocao REAL (available !== false).
  client.on(Events.GuildDelete, (guild: Guild) => {
    if (guild.available === false) return;
    handleGuildDelete(deps, guild.id);
  });

  // Vaga 3 — reporter de erros para um webhook do Discord (OPT-IN via ERROR_WEBHOOK_URL).
  // Envia os erros INESPERADOS (gateway/rejeições/exceções) para o operador ver problemas
  // em produção sem ler logs. No-op sem url; dedup por hash; nunca lança.
  const errorReporter = createErrorReporter(deps.config.errorWebhookUrl);

  client.on(Events.Error, (err) => {
    log.error('[client] erro do gateway', err);
    void errorReporter.report(err, 'gateway');
  });

  process.on('unhandledRejection', (reason) => {
    log.error('[process] unhandledRejection', reason);
    void errorReporter.report(reason, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    log.error('[process] uncaughtException — a reportar e a SAIR (o supervisor reinicia limpo)', err);
    // Guia do Node: após uma exceção não-apanhada o processo fica em estado indefinido.
    // Saímos com código != 0 para o supervisor (start-prod.mjs) reiniciar de fresco, em
    // vez de ficarmos "vivos mas partidos" — o que o health endpoint reportaria como OK
    // enquanto o bot está wedged. Janela curta para o webhook de erro escoar antes de sair.
    const exit = (): void => process.exit(1);
    const t = setTimeout(exit, 2000);
    t.unref();
    void errorReporter.report(err, 'uncaughtException').finally(exit);
  });
}
