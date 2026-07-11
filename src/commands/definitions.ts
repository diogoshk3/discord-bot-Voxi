// src/commands/definitions.ts
//
// Definições dos comandos (builders -> payload JSON) extraídas do index.ts (DEBT-02):
// o index.ts fica como dispatcher/registry fino. `commandDefsRaw` é o array cru;
// `commandDefs` aplica o gate de contexto (Guild vs DM); `ownerCommandDefs` são os
// comandos OWNER-ONLY registados à parte. Puro/sem estado — só monta payloads.

import {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  PermissionFlagsBits,
  ChannelType,
  InteractionContextType,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import { EFFECT_CHOICES } from '../tts/effects';
import { GREET_LANGUAGE_CHOICES } from '../voice/greeting';

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
    .addStringOption((o) => o.setName('text').setDescription('What to read').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current audio').toJSON(),
  // /shutup — cala o Vozen JÁ: esvazia a fila toda e pára o que está a tocar (sem sair
  // da call). O /skip salta só a mensagem atual; este limpa tudo.
  new SlashCommandBuilder()
    .setName('shutup')
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
        .setDescription('Language of the joke')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addBooleanOption((o) =>
      o.setName('laughter').setDescription('Add laughter at the end?').setRequired(true),
    )
    .toJSON(),
  // /rizz — manda uma pick-up line na LINGUA escolhida (mesmo autocomplete `language` do
  // /joke). `sound` (obrigatorio) toca o efeito sonoro "rizz" no fim. Precisa de call.
  new SlashCommandBuilder()
    .setName('rizz')
    .setDescription('Vozen drops a pickup line in the language you pick (💎 Premium)')
    .addStringOption((o) =>
      o
        .setName('language')
        .setDescription('Language of the pickup line')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addBooleanOption((o) =>
      o.setName('sound').setDescription('Add the rizz sound effect at the end?').setRequired(true),
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
            .setDescription('Day of the month (1–31)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(31),
        )
        .addIntegerOption((o) =>
          o
            .setName('month')
            .setDescription('Month (1–12)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(12),
        ),
    )
    .addSubcommand((s) => s.setName('clear').setDescription('Remove your saved birthday'))
    .addSubcommand((s) => s.setName('show').setDescription('Show your saved birthday'))
    .toJSON(),
  // /privacy — direito ao esquecimento (RGPD / Política do Discord §5(b)): apagar todos
  // os dados pessoais num só comando (com confirmação). O premium pago fica retido.
  new SlashCommandBuilder()
    .setName('privacy')
    .setDescription('Manage your personal data')
    .addSubcommand((s) =>
      s
        .setName('erase')
        .setDescription('Permanently delete all your personal data (asks you to confirm first)'),
    )
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
        .setName('nickname')
        .setDescription('How Vozen should call you out loud (xsaid). Leave empty to clear.')
        .addStringOption((o) =>
          o
            .setName('name')
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
                .setDescription(
                  'Whose voice to clone — pick someone in the call (empty = yourself). They must agree.',
                )
                .setRequired(false)
                .setAutocomplete(true),
            )
            .addIntegerOption((o) =>
              o
                .setName('seconds')
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
            .setDescription('Text channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('autoread')
        .setDescription('Turn auto-read on/off')
        .addBooleanOption((o) => o.setName('active').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('max-chars')
        .setDescription('Maximum characters per message')
        .addIntegerOption((o) =>
          o
            .setName('value')
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
        .addBooleanOption((o) => o.setName('active').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('xsaid')
        .setDescription('Announce who spoke before each message ("{name} said …")')
        .addBooleanOption((o) => o.setName('active').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('autojoin')
        .setDescription(
          'Vozen joins your voice channel automatically when you type in the TTS channel',
        )
        .addBooleanOption((o) => o.setName('active').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('always-on')
        .setDescription(
          '24/7 in-call (💎 Premium): Vozen stays in the voice channel even when empty',
        )
        .addBooleanOption((o) => o.setName('active').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('read-bots')
        .setDescription('Read messages from other bots and webhooks (off by default)')
        .addBooleanOption((o) => o.setName('active').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('text-in-voice')
        .setDescription(
          'Also read the text chat inside the voice channel Vozen is in (off by default)',
        )
        .addBooleanOption((o) => o.setName('active').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('antispam')
        .setDescription(
          "Don't read spammed messages (mass word repetition or the same big message) (off by default)",
        )
        .addBooleanOption((o) => o.setName('active').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('streaks')
        .setDescription('Show the 🔥 daily streak notice when someone speaks (on by default)')
        .addBooleanOption((o) => o.setName('active').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('greet')
        .setDescription('Greet people by name when they join the voice channel (on by default)')
        .addBooleanOption((o) => o.setName('active').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('greet-language')
        .setDescription('Language of the join greeting (English by default)')
        .addStringOption((o) =>
          o
            .setName('language')
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
              o.setName('word').setDescription('Word to block').setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a word')
            .addStringOption((o) =>
              o.setName('word').setDescription('Word to unblock').setRequired(true),
            ),
        ),
    )
    // NB: o antigo subgrupo `pronunciation` (dicionário de servidor) foi REMOVIDO no
    // plano v4 — as pronúncias agora são só PESSOAIS via /pronunciation (individual).
    .toJSON(),
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Guided one-step configuration (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName('channel')
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
            // OPCIONAL de propósito (beginner-friendly, plano v4): /game play "vazio"
            // mostra um select menu com os jogos em vez de o Discord exigir a opção.
            .setDescription('Which game to play (leave empty to pick from a menu)')
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName('language')
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
            .setDescription('The word as people type it (e.g. "gg")')
            .setMaxLength(100),
        )
        .addStringOption((o) =>
          o
            .setName('say')
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
            .setDescription('The word to remove')
            .setRequired(true)
            .setMaxLength(100),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List your personal pronunciations'))
    .toJSON(),
  // /serverpronunciation — dicionário de pronúncia do SERVIDOR (admin): aplica-se às
  // mensagens de TODA a gente. Limite 3 Free / 50 Premium. `add` sem opções abre um modal.
  new SlashCommandBuilder()
    .setName('serverpronunciation')
    .setDescription('Server-wide pronunciations for everyone (admin, 3 · 50 with Premium)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add or edit a server pronunciation (leave empty for a form)')
        .addStringOption((o) =>
          o.setName('term').setDescription('The word as people type it').setMaxLength(100),
        )
        .addStringOption((o) =>
          o.setName('say').setDescription('How Vozen should say it for everyone').setMaxLength(200),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove one of the server pronunciations')
        .addStringOption((o) =>
          o
            .setName('term')
            .setDescription('The word to remove')
            .setRequired(true)
            .setMaxLength(100),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription("List the server's pronunciations"))
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
        .setDescription('How many options to fill in (2–5, opens a form)')
        .setMinValue(2)
        .setMaxValue(5),
    )
    .addStringOption((o) =>
      o
        .setName('options')
        .setDescription('Or type them here, separated by commas (e.g. "pizza, sushi, tacos")')
        .setMaxLength(1000),
    )
    .toJSON(),
  // Context-menu (botão direito numa mensagem -> Apps -> Speak): lê essa mensagem em
  // voz alta com a voz de quem clicou. Complementa o /tts sem escrever nada.
  new ContextMenuCommandBuilder().setName('Speak').setType(ApplicationCommandType.Message).toJSON(),
  // /redeem — PÚBLICO: resgata um código de presente (gerado pelo dono com /gencode).
  // Concede Plus ou um passe Premium à conta de quem resgata (não a um servidor), por
  // isso é DM-capable. Uso único; ver store/premiumCode.ts.
  new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a Vozen gift code')
    .addStringOption((o) =>
      o.setName('code').setDescription('Your gift code (e.g. VOZEN-XXXX-XXXX)').setRequired(true),
    )
    .toJSON(),
];

// Comandos utilizáveis em DM: só devolvem TEXTO e não dependem de guild/voz/store.
// (/redeem também: concede à CONTA de quem resgata, não a um servidor.)
const DM_CAPABLE_COMMANDS = new Set(['invite', 'vote', 'help', 'uptime', 'botstats', 'redeem']);

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
          { name: 'Premium (server pass — set licences below)', value: 'premium' },
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
  // /gencode — OWNER-ONLY: gera código(s) de presente que o dono dá a quem quiser. Mesma
  // defesa em profundidade do /vozengrant (só registado na OWNER_GUILD_ID + gate por dono
  // no handler). Resgatam-se com /redeem (público). `plan` escolhe Plus vs passe Premium.
  new SlashCommandBuilder()
    .setName('gencode')
    .setDescription('Owner only — generate Vozen gift code(s)')
    .addStringOption((o) =>
      o
        .setName('plan')
        .setDescription('What the code grants')
        .setRequired(true)
        .addChoices(
          { name: 'Premium (server pass)', value: 'premium' },
          { name: 'Plus (personal, follows the user)', value: 'plus' },
        ),
    )
    .addIntegerOption((o) =>
      o
        .setName('days')
        .setDescription('Premium duration in days (default 30)')
        .setMinValue(1)
        .setMaxValue(3650),
    )
    .addIntegerOption((o) =>
      o
        .setName('seats')
        .setDescription('Premium only: server licences (default 3)')
        .setMinValue(1)
        .setMaxValue(50),
    )
    .addIntegerOption((o) =>
      o
        .setName('amount')
        .setDescription('How many codes to generate (default 1)')
        .setMinValue(1)
        .setMaxValue(20),
    )
    .addIntegerOption((o) =>
      o
        .setName('expires_days')
        .setDescription('Optional: code expires after this many days')
        .setMinValue(1)
        .setMaxValue(3650),
    )
    .toJSON(),
];
