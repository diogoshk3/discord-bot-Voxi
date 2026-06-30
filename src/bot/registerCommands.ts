import { REST, Routes } from 'discord.js';
import { commandDefs } from '../commands/index';
import { loadConfig } from '../config/index';
import { log } from '../logging/logger';

export async function registerCommands(token: string, clientId: string): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commandDefs });
  log.info(`[register] ${commandDefs.length} comandos registados globalmente.`);
}

// arranque quando corrido via `npm run register`
if (process.argv[1] && process.argv[1].endsWith('registerCommands.ts')) {
  const cfg = loadConfig();
  registerCommands(cfg.token, cfg.clientId).catch((err) => {
    log.error('[register] falhou', err);
    process.exit(1);
  });
}
