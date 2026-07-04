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
import { handleGuildDelete } from './deps';
import { handleInteraction, handleAutocomplete, handleMessageContextMenu } from '../commands/index';
import { handleMessage } from '../commands/messageHandler';
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
  // "o bot só sai se ficar sozinho na call 5 min" (AloneWatcher re-avalia a guild).
  // ALTA-FREQUÊNCIA (dispara em cada mute/deafen do servidor inteiro), por isso o
  // bail cedo: só agir onde o bot TEM player (está numa call desta guild).
  client.on(Events.VoiceStateUpdate, (oldState: VoiceState, newState: VoiceState) => {
    const guildId = newState.guild?.id ?? oldState.guild?.id;
    if (!guildId || !deps.players.has(guildId)) return;
    deps.aloneWatcher?.evaluate(guildId);
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
  // uptime longo. Toda a logica testavel esta em handleGuildDelete (deps.ts);
  // aqui so ligamos o evento. Nota: o Discord tambem dispara isto em outages
  // transitorios (guild.available === false) — destruir o player nesse caso e
  // inofensivo (e recriado on-demand quando a guild volta).
  client.on(Events.GuildDelete, (guild: Guild) => {
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
