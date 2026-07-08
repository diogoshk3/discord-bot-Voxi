// tools/clear-guild-commands.cjs — APAGA todos os slash commands GUILD-SCOPED nos
// servidores do bot (ou num guild id passado em argv). Faz o inverso de
// register-guild.cjs: volta ao "global puro".
//
// PORQUÊ: um comando de guild com o mesmo nome de um global aparece A DOBRAR no
// seletor do Discord (guild + global mostram-se os dois). O register-guild.cjs só
// serve para ver uma opção nova NA HORA, sem esperar a propagação (~1h) do global.
// Depois de o global propagar, é preciso limpar os de guild senão fica duplicado.
//
// O token vem do loadConfig() (require('dotenv/config')) — NUNCA é impresso.
// Uso: node tools/clear-guild-commands.cjs [guildId]   (sem arg = todos os guilds do bot)

const { REST, Routes } = require('discord.js');
const { loadConfig } = require('../dist/config/index.js');

async function main() {
  const cfg = loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.token);

  let guildIds = process.argv.slice(2).filter(Boolean);
  if (guildIds.length === 0) {
    const guilds = await rest.get(Routes.userGuilds());
    guildIds = guilds.map((g) => g.id);
    console.log(
      `[clear-guild] bot está em ${guilds.length} servidor(es): ${guilds.map((g) => g.name).join(', ')}`,
    );
  }

  for (const gid of guildIds) {
    // PUT com body vazio remove TODOS os comandos de guild nesse servidor.
    await rest.put(Routes.applicationGuildCommands(cfg.clientId, gid), { body: [] });
    console.log(`[clear-guild] comandos de guild apagados no guild ${gid}. Fica só o global.`);
  }
  console.log(
    '[clear-guild] feito. Já não há duplicados — faz Ctrl+R no Discord (os globais mantêm-se).',
  );
}

main().catch((err) => {
  console.error('[clear-guild] falhou:', err?.message || err);
  process.exit(1);
});
