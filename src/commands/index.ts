import {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  InteractionContextType,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import type { BotDeps } from '../bot/deps';
import { EFFECT_CHOICES } from '../tts/effects';
import { voiceDisplayName, makeLocalizedNamer } from '../language/voiceMap';
import { JOKE_LANGUAGES } from '../content/jokes';
import { filterGameChoices, filterWordChainLanguages } from '../games/index';
import { GREET_LANGUAGE_CHOICES } from '../voice/greeting';
import { log } from '../logging/logger';
import { t, SUPPORTED_LOCALES, LOCALE_DISPLAY_NAMES } from '../i18n/index';

// Handlers extraídos por domínio (plano 015): index.ts fica como registry/dispatcher fino.
import { handleJoin, handleLeave, handleTts, handleSkip, handleShutup } from './handlers/core';
import { handleVoice } from './handlers/voice';
import { handleConfig, handleSetup, handleStats } from './handlers/config';
import { handleGame } from './handlers/games';
import { handleLaugh, handleJoke, handleMicroFun, handleBirthday } from './handlers/fun';
import {
  handleHelp,
  handleInvite,
  handleVote,
  handleUptime,
  handleBotstats,
  handleTopSpeakers,
  handlePremium,
  handleVozenGrant,
} from './handlers/meta';
import { handlePronunciation, handleRandomizer } from './handlers/personal';
import { localeFor } from './helpers';

// Re-exports: mantêm os caminhos de import públicos inalterados para quem já importa daqui.
export { localeForUser, INVITE_PERMISSIONS, localePrefixOf, formatDuration } from './helpers';
export { joinUserVoice, handleMessageContextMenu, type JoinOutcome } from './handlers/core';

const commandDefsRaw: RESTPostAPIApplicationCommandsJSONBody[] = [
  // /invite — gatilho do loop viral: qualquer utilizador pode pedir o link de
  // convite OAuth2 do bot. Top-level e SEM setDefaultMemberPermissions (nao
  // admin-only), para que quem ouve o Vozen numa call o possa adicionar.
  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Show the link to add Vozen to your server')
    .toJSON(),
  // /vote — link para a pagina de voto do Vozen no top.gg (P11.5). Top-level e SEM
  // setDefaultMemberPermissions (NAO admin-only): qualquer utilizador pode votar.
  // Tal como o /invite, e um gatilho de crescimento — votar (gratis, a cada 12h)
  // sobe a visibilidade do bot no top.gg.
  new SlashCommandBuilder()
    .setName('vote')
    .setDescription('Show the link to vote for Vozen on top.gg')
    .toJSON(),
  // /help — discovery de comandos em-app, para donos de servidor nao-tecnicos.
  // Top-level e SEM setDefaultMemberPermissions (NAO admin-only): qualquer
  // utilizador pode pedir a lista. O texto e DERIVADO destes commandDefs (ver
  // handleHelp), por isso este comando inclui-se a si proprio no grupo "Geral".
  new SlashCommandBuilder().setName('help').setDescription("Show Vozen's command list").toJSON(),
  new SlashCommandBuilder().setName('join').setDescription('Join your voice channel').toJSON(),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel').toJSON(),
  new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Vozen reads a text out loud')
    .addStringOption((o) =>
      o
        .setName('text')
        .setNameLocalizations({ 'pt-BR': 'texto' })
        .setDescription('What to read')
        .setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current audio').toJSON(),
  // /shutup — cala o Vozen JÁ: esvazia a fila toda e pára o que está a tocar (sem sair
  // da call). O /skip salta só a mensagem atual; este limpa tudo.
  new SlashCommandBuilder()
    .setName('shutup')
    .setNameLocalizations({ 'pt-BR': 'cala-te' })
    .setDescription('Make Vozen stop talking now (clears the whole queue)')
    .toJSON(),
  // /laugh — diversao por-utilizador (como /tts): o Vozen ri na voz ATUAL do user.
  // Sem opcoes, sem gate de admin; exige um player ativo (user numa call).
  new SlashCommandBuilder()
    .setName('laugh')
    .setDescription('Vozen laughs out loud in your current voice')
    .toJSON(),
  // /joke — conta uma piada curta na LINGUA escolhida. `idioma` usa AUTOCOMPLETE
  // (nao choices): suportamos ~34 linguas e o Discord limita choices estaticas a
  // 25. `risos` (obrigatorio) acrescenta uma gargalhada no fim.
  new SlashCommandBuilder()
    .setName('joke')
    .setDescription('Vozen tells a short joke in the language you pick')
    .addStringOption((o) =>
      o
        .setName('language')
        .setNameLocalizations({ 'pt-BR': 'idioma' })
        .setDescription('Language of the joke')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addBooleanOption((o) =>
      o
        .setName('laughter')
        .setNameLocalizations({ 'pt-BR': 'risos' })
        .setDescription('Add laughter at the end?')
        .setRequired(true),
    )
    .toJSON(),
  // Micro-comandos divertidos (falados na voz + resposta pública). Funcionam sem estar
  // numa call (só texto); se o Vozen estiver na call, também fala.
  new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a yes/no question')
    .addStringOption((o) =>
      o
        .setName('question')
        .setNameLocalizations({ 'pt-BR': 'pergunta' })
        .setDescription('Your yes/no question')
        .setRequired(true)
        .setMaxLength(200),
    )
    .toJSON(),
  new SlashCommandBuilder().setName('fortune').setDescription('Vozen reads you a fortune').toJSON(),
  new SlashCommandBuilder()
    .setName('fact')
    .setDescription('Vozen tells you a random fun fact')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('wyr')
    .setDescription('Vozen asks a "would you rather" question')
    .toJSON(),
  // /birthday — regista o teu aniversário; o Vozen diz "Parabéns" quando entrares na call
  // nesse dia. Sem ano (só interessa o dia). set / clear / show.
  new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Vozen wishes you a happy birthday when you join on your day')
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set your birthday (day + month, no year)')
        .addIntegerOption((o) =>
          o
            .setName('day')
            .setNameLocalizations({ 'pt-BR': 'dia' })
            .setDescription('Day of the month (1–31)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(31),
        )
        .addIntegerOption((o) =>
          o
            .setName('month')
            .setNameLocalizations({ 'pt-BR': 'mes' })
            .setDescription('Month (1–12)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(12),
        ),
    )
    .addSubcommand((s) => s.setName('clear').setDescription('Remove your saved birthday'))
    .addSubcommand((s) => s.setName('show').setDescription('Show your saved birthday'))
    .toJSON(),
  // /topspeakers — quem teve mais mensagens lidas pelo Vozen + streaks de dias seguidos.
  new SlashCommandBuilder()
    .setName('topspeakers')
    .setDescription('See who Vozen has read the most — and daily streaks')
    .toJSON(),
  // /premium — estado/montra + gerir licenças do passe (info/activate/deactivate).
  new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Vozen Premium: your status, or use/free a licence on this server')
    .addSubcommand((s) =>
      s.setName('info').setDescription('See your Premium status — or what you get and how to buy'),
    )
    .addSubcommand((s) =>
      s
        .setName('activate')
        .setDescription('Use one of your Premium licences on this server (needs Manage Server)'),
    )
    .addSubcommand((s) =>
      s
        .setName('deactivate')
        .setDescription('Free this server’s Premium licence to use it elsewhere'),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Manage your voice')
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set your voice')
        .addStringOption((o) =>
          o.setName('model').setDescription('Piper model').setRequired(true).setAutocomplete(true),
        )
        .addNumberOption((o) =>
          o.setName('speed').setDescription('Speed (0.5-2.0)').setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName('engine')
            .setNameLocalizations({ 'pt-BR': 'motor' })
            .setDescription('Voice engine: Google (default), Piper, or Kokoro (neural, ~7 langs)')
            .setRequired(false)
            .addChoices(
              { name: 'Google (default)', value: 'google' },
              { name: 'Piper', value: 'piper' },
              { name: 'Kokoro (neural)', value: 'kokoro' },
            ),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List the available models'))
    .addSubcommand((s) => s.setName('reset').setDescription('Reset your voice to the default'))
    .addSubcommand((s) =>
      s.setName('optout').setDescription('Stop being read automatically in the auto-read channel'),
    )
    .addSubcommand((s) =>
      s.setName('optin').setDescription('Be read automatically again in the auto-read channel'),
    )
    .addSubcommand((s) =>
      s
        .setName('preview')
        .setDescription('Play a sample sentence in your current voice (or a specific model)')
        .addStringOption((o) =>
          o
            .setName('model')
            .setDescription('Piper model (optional)')
            .setRequired(false)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('detection')
        .setDescription(
          'Native voice per language (speaker may change). Off by default: one fixed voice.',
        )
        .addBooleanOption((o) =>
          o
            .setName('active')
            .setNameLocalizations({ 'pt-BR': 'ativo' })
            .setDescription(
              'On = native voice per language; Off (default) = your one fixed voice for everything',
            )
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('engine')
            .setNameLocalizations({ 'pt-BR': 'motor' })
            .setDescription(
              'Voice engine: Google (default), Piper, or Kokoro (neural) — often sound better in some languages',
            )
            .setRequired(false)
            .addChoices(
              { name: 'Google (default)', value: 'google' },
              { name: 'Piper', value: 'piper' },
              { name: 'Kokoro (neural)', value: 'kokoro' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('nickname')
        .setDescription('How Vozen should call you out loud (xsaid). Leave empty to clear.')
        .addStringOption((o) =>
          o
            .setName('name')
            .setNameLocalizations({ 'pt-BR': 'nome' })
            .setDescription('Spoken name (empty = use your server name)')
            .setRequired(false)
            .setMaxLength(40),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('effect')
        .setDescription('Apply a voice effect to your messages (💎 = Premium)')
        .addStringOption((o) =>
          o
            .setName('effect')
            .setNameLocalizations({ 'pt-BR': 'efeito' })
            .setDescription('Voice effect (none = clean; 💎 needs Premium)')
            .setRequired(true)
            .addChoices(...EFFECT_CHOICES),
        ),
    )
    // /voice clone — clona a TUA PRÓPRIA voz (consent-first: só gravas a ti, só tu
    // usas o teu clone, apagável a qualquer momento). 💎 Premium.
    .addSubcommandGroup((g) =>
      g
        .setName('clone')
        .setDescription('Clone a voice (💎 Premium, consent-first)')
        .addSubcommand((s) =>
          s
            .setName('record')
            .setDescription(
              'Record a voice in the call to build your clone (yours, or someone who agrees)',
            )
            // STRING + autocomplete (não addUserOption): o seletor nativo de utilizador do
            // Discord só mostra membros em cache/recentes. Aqui listamos EXATAMENTE quem está
            // na call contigo — os únicos alvos válidos (gravar exige estar no canal do bot).
            .addStringOption((o) =>
              o
                .setName('user')
                .setNameLocalizations({ 'pt-BR': 'pessoa' })
                .setDescription(
                  'Whose voice to clone — pick someone in the call (empty = yourself). They must agree.',
                )
                .setRequired(false)
                .setAutocomplete(true),
            )
            .addIntegerOption((o) =>
              o
                .setName('seconds')
                .setNameLocalizations({ 'pt-BR': 'segundos' })
                .setDescription('Seconds of speech to capture (5–30, default 15)')
                .setMinValue(5)
                .setMaxValue(30)
                .setRequired(false),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('use')
            .setDescription('Speak with your cloned voice on/off')
            .addBooleanOption((o) =>
              o
                .setName('active')
                .setNameLocalizations({ 'pt-BR': 'ativo' })
                .setDescription('true = your messages use your cloned voice')
                .setRequired(true),
            ),
        )
        .addSubcommand((s) => s.setName('status').setDescription('Your voice-clone status'))
        .addSubcommand((s) =>
          s.setName('delete').setDescription('Delete your voice sample and clone'),
        ),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Server configuration (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('tts-channel')
        .setDescription('Set the auto-read channel')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setNameLocalizations({ 'pt-BR': 'canal' })
            .setDescription('Text channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('autoread')
        .setDescription('Turn auto-read on/off')
        .addBooleanOption((o) =>
          o
            .setName('active')
            .setNameLocalizations({ 'pt-BR': 'ativo' })
            .setDescription('on/off')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('max-chars')
        .setDescription('Maximum characters per message')
        .addIntegerOption((o) =>
          o
            .setName('value')
            .setNameLocalizations({ 'pt-BR': 'valor' })
            .setDescription('1-2000')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(2000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('rate-limit')
        .setDescription('Messages per minute per user')
        .addIntegerOption((o) =>
          o
            .setName('value')
            .setNameLocalizations({ 'pt-BR': 'valor' })
            .setDescription('1-120')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(120),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('role')
        .setDescription('Restrict auto-read to a role (omit the role to clear the restriction)')
        .addRoleOption((o) =>
          o
            .setName('role')
            .setDescription('Allowed role (empty = no restriction)')
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('enabled')
        .setDescription('Turn TTS on/off on this server (kill-switch)')
        .addBooleanOption((o) =>
          o
            .setName('active')
            .setNameLocalizations({ 'pt-BR': 'ativo' })
            .setDescription('on/off')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('xsaid')
        .setDescription('Announce who spoke before each message ("{name} said …")')
        .addBooleanOption((o) =>
          o
            .setName('active')
            .setNameLocalizations({ 'pt-BR': 'ativo' })
            .setDescription('on/off')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('autojoin')
        .setDescription(
          'Vozen joins your voice channel automatically when you type in the TTS channel',
        )
        .addBooleanOption((o) =>
          o
            .setName('active')
            .setNameLocalizations({ 'pt-BR': 'ativo' })
            .setDescription('on/off')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('read-bots')
        .setNameLocalizations({ 'pt-BR': 'ler-bots' })
        .setDescription('Read messages from other bots and webhooks (off by default)')
        .addBooleanOption((o) =>
          o
            .setName('active')
            .setNameLocalizations({ 'pt-BR': 'ativo' })
            .setDescription('on/off')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('text-in-voice')
        .setNameLocalizations({ 'pt-BR': 'texto-em-voz' })
        .setDescription(
          'Also read the text chat inside the voice channel Vozen is in (off by default)',
        )
        .addBooleanOption((o) =>
          o
            .setName('active')
            .setNameLocalizations({ 'pt-BR': 'ativo' })
            .setDescription('on/off')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('antispam')
        .setNameLocalizations({ 'pt-BR': 'antispam' })
        .setDescription(
          "Don't read spammed messages (mass word repetition or the same big message) (off by default)",
        )
        .addBooleanOption((o) =>
          o
            .setName('active')
            .setNameLocalizations({ 'pt-BR': 'ativo' })
            .setDescription('on/off')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('greet')
        .setDescription('Greet people by name when they join the voice channel (on by default)')
        .addBooleanOption((o) =>
          o
            .setName('active')
            .setNameLocalizations({ 'pt-BR': 'ativo' })
            .setDescription('on/off')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('greet-language')
        .setNameLocalizations({ 'pt-BR': 'idioma-saudacao' })
        .setDescription('Language of the join greeting (English by default)')
        .addStringOption((o) =>
          o
            .setName('language')
            .setNameLocalizations({ 'pt-BR': 'idioma' })
            .setDescription('Greeting language')
            .setRequired(true)
            .addChoices(...GREET_LANGUAGE_CHOICES),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('default-voice')
        .setDescription(
          "Set the server's default voice (used when the user has no voice of their own)",
        )
        .addStringOption((o) =>
          o.setName('model').setDescription('Piper model').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('language')
        .setDescription('Set the interface language (English is the default)')
        // AUTOCOMPLETE (nao choices): suportamos 34 linguas de interface > 25, o cap
        // do Discord para choices estaticas. O ramo `locale` do handleAutocomplete
        // filtra SUPPORTED_LOCALES por endonimo/codigo (LOCALE_DISPLAY_NAMES) e
        // devolve ate 25 sugestoes. O handler valida a escolha contra SUPPORTED_LOCALES.
        .addStringOption((o) =>
          o
            .setName('locale')
            .setDescription('Interface language')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('show').setDescription("Show the server's current configuration"),
    )
    .addSubcommand((s) =>
      s.setName('reset').setDescription("Reset the server's configuration to defaults"),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('blockword')
        .setDescription('Manage the blocklist')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a word')
            .addStringOption((o) =>
              o
                .setName('word')
                .setNameLocalizations({ 'pt-BR': 'palavra' })
                .setDescription('Word to block')
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a word')
            .addStringOption((o) =>
              o
                .setName('word')
                .setNameLocalizations({ 'pt-BR': 'palavra' })
                .setDescription('Word to unblock')
                .setRequired(true),
            ),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('pronunciation')
        .setDescription('Manage the pronunciation dictionary')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add/edit a term')
            .addStringOption((o) =>
              o
                .setName('term')
                .setNameLocalizations({ 'pt-BR': 'termo' })
                .setDescription('Term to replace')
                .setRequired(true)
                .setMaxLength(80),
            )
            .addStringOption((o) =>
              o
                .setName('pronunciation')
                .setNameLocalizations({ 'pt-BR': 'pronuncia' })
                .setDescription('How it should be read')
                .setRequired(true)
                .setMaxLength(200),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a term')
            .addStringOption((o) =>
              o
                .setName('term')
                .setNameLocalizations({ 'pt-BR': 'termo' })
                .setDescription('Term to remove')
                .setRequired(true),
            ),
        )
        .addSubcommand((s) => s.setName('list').setDescription('List the defined terms')),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Guided one-step configuration (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setNameLocalizations({ 'pt-BR': 'canal' })
        .setDescription('Auto-read channel (omit = use the current channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Bot statistics (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('How long Vozen has been online')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('botstats')
    .setDescription('Public Vozen stats: servers, voice sessions, uptime')
    .toJSON(),
  // /game — minijogos de grupo. PUBLICO (sem gate de admin): qualquer um começa um
  // jogo. Guild-only (nao esta em DM_CAPABLE_COMMANDS -> o .map poe contexts:[Guild]).
  // A opcao `game` usa AUTOCOMPLETE (nomes na lingua do utilizador via t()); os
  // subcomandos stop/list/leaderboard nao tem opcoes.
  new SlashCommandBuilder()
    .setName('game')
    .setDescription('Play a minigame with the server')
    .addSubcommand((s) =>
      s
        .setName('play')
        .setDescription('Start a game')
        .addStringOption((o) =>
          o
            .setName('game')
            .setNameLocalizations({ 'pt-BR': 'jogo' })
            // OPCIONAL de propósito (beginner-friendly, plano v4): /game play "vazio"
            // mostra um select menu com os jogos em vez de o Discord exigir a opção.
            .setDescription('Which game to play (leave empty to pick from a menu)')
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName('language')
            .setNameLocalizations({ 'pt-BR': 'idioma' })
            .setDescription('Language for Word Chain (ignored by other games)')
            .setRequired(false)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((s) => s.setName('stop').setDescription('Stop the current game'))
    .addSubcommand((s) => s.setName('list').setDescription('List the available games'))
    .addSubcommand((s) =>
      s.setName('leaderboard').setDescription("Show the server's game leaderboard"),
    )
    .addSubcommand((s) => s.setName('stats').setDescription('Show your own game stats'))
    .toJSON(),
  // Context-menu (botão direito numa mensagem -> Apps -> Speak): lê essa mensagem em
  // voz alta com a voz de quem clicou. Complementa o /tts sem escrever nada.
  new ContextMenuCommandBuilder()
    .setName('Speak')
    .setNameLocalizations({ 'pt-BR': 'Ler em voz alta' })
    .setType(ApplicationCommandType.Message)
    .toJSON(),
];

// Comandos utilizáveis em DM: só devolvem TEXTO e não dependem de guild/voz/store.
const DM_CAPABLE_COMMANDS = new Set(['invite', 'vote', 'help', 'uptime', 'botstats']);

// Todos os OUTROS comandos dependem de uma guild (sessão de voz, config e store
// por-guild). Por defeito o Discord mostra comandos globais também em DM, onde
// `guildId` é null → o handler escrevia no store com guildId null (SqliteError:
// guild_id NOT NULL) ou respondia coisas enganadoras. Restringi-los ao contexto
// Guild faz o Discord ESCONDÊ-LOS em DM. Centralizado por nome (em vez de repetir
// .setContexts() em ~10 builders) para não esquecer nenhum comando novo. Cobre
// também o context-menu "Speak" (precisa de canal de voz).
export const commandDefs: RESTPostAPIApplicationCommandsJSONBody[] = commandDefsRaw.map((def) =>
  DM_CAPABLE_COMMANDS.has(def.name) ? def : { ...def, contexts: [InteractionContextType.Guild] },
);

// Comandos OWNER-ONLY. NÃO entram em commandDefs (global): são registados à parte, como
// comandos de GUILD, só na OWNER_GUILD_ID (registerOwnerCommands). Assim o público nem
// os vê no picker — 1.ª camada de defesa. A 2.ª é o gate por dono no handler.
export const ownerCommandDefs: RESTPostAPIApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder()
    .setName('vozengrant')
    .setDescription('Owner only — grant Vozen Premium/Plus to a user')
    .addUserOption((o) => o.setName('user').setDescription('User to grant to').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('plan')
        .setDescription('What to grant')
        .setRequired(true)
        .addChoices(
          { name: 'Premium (server pass, 3 licences)', value: 'premium' },
          { name: 'Plus (personal, follows the user)', value: 'plus' },
        ),
    )
    .addIntegerOption((o) =>
      o
        .setName('days')
        .setDescription('Duration in days (default 30)')
        .setMinValue(1)
        .setMaxValue(3650),
    )
    .addIntegerOption((o) =>
      o
        .setName('seats')
        .setDescription('Premium only: number of server licences (default 3)')
        .setMinValue(1)
        .setMaxValue(50),
    )
    .toJSON(),
  // /pronunciation — dicionário de pronúncia PESSOAL (só afeta as mensagens de quem o
  // criou; segue o utilizador entre servidores). Limite 3 Free / 50 Premium (Plus ou
  // servidor Premium). `add` sem opções abre um MODAL (beginner-friendly, plano v4).
  new SlashCommandBuilder()
    .setName('pronunciation')
    .setDescription('Teach Vozen how to say a word — only affects YOUR messages')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add or edit a personal pronunciation (leave empty for a form)')
        .addStringOption((o) =>
          o
            .setName('term')
            .setNameLocalizations({ 'pt-BR': 'termo' })
            .setDescription('The word as people type it (e.g. "gg")')
            .setMaxLength(100),
        )
        .addStringOption((o) =>
          o
            .setName('say')
            .setNameLocalizations({ 'pt-BR': 'dizer' })
            .setDescription('How Vozen should say it (e.g. "good game")')
            .setMaxLength(200),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove one of your personal pronunciations')
        .addStringOption((o) =>
          o
            .setName('term')
            .setNameLocalizations({ 'pt-BR': 'termo' })
            .setDescription('The word to remove')
            .setRequired(true)
            .setMaxLength(100),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List your personal pronunciations'))
    .toJSON(),
  // /randomizer — sorteio falado: escolhe o nº de opções (2–5, modal) OU passa uma lista
  // separada por vírgulas; o Vozen escolhe uma ao acaso e di-la na call. Sem opções
  // nenhumas -> select do nº (beginner-friendly).
  new SlashCommandBuilder()
    .setName('randomizer')
    .setDescription('Vozen picks one option at random and says it out loud')
    .addIntegerOption((o) =>
      o
        .setName('amount')
        .setNameLocalizations({ 'pt-BR': 'quantidade' })
        .setDescription('How many options to fill in (2–5, opens a form)')
        .setMinValue(2)
        .setMaxValue(5),
    )
    .addStringOption((o) =>
      o
        .setName('options')
        .setNameLocalizations({ 'pt-BR': 'opcoes' })
        .setDescription('Or type them here, separated by commas (e.g. "pizza, sushi, tacos")')
        .setMaxLength(1000),
    )
    .toJSON(),
];

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
      case 'randomizer':
        return await handleRandomizer(i, deps);
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
