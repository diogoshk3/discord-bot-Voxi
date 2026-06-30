import { Client, GatewayIntentBits, Partials, Events, Interaction, Message } from 'discord.js';
import type { BotDeps } from './deps';
import { handleInteraction } from '../commands/index';
import { handleMessage } from '../commands/messageHandler';

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
    console.log(`[client] online como ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    void handleInteraction(interaction, deps);
  });

  client.on(Events.MessageCreate, (message: Message) => {
    void handleMessage(message, deps);
  });

  client.on(Events.Error, (err) => {
    console.error('[client] erro do gateway', err);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[process] unhandledRejection', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[process] uncaughtException', err);
  });
}
