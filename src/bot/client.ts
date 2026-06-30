import { Client, GatewayIntentBits, Partials, Events, Interaction, Message } from 'discord.js';
import type { BotDeps } from './deps';
import { handleInteraction, handleAutocomplete } from '../commands/index';
import { handleMessage } from '../commands/messageHandler';
import { buildPresence } from './presence';
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
    if (!interaction.isChatInputCommand()) return;
    void handleInteraction(interaction, deps);
  });

  client.on(Events.MessageCreate, (message: Message) => {
    void handleMessage(message, deps);
  });

  client.on(Events.Error, (err) => {
    log.error('[client] erro do gateway', err);
  });

  process.on('unhandledRejection', (reason) => {
    log.error('[process] unhandledRejection', reason);
  });
  process.on('uncaughtException', (err) => {
    log.error('[process] uncaughtException', err);
  });
}
