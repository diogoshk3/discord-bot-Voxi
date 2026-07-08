// tools/register-guild.cjs — regista os slash commands GUILD-SCOPED em todos os
// servidores onde o bot está (ou num guild id passado em argv). Ao contrário do
// registo GLOBAL (registerCommands.ts), os comandos de guild aparecem NA HORA — sem
// o atraso de propagação (~1h) nem a cache do cliente. Útil para ver já uma opção
// nova (ex.: o motor Kokoro no /voice set) sem esperar pela propagação global.
//
// O token vem do loadConfig() (que faz require('dotenv/config')) — NUNCA é impresso.
// Uso: node tools/register-guild.cjs [guildId]   (sem arg = todos os guilds do bot)
//
// NOTA: um comando de guild com o mesmo nome SOBREPÕE o global nesse servidor. Para
// voltar ao global puro mais tarde, correr tools/clear-guild-commands.cjs.

const { REST, Routes } = require('discord.js');
const { loadConfig } = require('../dist/config/index.js');
const { commandDefs } = require('../dist/commands/index.js');

async function main() {
  const cfg = loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.token);

  let guildIds = process.argv.slice(2).filter(Boolean);
  if (guildIds.length === 0) {
    const guilds = await rest.get(Routes.userGuilds());
    guildIds = guilds.map((g) => g.id);
    console.log(
      `[register-guild] bot está em ${guilds.length} servidor(es): ${guilds.map((g) => g.name).join(', ')}`,
    );
  }

  for (const gid of guildIds) {
    await rest.put(Routes.applicationGuildCommands(cfg.clientId, gid), { body: commandDefs });
    console.log(
      `[register-guild] ${commandDefs.length} comandos registados no guild ${gid} (instantâneo).`,
    );
  }
  console.log(
    '[register-guild] feito. As opções novas (incl. o motor Kokoro) já aparecem — faz Ctrl+R no Discord.',
  );
}

main().catch((err) => {
  console.error('[register-guild] falhou:', err?.message || err);
  process.exit(1);
});
