import {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  GuildMember,
  Guild,
  ChannelType,
  MessageFlags,
  InteractionContextType,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import { metrics } from '../metrics';
import { joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import type { BotDeps } from '../bot/deps';
import { getPlayer, removePlayer, getLimiter } from '../bot/deps';
import { brandEmbed, rankMedal } from '../ui/theme';
import { GuildVoicePlayer } from '../voice/player';
import { createVoiceSession, becomeSpeakerIfStage } from '../voice/session';
import { getUserVoice, setUserVoice, resetUserVoice } from '../store/userVoice';
import { getGuildConfig, setGuildConfig, resetGuildConfig } from '../store/guildConfig';
import { addBlockword, removeBlockword, getBlocklist } from '../store/blocklist';
import { setOptOut, setOptIn } from '../store/optout';
import { setNickname, clearNickname } from '../store/nickname';
import { getBirthday, setBirthday, clearBirthday, isValidBirthday } from '../store/birthday';
import { getTopSpeakers } from '../store/talkStats';
import {
  redeemCode,
  getGuildPremiumExpiry,
  getUserPremiumExpiry,
  isGuildPremium,
  isUserPremium,
} from '../store/premium';
import { getVoiceEffect, setVoiceEffect } from '../store/voiceEffect';
import {
  EFFECT_CHOICES,
  isVoiceEffect,
  isPremiumEffect,
  effectLabel,
  type VoiceEffect,
} from '../tts/effects';
import { sanitizeSpeakerName } from '../language/speakerName';
import { isDetectionOn, setDetection } from '../store/langDetect';
import {
  getPronunciations,
  addPronunciation,
  removePronunciation,
} from '../store/pronunciation';
import { cleanText, collectUrlMedia, collectMarkdownMedia } from '../textCleaning/clean';
import { prepareSpeech, redactRequest, hasReadableText } from './prepareSpeech';
import { recallLang, rememberLang } from '../language/langMemory';
import type { SynthRequest } from '../tts/engine';
import { voiceDisplayName, formatVoiceList, makeLocalizedNamer } from '../language/voiceMap';
import { laughterFor } from '../content/laughter';
import { JOKE_LANGUAGES, jokeLangByKey, pickJoke } from '../content/jokes';
import {
  funLocaleOf,
  pickEightball,
  pickFortune,
  pickFact,
  pickWyr,
  type FunLocale,
} from '../content/microfun';
import { GAME_DEFS, gameById, filterGameChoices, filterWordChainLanguages } from '../games/index';
import { getLeaderboard, getUserScore, getUserRank } from '../store/gameScore';
import { GREET_LANGUAGE_CHOICES, GREET_LOCALES } from '../voice/greeting';
import { log } from '../logging/logger';
import { join, dirname } from 'node:path';
import { unlinkSync } from 'node:fs';
import { getClone, saveClone, setCloneEnabled, deleteClone, deleteClonesByTarget } from '../store/voiceClone';
import { recordUserSample, pcmToWavFile } from '../voice/recorder';
import {
  t,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  LOCALE_DISPLAY_NAMES,
  type SupportedLocale,
} from '../i18n/index';

/**
 * Locale da INTERFACE para uma interacao. Le `guild_config.locale` da guild; em
 * DMs (guildId null) ou se a leitura falhar por qualquer motivo, devolve
 * DEFAULT_LOCALE ('en'). NUNCA lanca — uma falha a ler a config nunca deve partir
 * a resposta/erro que o utilizador recebe (isto e chamado inclusive no catch de
 * handleInteraction). Colapsa o padrao repetido `i.guildId ? ...locale : 'en'`.
 */
function localeFor(deps: BotDeps, guildId: string | null | undefined): string {
  if (!guildId) return DEFAULT_LOCALE;
  try {
    return getGuildConfig(deps.db, guildId).locale;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * Locale da INTERFACE para uma resposta PER-UTILIZADOR (ephemeral). O Discord
 * envia o idioma do CLIENTE de quem clicou em `interaction.locale` (ex. 'pt-BR',
 * 'en-US', 'es-ES'); assim cada utilizador ve a UI na SUA lingua, sem depender do
 * locale configurado na guild.
 *
 * Resolucao (nunca lanca — como localeFor):
 *   1. Normaliza `interaction.locale` para o codigo base: parte antes do '-' em
 *      minusculas ('pt-BR'->'pt', 'en-US'->'en', 'es-419'->'es', 'zh-CN'->'zh',
 *      'sv-SE'->'sv'; um codigo ja base como 'fr' mapeia para si proprio). Uma
 *      regra generica cobre TODAS as variantes do Discord — sem casos especiais.
 *   2. Se o codigo base estiver em SUPPORTED_LOCALES -> usa-o.
 *   3. Senao (lingua do Discord que ainda nao suportamos, ou locale ausente) ->
 *      cai no locale configurado da GUILD (localeFor), que por sua vez cai em
 *      DEFAULT_LOCALE. Assim /config language continua a ser o fallback partilhado.
 */
export function localeForUser(
  deps: BotDeps,
  interaction: { locale?: string | null; guildId?: string | null },
): string {
  const raw = interaction?.locale;
  if (raw) {
    const base = raw.split('-')[0].toLowerCase();
    if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
      return base;
    }
  }
  // Lingua do Discord nao suportada / ausente -> fallback para a guild (e default).
  return localeFor(deps, interaction?.guildId);
}

/**
 * Permissoes minimas que o Vozen precisa no servidor onde for convidado, derivadas
 * dos 5 bits nomeados via PermissionsBitField (NAO um numero magico):
 *  - Connect/Speak       -> entrar e falar nos canais de voz (o core do bot)
 *  - ViewChannel         -> ver os canais (texto e voz)
 *  - SendMessages        -> responder no canal de texto
 *  - ReadMessageHistory  -> ler o historico do canal de auto-leitura
 * Exportado como string (representacao do bigint) porque e isso que o parametro
 * `permissions` do URL OAuth2 espera. Derivado e testavel: o teste recomputa o
 * mesmo inteiro a partir dos bits, por isso deixar cair um bit aqui parte o teste.
 */
export const INVITE_PERMISSIONS: string = new PermissionsBitField([
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  // EmbedLinks: o bot responde quase tudo em EMBEDS (ajuda, stats, jogos, setup).
  // Sem esta permissão o Discord NÃO renderiza os embeds do bot em canais onde o
  // @everyone não a tenha. Reações/anexos NÃO entram: o código não usa .react() nem
  // envia ficheiros (auditado).
  PermissionFlagsBits.EmbedLinks,
])
  .bitfield.toString();

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
  new SlashCommandBuilder()
    .setName('help')
    .setDescription("Show Vozen's command list")
    .toJSON(),
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
  new SlashCommandBuilder()
    .setName('fortune')
    .setDescription('Vozen reads you a fortune')
    .toJSON(),
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
  // /premium — estado da assinatura + como obter. /redeem — resgatar um código.
  new SlashCommandBuilder()
    .setName('premium')
    .setDescription('See this server’s Vozen Premium status')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a Vozen Premium/Plus code')
    .addStringOption((o) =>
      o
        .setName('code')
        .setNameLocalizations({ 'pt-BR': 'codigo' })
        .setDescription('Your redeem code (VOZEN-XXXX-XXXX-XXXX)')
        .setRequired(true)
        .setMaxLength(40),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Manage your voice')
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set your voice')
        .addStringOption((o) => o.setName('model').setDescription('Piper model').setRequired(true).setAutocomplete(true))
        .addNumberOption((o) => o.setName('speed').setDescription('Speed (0.5-2.0)').setRequired(false))
        .addStringOption((o) =>
          o
            .setName('engine')
            .setNameLocalizations({ 'pt-BR': 'motor' })
            .setDescription('Voice engine: Google (default) or Piper')
            .setRequired(false)
            .addChoices(
              { name: 'Google (default)', value: 'google' },
              { name: 'Piper', value: 'piper' },
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
        .setDescription('Native voice per language (speaker may change). Off by default: one fixed voice.')
        .addBooleanOption((o) =>
          o
            .setName('active')
            .setNameLocalizations({ 'pt-BR': 'ativo' })
            .setDescription('On = native voice per language; Off (default) = your one fixed voice for everything')
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('engine')
            .setNameLocalizations({ 'pt-BR': 'motor' })
            .setDescription('Voice engine: Google (default) or Piper — Piper often sounds better in some languages')
            .setRequired(false)
            .addChoices(
              { name: 'Google (default)', value: 'google' },
              { name: 'Piper', value: 'piper' },
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
            .setDescription('Record a voice in the call to build your clone (yours, or someone who agrees)')
            // STRING + autocomplete (não addUserOption): o seletor nativo de utilizador do
            // Discord só mostra membros em cache/recentes. Aqui listamos EXATAMENTE quem está
            // na call contigo — os únicos alvos válidos (gravar exige estar no canal do bot).
            .addStringOption((o) =>
              o
                .setName('user')
                .setNameLocalizations({ 'pt-BR': 'pessoa' })
                .setDescription('Whose voice to clone — pick someone in the call (empty = yourself). They must agree.')
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
          o.setName('role').setDescription('Allowed role (empty = no restriction)').setRequired(false),
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
        .setDescription('Vozen joins your voice channel automatically when you type in the TTS channel')
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
        .setDescription("Also read the text chat inside the voice channel Vozen is in (off by default)")
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
        .setDescription("Set the server's default voice (used when the user has no voice of their own)")
        .addStringOption((o) => o.setName('model').setDescription('Piper model').setRequired(true).setAutocomplete(true)),
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
    .addSubcommand((s) => s.setName('show').setDescription("Show the server's current configuration"))
    .addSubcommand((s) => s.setName('reset').setDescription("Reset the server's configuration to defaults"))
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
            .setDescription('Which game to play')
            .setRequired(true)
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
  DM_CAPABLE_COMMANDS.has(def.name)
    ? def
    : { ...def, contexts: [InteractionContextType.Guild] },
);

async function reply(i: ChatInputCommandInteraction, content: string): Promise<void> {
  await i.reply({ content, flags: MessageFlags.Ephemeral });
}

/**
 * Resultado (discriminado) de tentar juntar o Vozen ao canal de voz do invocador.
 * NAO contem texto de UI — quem chama e que renderiza a mensagem (via t()), para
 * que uma unica interacao produza uma unica resposta. Isto e o que permite
 * partilhar a logica entre /join (que responde) e /setup (que dobra o resultado
 * no seu checklist), sem arriscar um duplo-reply na mesma interacao.
 */
export type JoinOutcome =
  | { status: 'no-channel' }
  | { status: 'missing-perms'; channelName: string }
  | { status: 'joined'; channelName: string };

/**
 * Logica PARTILHADA de "entrar no canal de voz do invocador", extraida do antigo
 * handleJoin para poder ser reutilizada pelo /setup (onboarding guiado). Efeitos:
 * verifica Connect/Speak, (re)cria o player e a conexao. NAO responde a interacao
 * — devolve um JoinOutcome que o chamador traduz. Contrato preservado:
 *  - sem canal de voz            -> { status: 'no-channel' } (nao mexe no player)
 *  - faltam Connect/Speak        -> { status: 'missing-perms' } (nao destroi o player existente)
 *  - ok                          -> junta-se e devolve { status: 'joined' }
 */
export function joinUserVoice(i: ChatInputCommandInteraction, deps: BotDeps): JoinOutcome {
  const member = i.member as GuildMember;
  const channel = member?.voice?.channel;
  if (!channel) {
    return { status: 'no-channel' };
  }
  // Verificar permissoes Connect/Speak ANTES de tocar no player existente: um
  // /join para um canal proibido nao deve destruir um player que ja funciona.
  const me = deps.client.user;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms || !perms.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
    return { status: 'missing-perms', channelName: channel.name };
  }
  // Cria a sessão via helper partilhado (mesma lógica do autojoin). O guard de
  // identidade no onIdle vive lá.
  createVoiceSession(deps, i.guildId!, channel.id, i.guild!.voiceAdapterCreator);
  becomeSpeakerIfStage(channel); // no-op se não for um canal de palco
  return { status: 'joined', channelName: channel.name };
}

async function handleJoin(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const outcome = joinUserVoice(i, deps);
  switch (outcome.status) {
    case 'no-channel':
      await reply(i, t('join.needVoiceChannel', locale));
      return;
    case 'missing-perms':
      await reply(i, t('join.missingPerms', locale, { channel: outcome.channelName }));
      return;
    case 'joined':
      // Anúncio PÚBLICO (todos no canal veem que o Vozen entrou, como um bot de TTS
      // faz) — NÃO ephemeral. Na língua da GUILD (localeFor), porque é uma mensagem
      // para toda a gente, não só para quem invocou. Os erros acima ficam ephemeral
      // (são feedback para o invocador). `i.reply` sem flags = mensagem pública.
      await i.reply({ content: t('join.joined', localeFor(deps, i.guildId), { channel: outcome.channelName }) });
      return;
  }
}

async function handleLeave(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  removePlayer(deps, i.guildId!);
  getVoiceConnection(i.guildId!)?.destroy();
  await reply(i, t('leave.left', localeForUser(deps, i)));
}

/** Resultado (discriminado) de tentar LER um texto em voz alta com a voz do user. */
type SpeakOutcome =
  | { status: 'no-player' }
  | { status: 'rate-limited' }
  | { status: 'empty' }
  | { status: 'blocked' }
  | { status: 'queued' }
  | { status: 'busy' };

/**
 * Pipeline PARTILHADO "ler `raw` em voz alta com a voz do user", extraído do /tts para
 * ser reutilizado pelo context-menu "Speak". Faz TUDO (gating de player, rate-limit,
 * limpeza, media, gírias/pronúncia, escolha de voz, blocklist, say) MENOS responder à
 * interação — devolve um SpeakOutcome que o chamador traduz. Assim /tts e "Speak"
 * partilham o comportamento sem divergir.
 */
async function speakRawText(
  deps: BotDeps,
  guildId: string,
  userId: string,
  guild: Guild,
  raw: string,
): Promise<SpeakOutcome> {
  const player = getPlayer(deps, guildId);
  if (!player) return { status: 'no-player' };
  const cfg = getGuildConfig(deps.db, guildId);
  const rl = getLimiter(deps, guildId, cfg.ratePerMin);
  if (!rl.allow(userId, Date.now())) return { status: 'rate-limited' };

  const cleaned = cleanText(raw, {
    maxChars: cfg.maxChars,
    resolveUser: (id: string) =>
      guild.members.cache.get(id)?.displayName ??
      deps.client.users.cache.get(id)?.username ??
      'alguem',
    resolveChannel: (id: string) => {
      const ch = guild.channels.cache.get(id);
      return ch && 'name' in ch ? (ch.name as string) : 'canal';
    },
  });
  const media = [...collectUrlMedia(raw), ...collectMarkdownMedia(raw)];
  if (!/[\p{L}\p{N}]/u.test(cleaned) && media.length === 0) return { status: 'empty' };

  const userVoice = getUserVoice(deps.db, guildId, userId);
  const auto = isDetectionOn(deps.db, guildId, userId);
  const recentLang = recallLang(guildId, userId);
  const { req, learnedLang } = prepareSpeech({
    personal: cleaned,
    pronunciations: getPronunciations(deps.db, guildId),
    userVoice,
    available: deps.availableModels,
    guildDefaultVoice: cfg.defaultVoice,
    defaultVoice: deps.config.defaultVoice,
    defaultSpeed: deps.config.defaultSpeed,
    autoDetect: auto,
    recentLang,
    media: media.map((kind) => ({ kind })),
  });
  if (learnedLang) rememberLang(guildId, userId, learnedLang);
  // Motor escolhido pelo user (google default | piper) — usado pelo PerUserEngineRouter.
  req.engine = userVoice?.engine;

  // Blocklist: REDIGE as palavras bloqueadas (o Vozen lê o resto sem as dizer). Só devolve
  // 'blocked' se, depois de as remover, não sobrar nada legível (era só palavra bloqueada).
  const blocklist = getBlocklist(deps.db, guildId);
  const redacted = redactRequest(req, blocklist);
  const readable =
    hasReadableText(redacted.text) || (redacted.segments?.some((s) => hasReadableText(s.text)) ?? false);
  if (!readable) return { status: 'blocked' };
  const outReq = redacted;
  outReq.effect = getVoiceEffect(deps.db, guildId, userId); // efeito de voz (premium)
  const cloneRow = getClone(deps.db, userId); // clone de voz (premium)
  if (cloneRow?.enabled) outReq.cloneRef = cloneRow.samplePath;
  if (deps.config.messageLeadMs > 0) outReq.leadSilenceMs = deps.config.messageLeadMs;
  const queued = await player.say(outReq);
  return { status: queued ? 'queued' : 'busy' };
}

/** Traduz um SpeakOutcome na mensagem (ephemeral) a mostrar ao user. */
function speakOutcomeMessage(outcome: SpeakOutcome, locale: string): string {
  switch (outcome.status) {
    case 'no-player':
      return t('tts.notInVoice', locale);
    case 'rate-limited':
      return t('tts.tooFast', locale);
    case 'empty':
      return t('tts.nothingAfterClean', locale);
    case 'blocked':
      return t('tts.blocked', locale);
    case 'busy':
      return t('tts.busy', locale);
    case 'queued':
      return t('tts.queued', locale);
  }
}

async function handleTts(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  // A sintese pode demorar ate ~15s; defer imediato para nao perder o token (3s).
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const locale = localeForUser(deps, i);
  const raw = i.options.getString('text', true).trim();
  if (!raw) {
    await i.editReply(t('tts.nothingToRead', locale));
    return;
  }
  const outcome = await speakRawText(deps, i.guildId!, i.user.id, i.guild!, raw);
  await i.editReply(speakOutcomeMessage(outcome, locale));
}

/**
 * Context-menu "Speak" (botão direito numa mensagem -> Apps -> Speak): lê essa mensagem
 * em voz alta com a voz de quem clicou. Mesmo pipeline do /tts (speakRawText), mas o
 * texto vem da mensagem-alvo em vez de um argumento.
 */
export async function handleMessageContextMenu(
  i: MessageContextMenuCommandInteraction,
  deps: BotDeps,
): Promise<void> {
  if (i.commandName !== 'Speak') return;
  const locale = localeForUser(deps, i);
  // Ao contrário dos comandos slash (todos protegidos pelo try/catch de
  // handleInteraction), o context-menu é despachado direto em client.ts com
  // `void handleMessageContextMenu(...)` — SEM catch. Sem este try/catch, um throw
  // no speakRawText deixava o utilizador preso em "Vozen is thinking…" para sempre
  // (o deferReply nunca era editado) + unhandledRejection. Espelha o catch do slash.
  try {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (!i.guildId || !i.guild) {
      await i.editReply(t('error.generic', locale));
      return;
    }
    const raw = (i.targetMessage.content ?? '').trim();
    if (!raw) {
      await i.editReply(t('speak.emptyMessage', locale));
      return;
    }
    const outcome = await speakRawText(deps, i.guildId, i.user.id, i.guild, raw);
    await i.editReply(speakOutcomeMessage(outcome, locale));
  } catch (err) {
    log.error('[speak] erro no context-menu Speak:', err);
    if (!i.isRepliable()) return;
    const msg = t('error.generic', locale);
    if (i.deferred && !i.replied) {
      await i.editReply({ content: msg }).catch(() => {});
    } else if (!i.replied) {
      await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

async function handleSkip(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await reply(i, t('skip.notInVoice', locale));
    return;
  }
  // Ha player, mas pode estar parado (nada a tocar nem na fila). Ler isActive()
  // ANTES de skip() — skip() faria stop()/emit(Idle) e distorceria o estado — para
  // nao fingir que saltou algo quando nao havia nada. skip.notInVoice cobre o
  // "sem player de todo"; skip.nothing cobre "ha player mas esta parado".
  if (!player.isActive()) {
    await reply(i, t('skip.nothing', locale));
    return;
  }
  player.skip();
  await reply(i, t('skip.skipped', locale));
}

/** /shutup — cala o Vozen já: esvazia a fila e pára o que está a tocar (fica na call). */
async function handleShutup(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await reply(i, t('shutup.notInVoice', locale));
    return;
  }
  // Ler isActive() ANTES de silence() (silence faz stop()/emit(Idle) e distorceria o
  // estado): distingue "não havia nada a falar" de "calei mesmo".
  if (!player.isActive()) {
    await reply(i, t('shutup.nothing', locale));
    return;
  }
  player.silence();
  await reply(i, t('shutup.done', locale));
}

/**
 * Prefixo de locale a partir de um nome de modelo Piper: a parte inicial ate ao
 * primeiro '_' inclusive (ex. 'en_US-amy-medium' -> 'en_', 'pt_PT-tugao' -> 'pt_').
 * Se nao houver '_', devolve '' (o laughterFor cai no fallback "hahaha"). PURO.
 * E o MESMO formato de prefixo usado em LANG_TO_PREFIX / pickVoice, para que
 * laughterFor(prefix) e a escolha de voz falem a mesma lingua.
 */
export function localePrefixOf(model: string): string {
  const us = model.indexOf('_');
  return us === -1 ? '' : model.slice(0, us + 1);
}

/**
 * /laugh — o Vozen ri na voz ATUALMENTE selecionada pelo utilizador. Por-utilizador
 * (como /tts), sem gate de admin, mas exige um player ativo (user numa call). A voz
 * e RESOLVIDA por precedencia (voz do user > default da guild > .env) e o riso e
 * escolhido pela LINGUA dessa voz (nao por deteccao) — por isso construimos o
 * SynthRequest DIRETAMENTE, sem passar por resolveSynth/detectLang (mesma logica do
 * /voice preview: a lingua e conhecida, nao detetada).
 */
async function handleLaugh(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  // A sintese pode demorar; defer imediato para nao perder o token (3s).
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const locale = localeForUser(deps, i);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await i.editReply(t('tts.notInVoice', locale));
    return;
  }
  const cfg = getGuildConfig(deps.db, i.guildId!);

  // rate-limit por-utilizador (MESMO limiter do /tts): sem isto o /laugh enfileirava
  // sem limite -> vetor de spam da fila de voz. Corre APOS o deferReply para o
  // editReply funcionar.
  const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
  if (!rl.allow(i.user.id, Date.now())) {
    await i.editReply(t('tts.tooFast', locale));
    return;
  }

  const stored = getUserVoice(deps.db, i.guildId!, i.user.id);
  // Precedencia da voz: voz guardada do user > default_voice da guild > .env > amy.
  const model =
    stored?.model || cfg.defaultVoice || deps.config.defaultVoice || 'en_US-amy-medium';
  const speed = stored?.speed ?? deps.config.defaultSpeed;
  // singleVoice: a voz e DELIBERADAMENTE escolhida (a voz atual do user); a deteccao
  // nunca deve sobrepor-se nem partir o riso por lingua.
  const req: SynthRequest = {
    text: laughterFor(localePrefixOf(model)),
    model,
    speed,
    singleVoice: true,
    engine: stored?.engine, // ri no MESMO motor que o user escolheu
  };
  // say() devolve false quando a fila esta no cap: nesse caso reutilizamos tts.busy.
  const queued = await player.say(req);
  await i.editReply(queued ? t('laugh.playing', locale) : t('tts.busy', locale));
}

/**
 * Pausa (ms) entre a piada e o riso no /joke. O riso e uma fala SEPARADA que leva
 * este valor em `leadSilenceMs` (silencio PREPENDido), criando um intervalo real —
 * o Vozen fala a piada, espera ~1s, e SO DEPOIS ri.
 */
const JOKE_LAUGH_PAUSE_MS = 1000;

/**
 * /joke — conta uma piada curta na LINGUA escolhida (`idioma`, autocomplete). A voz
 * e escolhida pela LINGUA (primeiro modelo de deps.availableModels cujo nome comeca
 * pelo prefixo da lingua; se nenhum, cai no default da guild/.env). Se `risos` for
 * true, acrescenta o riso dessa lingua no fim. Como a lingua e CONHECIDA (escolhida,
 * nao detetada), construimos o SynthRequest diretamente — sem resolveSynth/detectLang
 * (mesma logica do /voice preview e do /laugh).
 */
async function handleJoke(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const locale = localeForUser(deps, i);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await i.editReply(t('tts.notInVoice', locale));
    return;
  }
  const langKey = i.options.getString('language', true);
  const lang = jokeLangByKey(langKey);
  if (!lang) {
    await i.editReply(t('joke.unknownLang', locale));
    return;
  }
  const risos = i.options.getBoolean('laughter', true);

  // Voz para a lingua escolhida: 1.º modelo instalado com o prefixo; se nao houver
  // (a lingua nao tem modelo instalado), cai no default da guild / .env / amy.
  const cfg = getGuildConfig(deps.db, i.guildId!);

  // rate-limit por-utilizador (MESMO limiter do /tts): sem isto o /joke enfileirava
  // sem limite -> vetor de spam da fila de voz. Corre APOS o deferReply para o
  // editReply funcionar.
  const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
  if (!rl.allow(i.user.id, Date.now())) {
    await i.editReply(t('tts.tooFast', locale));
    return;
  }

  const model =
    deps.availableModels.find((m) => m.startsWith(lang.prefix)) ||
    cfg.defaultVoice ||
    deps.config.defaultVoice ||
    'en_US-amy-medium';

  // O MODELO (voz) do /joke é escolhido pela LÍNGUA, mas o MOTOR (google/piper) deve
  // seguir a escolha do utilizador — tal como /laugh e /voice preview. Sem isto, um
  // user de Piper ouvia as piadas no Google (inconsistente com tudo o resto).
  const stored = getUserVoice(deps.db, i.guildId!, i.user.id);
  const engine = stored?.engine;

  // pickJoke e PURO/seeded; em runtime usamos Date.now() como seed (variedade sem
  // sacrificar a testabilidade determinista da funcao).
  const joke = pickJoke(langKey, Date.now());
  const speed = deps.config.defaultSpeed;

  // Enfileira SEMPRE a piada sozinha primeiro. O reply baseia-se NESTA fala: se a
  // fila estiver cheia (say false), respondemos busy e nao enfileiramos o riso.
  // singleVoice: a lingua da piada e CONHECIDA (escolhida), a deteccao nao manda.
  const queued = await player.say({ text: joke, model, speed, singleVoice: true, engine });

  // Se `risos` E a piada entrou na fila, enfileira o RISO como fala SEPARADA com uma
  // pausa real de 2s A FRENTE (leadSilenceMs). Assim o Vozen fala a piada, PAUSA ~2s,
  // e SO DEPOIS ri (em vez de rir colado ao fim da piada, como antes). O riso e
  // best-effort: se a fila enche entretanto, simplesmente nao ri (o reply ja reflete
  // a piada). Duas fila-items: um /skip durante a piada nao apanha o riso — aceitavel.
  if (queued && risos) {
    await player.say({
      text: laughterFor(lang.prefix),
      model,
      speed,
      engine,
      leadSilenceMs: JOKE_LAUGH_PAUSE_MS,
      // singleVoice: sem isto, um edge-case multi-script perderia o leadSilenceMs
      // (o caminho por-segmento chama base.synth sem ele). A lingua e conhecida.
      singleVoice: true,
    });
  }

  // Confirmacao inclui a piada escrita (o user ve o que esta a ser lido).
  await i.editReply(queued ? t('joke.playing', locale, { joke }) : t('tts.busy', locale));
}

/**
 * /topspeakers — ranking público de quem teve mais mensagens LIDAS pelo Vozen nesta guild,
 * com o streak (dias seguidos a falar) de cada um. Mesma renderização do game leaderboard
 * (<@id> + linhas i18n). Vazio -> mensagem a convidar a falar.
 */
async function handleTopSpeakers(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const rows = getTopSpeakers(deps.db, i.guildId!, 10);
  if (rows.length === 0) {
    await reply(i, t('topspeakers.empty', locale));
    return;
  }
  const lines = rows.map((r, idx) =>
    t('topspeakers.line', locale, {
      rank: idx + 1,
      user: r.userId,
      count: r.count,
      streak: r.streak,
    }),
  );
  await i.reply({ content: `${t('topspeakers.title', locale)}\n${lines.join('\n')}` });
}

/** /premium — estado das assinaturas (servidor + próprio utilizador) + como obter. */
async function handlePremium(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const now = Date.now();
  // Discord renderiza <t:SEGUNDOS:D> como data localizada por-utilizador.
  const stamp = (ms: number): string => `<t:${Math.floor(ms / 1000)}:D>`;

  const gExp = getGuildPremiumExpiry(deps.db, i.guildId!);
  const uExp = getUserPremiumExpiry(deps.db, i.user.id);
  const gActive = gExp !== null && gExp > now;
  const uActive = uExp !== null && uExp > now;

  const serverLine = gActive
    ? t('premium.lineServerActive', locale, { date: stamp(gExp) })
    : t('premium.lineServerFree', locale);
  const youLine = uActive
    ? t('premium.lineUserActive', locale, { date: stamp(uExp) })
    : t('premium.lineUserFree', locale);

  // Cartão de marca: dourado quando há Premium ativo (servidor ou user), blurple senão.
  const desc = [serverLine, youLine];
  // Só mostra o "como obter" quando NENHUM dos dois está ativo (senão é ruído).
  if (!gActive && !uActive) desc.push('', t('premium.getHint', locale));
  const embed = brandEmbed(gActive || uActive ? 'premium' : 'brand')
    .setTitle(t('premium.title', locale))
    .setDescription(desc.join('\n'));
  await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** /redeem <code> — resgata um código de Premium (servidor) ou Plus (utilizador). */
async function handleRedeem(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const code = i.options.getString('code', true).trim().toUpperCase();
  const res = redeemCode(
    deps.db,
    code,
    { guildId: i.guildId ?? undefined, userId: i.user.id },
    Date.now(),
  );
  if (res.status === 'invalid') {
    await reply(i, t('redeem.invalid', locale));
    return;
  }
  if (res.status === 'used') {
    await reply(i, t('redeem.used', locale));
    return;
  }
  const target = res.kind === 'guild' ? t('redeem.targetServer', locale) : t('redeem.targetYou', locale);
  await reply(i, t('redeem.ok', locale, { target, date: `<t:${Math.floor(res.expiresAt! / 1000)}:D>` }));
}

type MicroFunKind = '8ball' | 'fortune' | 'fact' | 'wyr';

/**
 * Micro-comandos divertidos (/8ball, /fortune, /fact, /wyr): escolhem uma frase do banco
 * na LÍNGUA DA UI do utilizador (EN/PT) e respondem PUBLICAMENTE em texto; se o Vozen
 * estiver na call, também a FALA (voz da língua da frase, motor do utilizador). Ao
 * contrário do /joke, funcionam FORA de uma call (texto na mesma). A fala é best-effort e
 * rate-limited (mesmo limiter do /tts): rate-limit -> texto na mesma, sem falar.
 */
async function handleMicroFun(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
  kind: MicroFunKind,
): Promise<void> {
  await i.deferReply();
  const locale = localeForUser(deps, i);
  const funLoc: FunLocale = funLocaleOf(locale);
  const seed = Date.now();

  let spoken: string;
  let replyText: string;
  switch (kind) {
    case '8ball': {
      const question = i.options.getString('question', true);
      spoken = pickEightball(funLoc, seed);
      replyText = t('fun.eightball', locale, { question, answer: spoken });
      break;
    }
    case 'fortune':
      spoken = pickFortune(funLoc, seed);
      replyText = t('fun.fortune', locale, { text: spoken });
      break;
    case 'fact':
      spoken = pickFact(funLoc, seed);
      replyText = t('fun.fact', locale, { text: spoken });
      break;
    case 'wyr':
      spoken = pickWyr(funLoc, seed);
      replyText = t('fun.wyr', locale, { text: spoken });
      break;
  }

  // Fala (best-effort): só se o Vozen estiver na call E o utilizador não estiver rate-limited.
  const player = getPlayer(deps, i.guildId!);
  if (player) {
    const cfg = getGuildConfig(deps.db, i.guildId!);
    const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
    if (rl.allow(i.user.id, Date.now())) {
      const prefix = funLoc === 'pt' ? 'pt_' : 'en_';
      const model =
        deps.availableModels.find((m) => m.startsWith(prefix)) ||
        cfg.defaultVoice ||
        deps.config.defaultVoice ||
        'en_US-amy-medium';
      const engine = getUserVoice(deps.db, i.guildId!, i.user.id)?.engine;
      // singleVoice: a língua da frase é CONHECIDA (o banco), a deteção não manda.
      void player.say({ text: spoken, model, speed: deps.config.defaultSpeed, singleVoice: true, engine });
    }
  }

  await i.editReply(replyText);
}

/**
 * /birthday set|clear|show — regista o dia de anos (mês+dia, sem ano) por-(guild,user).
 * No dia, quando a pessoa entra na call do Vozen, ele diz "Parabéns" (greetOnJoin). Valida
 * a combinação dia/mês (recusa 31/02 etc.). Respostas ephemeral no locale do próprio.
 */
async function handleBirthday(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const sub = i.options.getSubcommand();
  if (sub === 'set') {
    const day = i.options.getInteger('day', true);
    const month = i.options.getInteger('month', true);
    if (!isValidBirthday(month, day)) {
      await reply(i, t('birthday.invalid', locale));
      return;
    }
    setBirthday(deps.db, i.guildId!, i.user.id, month, day);
    await reply(i, t('birthday.set', locale, { day, month }));
  } else if (sub === 'clear') {
    clearBirthday(deps.db, i.guildId!, i.user.id);
    await reply(i, t('birthday.cleared', locale));
  } else {
    // show
    const bd = getBirthday(deps.db, i.guildId!, i.user.id);
    await reply(
      i,
      bd ? t('birthday.show', locale, { day: bd.day, month: bd.month }) : t('birthday.none', locale),
    );
  }
}

/**
 * /voice detection active:<bool> — liga/desliga a DETECAO AUTOMATICA de lingua para
 * o proprio utilizador (por-guild). Por-utilizador (sem gate de admin), sob o /voice.
 * ON (default): o Vozen deteta a lingua da mensagem e le nessa lingua, misturando
 * vozes num texto multi-lingua. OFF: usa sempre a voz fixa escolhida (/voice set).
 * Resposta i18n no locale do proprio (localeForUser).
 */
async function handleVoiceDetection(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
  locale: string,
): Promise<void> {
  const active = i.options.getBoolean('active', true);
  setDetection(deps.db, i.guildId!, i.user.id, active);
  let msg = active ? t('voice.detection.on', locale) : t('voice.detection.off', locale);
  // MOTOR opcional aqui também (o utilizador pediu-o neste comando): escreve no MESMO
  // sítio que o /voice set (user_voice.engine), preservando a voz e a velocidade atuais.
  // Omitido => não mexe no motor. Piper costuma soar melhor nalgumas línguas (ex. PT).
  const engineOpt = i.options.getString('engine') as 'google' | 'piper' | null;
  if (engineOpt) {
    const cur = getUserVoice(deps.db, i.guildId!, i.user.id);
    setUserVoice(
      deps.db,
      i.guildId!,
      i.user.id,
      cur?.model ?? deps.config.defaultVoice,
      cur?.speed ?? deps.config.defaultSpeed,
      engineOpt,
    );
    msg += '\n' + t('voice.detection.engine', locale, { engine: engineOpt === 'piper' ? 'Piper' : 'Google' });
  }
  await reply(i, msg);
}

// Utilizadores com uma gravação /voice clone record EM CURSO. BUG real descoberto
// (auditoria): connection.receiver.subscribe(userId, ...) do @discordjs/voice devolve
// SEMPRE o MESMO stream partilhado para um userId já subscrito — duas invocações
// concorrentes do MESMO utilizador (duplo-toque, duas sessões) partilhavam o áudio e
// corrompiam-se mutuamente (a primeira a terminar destruía o stream da segunda a meio).
// Este guard bloqueia a 2.ª invocação com uma mensagem clara em vez de deixar as duas
// gravações pisarem-se. Limpo SEMPRE no finally da 1.ª (sucesso, "curto demais" ou erro).
const activeCloneRecordings = new Set<string>();

/**
 * /voice clone record|use|status|delete — clone da PRÓPRIA voz, consent-first:
 *   - record: grava SÓ o áudio do invocador (receiver por-user) durante ~15s de fala;
 *     o próprio comando é o consentimento (registado com timestamp). O bot vive
 *     ensurdecido e só "destapa os ouvidos" durante a janela de gravação.
 *   - use: liga/desliga a leitura das PRÓPRIAS mensagens com o clone (ninguém mais
 *     pode usar o clone de outra pessoa). Sem motor instalado (config.cloneCmd), o
 *     toggle fica guardado mas avisa que a síntese ainda não está ativa.
 *   - delete: apaga amostra + registo, sem rasto.
 * record/use são 💎 Premium (Plus do próprio OU Premium do servidor).
 */
async function handleVoiceClone(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
  locale: string,
): Promise<void> {
  const sub = i.options.getSubcommand();
  const userId = i.user.id;

  if (sub === 'status') {
    const c = getClone(deps.db, userId);
    if (!c) {
      await reply(i, t('clone.none', locale));
      return;
    }
    // Cartão: verde quando o clone está LIGADO, blurple quando só gravado.
    const embed = brandEmbed(c.enabled ? 'success' : 'brand').setDescription(
      t('clone.status', locale, {
        date: `<t:${Math.floor(c.consentAt / 1000)}:D>`,
        state: c.enabled ? t('clone.stateOn', locale) : t('clone.stateOff', locale),
      }),
    );
    await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'delete') {
    // Apaga o MEU clone (sou o dono) E revoga qualquer clone feito a partir da MINHA voz
    // por outra pessoa (sou o alvo) — a pessoa gravada pode sempre retirar o consentimento.
    const ownPath = deleteClone(deps.db, userId);
    const revoked = deleteClonesByTarget(deps.db, userId);
    for (const p of [ownPath, ...revoked.map((r) => r.samplePath)]) {
      if (!p) continue;
      try {
        unlinkSync(p);
      } catch {
        // ficheiro já removido — o registo é o que importa
      }
    }
    if (!ownPath && revoked.length === 0) {
      await reply(i, t('clone.none', locale));
      return;
    }
    const parts: string[] = [];
    if (ownPath) parts.push(t('clone.deleted', locale));
    if (revoked.length) parts.push(t('clone.revoked', locale, { count: revoked.length }));
    await reply(i, parts.join('\n'));
    return;
  }

  // record e use exigem Premium (é o exemplo canónico de "extras que custam computação").
  const now = Date.now();
  const premium = isUserPremium(deps.db, userId, now) || isGuildPremium(deps.db, i.guildId!, now);
  if (!premium) {
    await reply(i, t('clone.locked', locale));
    return;
  }

  if (sub === 'use') {
    const on = i.options.getBoolean('active', true);
    const ok = setCloneEnabled(deps.db, userId, on);
    if (!ok) {
      await reply(i, t('clone.noSample', locale));
      return;
    }
    // Disponibilidade REAL do motor (inclui o venv auto-detetado), não só o env CLONE_CMD —
    // senão dizíamos "motor não instalado" com o sidecar detetado e o clone a funcionar.
    const engineAvailable = deps.cloneAvailable ?? !!deps.config.cloneCmd;
    if (on && !engineAvailable) {
      await reply(i, t('clone.enabledNoEngine', locale));
      return;
    }
    await reply(i, on ? t('clone.enabled', locale) : t('clone.disabled', locale));
    return;
  }

  // ── record ──
  // Alvo escolhível: por defeito o próprio invocador (auto-clone, o caso consent-first
  // trivial); se `user` for outra pessoa, gravamos a voz DELA — mas só com o consentimento
  // explícito dela (botão), preservando a invariante "nunca gravar terceiros em silêncio".
  // A opção `user` é STRING+autocomplete (id da pessoa na call); vazio = o próprio. Se
  // vier texto que não é um id (escreveram à mão sem escolher da lista), pede para escolher.
  const rawTarget = i.options.getString('user')?.trim();
  if (rawTarget && !/^\d{5,25}$/.test(rawTarget)) {
    await reply(i, t('clone.pickFromList', locale));
    return;
  }
  const targetId = rawTarget || userId;
  const isSelf = targetId === userId;
  const who = `<@${targetId}>`;
  // Duração escolhível: segundos de FALA real a apanhar (5–30, default 15). O relógio-teto
  // e o mínimo aceitável derivam do alvo, para amostras curtas poderem funcionar.
  const seconds = Math.min(30, Math.max(5, i.options.getInteger('seconds') ?? 15));
  const targetVoicedMs = seconds * 1000;
  const maxWallMs = Math.min(90_000, Math.max(30_000, targetVoicedMs * 3));
  const minMs = Math.min(4_000, targetVoicedMs);

  const connection = getVoiceConnection(i.guildId!);
  const botChannelId = i.guild?.members.me?.voice?.channelId ?? null;
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  // A presença do ALVO no canal do bot é o que importa (é a voz dele que gravamos).
  const targetMember = await i.guild?.members.fetch(targetId).catch(() => null);
  const targetChannelId = targetMember?.voice?.channelId ?? null;
  if (!connection || !botChannelId) {
    await i.editReply({ content: t('clone.notInVoice', locale) });
    return;
  }
  if (targetChannelId !== botChannelId) {
    await i.editReply({
      content: isSelf ? t('clone.notInVoice', locale) : t('clone.targetNotInVoice', locale, { who }),
    });
    return;
  }
  if (activeCloneRecordings.has(targetId)) {
    await i.editReply({ content: t('clone.alreadyRecording', locale) });
    return;
  }
  // Reserva o alvo JÁ (antes da janela de consentimento de 60s), senão duas pessoas a
  // apontar à mesma vítima passavam ambas o has() e disparavam dois pedidos. Libertado em
  // TODAS as saídas: nos returns antecipados do consentimento e no finally da gravação.
  activeCloneRecordings.add(targetId);

  const { channelId } = connection.joinConfig;

  // CONSENTIMENTO (só quando o alvo não é o próprio): pede o OK explícito ao alvo com um
  // botão numa mensagem pública (que também o notifica). Sem "sim" dele, não se grava nada.
  if (!isSelf) {
    const ch = i.channel;
    if (!ch || !ch.isTextBased() || ch.isDMBased()) {
      activeCloneRecordings.delete(targetId);
      await i.editReply({ content: t('clone.failed', locale) });
      return;
    }
    // O alvo lê isto — usa o locale da guild (neutro), não o do invocador.
    const gLocale = localeFor(deps, i.guildId);
    const consentRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cloneok:${targetId}`)
        .setLabel(t('clone.consentAllow', gLocale))
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`cloneno:${targetId}`)
        .setLabel(t('clone.consentDeny', gLocale))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️'),
    );
    await i.editReply({ content: t('clone.consentWaiting', locale, { who }) });
    const consentMsg = await ch.send({
      content: t('clone.consentRequest', gLocale, { invoker: `<@${userId}>`, target: seconds }),
      components: [consentRow],
    });
    const granted = await new Promise<boolean>((resolve) => {
      const col = consentMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60_000,
      });
      col.on('collect', (btn) => {
        if (btn.user.id !== targetId) {
          void btn.reply({ content: t('clone.consentNotYou', gLocale), flags: MessageFlags.Ephemeral });
          return;
        }
        const ok = btn.customId.startsWith('cloneok:');
        void btn.update({
          content: t(ok ? 'clone.consentGranted' : 'clone.consentRefused', gLocale, { who }),
          components: [],
        });
        resolve(ok);
        col.stop('answered');
      });
      col.on('end', (_c, reason) => {
        if (reason !== 'answered') resolve(false);
      });
    });
    if (!granted) {
      activeCloneRecordings.delete(targetId);
      await i.editReply({ content: t('clone.consentRefused', locale, { who }) }).catch(() => {});
      await consentMsg.edit({ components: [] }).catch(() => {}); // limpa botões se foi timeout
      return;
    }
  }

  // Handle mínimo (só o .stop() que o finally precisa) guardado FORA do try, para o
  // finally poder parar o collector em QUALQUER saída — incluindo se recordUserSample
  // lançar antes do collector.stop('done') normal. .stop() é idempotente (chamar de novo
  // onde já corre não faz mal); isto só cobre a saída que faltava. Tipo minimo em vez do
  // ReturnType real (que é uma UNIÃO de todos os componentType possíveis e não estreita
  // bem para o Button específico usado aqui) — mesmo padrão do `ChildLike` em piperPool.ts.
  let collectorHandle: { stop(reason?: string): void } | undefined;
  try {
    // Botão "Parar já": para além do auto-stop (alvo de FALA ou relógio-teto), tanto o
    // invocador como o alvo podem terminar quando quiserem.
    const stopBtn = new ButtonBuilder()
      .setCustomId(`clonestop:${targetId}`)
      .setLabel(t('clone.stopBtn', locale))
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⏹️');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(stopBtn);
    // Destapa os ouvidos SÓ para esta janela (selfDeaf false), gravando apenas o alvo.
    connection.rejoin({ channelId, selfDeaf: false, selfMute: false });
    const msg = await i.editReply({
      content: isSelf
        ? t('clone.recording', locale, { target: seconds })
        : t('clone.recordingOther', locale, { who, target: seconds }),
      components: [row],
    });

    // Sinal de paragem manual: o coletor de botões liga-o; o recorder faz poll dele.
    let stopped = false;
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: maxWallMs + 5_000,
    });
    collectorHandle = collector;
    collector.on('collect', (btn) => {
      if (btn.user.id !== userId && btn.user.id !== targetId) {
        void btn.reply({ content: t('clone.stopNotYours', locale), flags: MessageFlags.Ephemeral });
        return;
      }
      stopped = true;
      void btn.deferUpdate();
      collector.stop('user');
    });

    // Feedback ao vivo com throttle (~2.5s) — ajuda quem grava a saber que precisa de
    // continuar a falar até ao alvo (a causa nº1 de amostras curtas de mais).
    let lastEdit = Date.now();
    const { pcm, voicedMs, diag } = await recordUserSample(connection, targetId, {
      targetVoicedMs,
      maxWallMs,
      shouldStop: () => stopped,
      onProgress: (ms) => {
        const now = Date.now();
        if (now - lastEdit < 2_500) return;
        lastEdit = now;
        void i
          .editReply({
            content: t('clone.recordingProgress', locale, { got: Math.round(ms / 1000), target: seconds }),
            components: [row],
          })
          .catch(() => {});
      },
    });
    collector.stop('done');
    // DIAGNÓSTICO da causa de amostras curtas (evidência real > teoria): se framesSeen for
    // alto mas framesVoiced baixo, é o gate de RMS a comer o áudio (não o user a falar pouco).
    // rmsMedian vs threshold diz logo se o chão está mal calibrado para este mic/canal.
    log.info(
      `[clone] diag user=${userId} target=${targetId} voicedMs=${voicedMs} ` +
        `framesSeen=${diag.framesSeen} framesVoiced=${diag.framesVoiced} ` +
        `rms[min/med/max]=${diag.rmsMin}/${diag.rmsMedian}/${diag.rmsMax} ` +
        `threshold=${diag.threshold} rounds=${diag.rounds}`,
    );
    if (voicedMs < minMs) {
      await i.editReply({
        content: t('clone.tooShort', locale, {
          seconds: Math.round(voicedMs / 1000),
          min: Math.round(minMs / 1000),
          target: seconds,
        }),
        components: [],
      });
      return;
    }
    // Ficheiro VERSIONADO por timestamp: uma re-gravação é um path novo -> chave de cache
    // nova (cacheKey inclui o basename do ref) -> não se ouve a voz velha. Apaga a amostra
    // anterior a seguir (o ficheiro antigo deixa de ser referenciado). O clone é SEMPRE do
    // invocador (é ele que vai falar com esta voz), mesmo quando gravou a voz de outra pessoa.
    const stamp = Date.now();
    const prev = getClone(deps.db, userId);
    const outPath = join(dirname(deps.config.dbPath), 'voice-clones', `${userId}-${stamp}.wav`);
    await pcmToWavFile(pcm, outPath);
    // targetId = a pessoa cuja voz foi gravada (o próprio num auto-clone). Fica registado
    // para que essa pessoa possa revogar o clone com /voice clone delete (Fase 2 compliance).
    saveClone(deps.db, userId, outPath, stamp, targetId);
    if (prev && prev.samplePath !== outPath) {
      try {
        unlinkSync(prev.samplePath);
      } catch {
        // ficheiro antigo já removido — inofensivo
      }
    }
    await i.editReply({
      content: isSelf
        ? t('clone.saved', locale, { seconds: Math.round(voicedMs / 1000) })
        : t('clone.savedOther', locale, { seconds: Math.round(voicedMs / 1000), who }),
      components: [],
    });
  } catch (err) {
    log.error('[clone] gravação falhou:', err);
    await i.editReply({ content: t('clone.failed', locale), components: [] }).catch(() => {});
  } finally {
    collectorHandle?.stop('finally');
    // Volta SEMPRE a ensurdecer (privacidade por defeito), aconteça o que acontecer.
    try {
      connection.rejoin({ channelId, selfDeaf: true, selfMute: false });
    } catch {
      // ligação pode ter morrido entretanto — inofensivo
    }
    activeCloneRecordings.delete(targetId);
  }
}

async function handleVoice(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  // Grupo /voice clone despacha para o handler próprio (getSubcommand() devolveria o
  // sub DENTRO do grupo e colidiria com os nomes de topo).
  if (i.options.getSubcommandGroup(false) === 'clone') {
    await handleVoiceClone(i, deps, locale);
    return;
  }
  const sub = i.options.getSubcommand();
  if (sub === 'detection') {
    await handleVoiceDetection(i, deps, locale);
    return;
  }
  if (sub === 'set') {
    const model = i.options.getString('model', true);
    if (!deps.availableModels.includes(model)) {
      await reply(i, t('voice.unknownModel', locale));
      return;
    }
    // Guard beginner-friendly de intervalo: o builder do `speed` NAO tem min/max, por
    // isso o Discord NAO rejeita client-side (ex. speed:5). Antes fazia-se silent-clamp
    // (5 -> 2×) e respondia-se "sucesso" — uma surpresa silenciosa. So valida quando o
    // valor FOI fornecido (getNumber devolve null se omitido) E cai FORA de 0.5–2.0;
    // nesse caso erro amigavel com o intervalo e NADA gravado (rejeicao, nao clamp).
    // Boundaries 0.5 e 2.0 continuam validos. Omitido -> cai no defaultSpeed (inalterado).
    const rawSpeed = i.options.getNumber('speed');
    if (rawSpeed !== null && (rawSpeed < 0.5 || rawSpeed > 2.0)) {
      await reply(i, t('voice.badSpeed', locale));
      return;
    }
    const speed = rawSpeed ?? deps.config.defaultSpeed;
    // Clamp preservado: no-op para valores fornecidos validos (ja em [0.5,2.0]); mantem
    // o comportamento antigo para o caminho omitido->defaultSpeed.
    const clamped = Math.min(2.0, Math.max(0.5, speed));
    // Motor por-utilizador: opção nova (google/piper). Se OMITIDA, PRESERVA o motor
    // atual do user — senão mudar só a voz reporia o motor para Google (read-first).
    const engineOpt = i.options.getString('engine') as 'google' | 'piper' | null;
    const currentEngine = getUserVoice(deps.db, i.guildId!, i.user.id)?.engine ?? 'google';
    const engine = engineOpt ?? currentEngine;
    setUserVoice(deps.db, i.guildId!, i.user.id, model, clamped, engine);
    // Copy beginner-friendly: nome da voz NA LÍNGUA DO UTILIZADOR (i.locale) + id cru
    // copy-pasteável. Inclui o motor escolhido.
    await reply(
      i,
      t('voice.set', locale, {
        name: makeLocalizedNamer(i.locale, deps.availableModels)(model),
        model,
        speed: clamped,
        engine: engine === 'piper' ? 'Piper' : 'Google',
      }),
    );
  } else if (sub === 'list') {
    // Beginner-friendly: em vez de uma lista plana de ids Piper, agrupa por lingua
    // com nomes humanos (formatVoiceList). O id cru fica entre parenteses para
    // /voice set continuar copy-pasteavel. Cabeçalhos das línguas NA LÍNGUA DO
    // UTILIZADOR (i.locale); cabeçalho da mensagem i18n.
    const list = deps.availableModels.length
      ? formatVoiceList(deps.availableModels, i.locale)
      : t('voice.listEmpty', locale);
    // Cartão: cabe bem nos 4096 chars da descrição de um embed (grupos por língua).
    const embed = brandEmbed().setDescription(`${t('voice.listHeader', locale)}\n${list}`);
    await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } else if (sub === 'reset') {
    resetUserVoice(deps.db, i.guildId!, i.user.id);
    await reply(i, t('voice.reset', locale));
  } else if (sub === 'optout') {
    // Por-utilizador (sem gate de admin): cada um gere o seu opt-out da auto-leitura.
    setOptOut(deps.db, i.guildId!, i.user.id);
    await reply(i, t('voice.optout', locale));
  } else if (sub === 'optin') {
    setOptIn(deps.db, i.guildId!, i.user.id);
    await reply(i, t('voice.optin', locale));
  } else if (sub === 'nickname') {
    // Apelido FONETICO para o xsaid. Vazio/omitido -> limpa (volta ao nome do servidor).
    const raw = i.options.getString('name');
    if (raw === null || raw.trim() === '') {
      clearNickname(deps.db, i.guildId!, i.user.id);
      await reply(i, t('voice.nickname.cleared', locale));
    } else {
      // Guarda JA sanitizado (tira emojis/simbolos); se nada legivel sobra, recusa.
      const clean = sanitizeSpeakerName(raw);
      if (!clean) {
        await reply(i, t('voice.nickname.invalid', locale));
        return;
      }
      setNickname(deps.db, i.guildId!, i.user.id, clean);
      await reply(i, t('voice.nickname.set', locale, { name: clean }));
    }
  } else if (sub === 'effect') {
    const raw = i.options.getString('effect', true);
    const effect: VoiceEffect = isVoiceEffect(raw) ? raw : 'none';
    // GATE premium: efeitos premium exigem Vozen Premium (servidor) OU Vozen Plus (user).
    // Só aqui, ao GUARDAR — o player aplica cegamente o que estiver guardado.
    if (isPremiumEffect(effect)) {
      const now = Date.now();
      const unlocked =
        isGuildPremium(deps.db, i.guildId!, now) || isUserPremium(deps.db, i.user.id, now);
      if (!unlocked) {
        await reply(i, t('voice.effect.locked', locale, { effect: effectLabel(effect) }));
        return;
      }
    }
    setVoiceEffect(deps.db, i.guildId!, i.user.id, effect);
    await reply(
      i,
      effect === 'none'
        ? t('voice.effect.cleared', locale)
        : t('voice.effect.set', locale, { effect: effectLabel(effect) }),
    );
  } else if (sub === 'preview') {
    const SAMPLE = t('preview.sample', locale);
    const explicitModel = i.options.getString('model');

    // Valida o model explícito ANTES de verificar o player.
    if (explicitModel !== null && !deps.availableModels.includes(explicitModel)) {
      await reply(i, t('voice.unknownModel', locale));
      return;
    }

    const player = getPlayer(deps, i.guildId!);
    if (!player) {
      await reply(i, t('voice.notInVoice', locale));
      return;
    }

    const cfg = getGuildConfig(deps.db, i.guildId!);
    const stored = getUserVoice(deps.db, i.guildId!, i.user.id);
    // Preview NAO passa por resolveSynth de proposito: resolveSynth agora deixa a
    // LINGUA da mensagem decidir a voz, mas o /voice preview e um DEMO de UMA voz
    // especifica — tem de tocar exatamente o model pedido (ou o guardado/default),
    // independentemente da lingua da frase-amostra. Por isso construimos o
    // SynthRequest diretamente. Precedencia: model explicito > voz guardada do
    // user > default_voice da guild > .env > amy. Velocidade: a do user, senao a default.
    const model =
      (explicitModel ?? stored?.model) ||
      cfg.defaultVoice ||
      deps.config.defaultVoice ||
      'en_US-amy-medium';
    const speed = stored?.speed ?? deps.config.defaultSpeed;
    // singleVoice: o preview e um DEMO de UMA voz especifica; a deteccao nunca deve
    // sobrepor-se nem partir a frase-amostra por lingua. O motor e o do user (o preview
    // tem de soar ao que ele vai ouvir de facto).
    const req: SynthRequest = { text: SAMPLE, model, speed, singleVoice: true, engine: stored?.engine };
    // say() devolve false quando a fila esta no cap: nesse caso NAO mentir "a
    // reproduzir" — reutilizamos a mesma chave tts.busy do /tts (consistencia).
    const queued = await player.say(req);
    await reply(i, queued ? t('voice.previewPlaying', locale) : t('tts.busy', locale));
  }
}

async function handleConfig(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const member = i.member as GuildMember;
  if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(i, t('error.needManageGuild', locale));
    return;
  }
  const group = i.options.getSubcommandGroup(false);
  if (group === 'blockword') {
    const sub = i.options.getSubcommand();
    const word = i.options.getString('word', true).trim();
    if (!word) {
      await reply(i, t('config.wordEmpty', locale));
      return;
    }
    if (sub === 'add') {
      addBlockword(deps.db, i.guildId!, word);
      await reply(i, t('config.blocked', locale, { word }));
    } else {
      removeBlockword(deps.db, i.guildId!, word);
      await reply(i, t('config.unblocked', locale, { word }));
    }
    return;
  }
  if (group === 'pronunciation') {
    const sub = i.options.getSubcommand();
    // `list` nao tem opcoes: tratar ANTES de exigir o termo (getString(..., true) lancaria).
    if (sub === 'list') {
      const dict = getPronunciations(deps.db, i.guildId!);
      const out = dict.length
        ? dict
            .map((e) => `- ${e.term} -> ${e.replacement || t('config.pronEmptyValue', locale)}`)
            .join('\n')
        : t('config.listEmpty', locale);
      await reply(i, `${t('config.pronListHeader', locale)}\n${out}`);
      return;
    }
    const term = i.options.getString('term', true).trim();
    if (!term) {
      await reply(i, t('config.termEmpty', locale));
      return;
    }
    if (sub === 'add') {
      const replacement = i.options.getString('pronunciation', true).trim();
      if (!replacement) {
        await reply(i, t('config.pronEmpty', locale));
        return;
      }
      addPronunciation(deps.db, i.guildId!, term, replacement);
      await reply(i, t('config.pronSet', locale, { term, replacement }));
    } else {
      removePronunciation(deps.db, i.guildId!, term);
      await reply(i, t('config.pronRemoved', locale, { term }));
    }
    return;
  }
  const sub = i.options.getSubcommand();
  if (sub === 'tts-channel') {
    const ch = i.options.getChannel('channel', true);
    if (ch.type !== ChannelType.GuildText) {
      await reply(i, t('config.channelWrongType', locale));
      return;
    }
    const me = deps.client.user;
    // ch pode ser um objeto parcial (APIChannel) — usa guild.channels.cache para obter o canal completo
    const fullCh = i.guild?.channels.cache.get(ch.id);
    const perms = me && fullCh ? fullCh.permissionsFor(me) : null;
    if (!perms || !perms.has(PermissionFlagsBits.ViewChannel)) {
      await reply(i, t('config.channelNoAccess', locale, { channel: `<#${ch.id}>` }));
      return;
    }
    setGuildConfig(deps.db, i.guildId!, { ttsChannelId: ch.id });
    await reply(i, t('config.channelSet', locale, { channel: `<#${ch.id}>` }));
  } else if (sub === 'autoread') {
    const on = i.options.getBoolean('active', true);
    setGuildConfig(deps.db, i.guildId!, { autoread: on });
    await reply(i, on ? t('config.autoreadOn', locale) : t('config.autoreadOff', locale));
  } else if (sub === 'max-chars') {
    const v = i.options.getInteger('value', true);
    if (v < 1 || v > 2000) {
      await reply(i, t('config.maxCharsRange', locale));
      return;
    }
    setGuildConfig(deps.db, i.guildId!, { maxChars: v });
    await reply(i, t('config.maxCharsSet', locale, { value: v }));
  } else if (sub === 'rate-limit') {
    const v = i.options.getInteger('value', true);
    if (v < 1 || v > 120) {
      await reply(i, t('config.rateLimitRange', locale));
      return;
    }
    setGuildConfig(deps.db, i.guildId!, { ratePerMin: v });
    await reply(i, t('config.rateLimitSet', locale, { value: v }));
  } else if (sub === 'role') {
    // Opcao de role e opcional: omiti-la (getRole devolve null) limpa a restricao.
    const role = i.options.getRole('role', false);
    if (role) {
      setGuildConfig(deps.db, i.guildId!, { ttsRoleId: role.id });
      await reply(i, t('config.roleSet', locale, { role: `<@&${role.id}>` }));
    } else {
      setGuildConfig(deps.db, i.guildId!, { ttsRoleId: null });
      await reply(i, t('config.roleCleared', locale));
    }
  } else if (sub === 'enabled') {
    // Kill-switch do servidor: o messageHandler ja ignora tudo quando enabled=false.
    const on = i.options.getBoolean('active', true);
    setGuildConfig(deps.db, i.guildId!, { enabled: on });
    await reply(i, on ? t('config.enabledOn', locale) : t('config.enabledOff', locale));
  } else if (sub === 'xsaid') {
    // Anuncio "{nome} disse" antes de cada mensagem (quem falou). LIGADO por defeito.
    const on = i.options.getBoolean('active', true);
    setGuildConfig(deps.db, i.guildId!, { xsaid: on });
    await reply(i, on ? t('config.xsaidOn', locale) : t('config.xsaidOff', locale));
  } else if (sub === 'autojoin') {
    // O bot entra sozinho na call do autor quando chega mensagem. DESLIGADO por defeito.
    const on = i.options.getBoolean('active', true);
    setGuildConfig(deps.db, i.guildId!, { autojoin: on });
    await reply(i, on ? t('config.autojoinOn', locale) : t('config.autojoinOff', locale));
  } else if (sub === 'read-bots') {
    // Ler outros bots/webhooks. DESLIGADO por defeito (o Vozen nunca se lê a si próprio).
    const on = i.options.getBoolean('active', true);
    setGuildConfig(deps.db, i.guildId!, { readBots: on });
    await reply(i, on ? t('config.readBotsOn', locale) : t('config.readBotsOff', locale));
  } else if (sub === 'text-in-voice') {
    // Ler o chat de texto dentro do canal de voz onde o Vozen está. DESLIGADO por defeito.
    const on = i.options.getBoolean('active', true);
    setGuildConfig(deps.db, i.guildId!, { textInVoice: on });
    await reply(i, on ? t('config.textInVoiceOn', locale) : t('config.textInVoiceOff', locale));
  } else if (sub === 'greet') {
    // Saudação de voz a quem entra na call. LIGADA por defeito.
    const on = i.options.getBoolean('active', true);
    setGuildConfig(deps.db, i.guildId!, { greetOnJoin: on });
    await reply(i, on ? t('config.greetOn', locale) : t('config.greetOff', locale));
  } else if (sub === 'greet-language') {
    // Língua da saudação (choices estáticas -> já validadas pelo Discord; revalidamos
    // defensivamente contra o conjunto de saudações suportadas).
    const lang = i.options.getString('language', true);
    if (!GREET_LOCALES.has(lang)) {
      await reply(i, t('config.language.unsupported', locale));
      return;
    }
    setGuildConfig(deps.db, i.guildId!, { greetLocale: lang });
    const label = GREET_LANGUAGE_CHOICES.find((c) => c.value === lang)?.name ?? lang;
    await reply(i, t('config.greetLangSet', locale, { language: label }));
  } else if (sub === 'default-voice') {
    // Valida contra os modelos disponiveis, tal como /voice set.
    const model = i.options.getString('model', true);
    if (!deps.availableModels.includes(model)) {
      await reply(i, t('voice.unknownModel', locale));
      return;
    }
    setGuildConfig(deps.db, i.guildId!, { defaultVoice: model });
    // Copy beginner-friendly: lidera com o nome amigavel (voiceDisplayName) e mantem
    // o id cru copy-pasteavel. Comportamento inalterado (so params de apresentacao).
    await reply(i, t('config.defaultVoiceSet', locale, { name: makeLocalizedNamer(i.locale, deps.availableModels)(model), model }));
  } else if (sub === 'language') {
    // Troca do idioma da INTERFACE. As choices ja limitam a SUPPORTED_LOCALES, mas
    // validamos de novo (defensivo) — includes() precisa do cast porque o array e
    // `readonly ['en','pt']` e o input e string. Locale invalido -> erro amigavel
    // no locale ATUAL (o pedido nao e utilizavel); nao persiste nada.
    const requested = i.options.getString('locale', true);
    if (!SUPPORTED_LOCALES.includes(requested as SupportedLocale)) {
      await reply(i, t('config.language.unsupported', locale));
      return;
    }
    const chosen = requested as SupportedLocale;
    setGuildConfig(deps.db, i.guildId!, { locale: chosen });
    // Confirmacao JA na NOVA lingua (usa `chosen`, nao `locale`): o admin ve logo
    // que a mudanca surtiu efeito. {language} = nome legivel do idioma escolhido.
    await reply(
      i,
      t('config.language.set', chosen, { language: LOCALE_DISPLAY_NAMES[chosen] }),
    );
  } else if (sub === 'show') {
    const cfg = getGuildConfig(deps.db, i.guildId!);
    const blocklistCount = getBlocklist(deps.db, i.guildId!).length;
    const pronunciationCount = getPronunciations(deps.db, i.guildId!).length;
    const on = t('config.on', locale);
    const off = t('config.off', locale);
    const channelStr = cfg.ttsChannelId ? `<#${cfg.ttsChannelId}>` : t('config.valueNone', locale);
    const roleStr = cfg.ttsRoleId ? `<@&${cfg.ttsRoleId}>` : t('config.valueAny', locale);
    const voiceStr = cfg.defaultVoice || t('config.valueAutoDetect', locale);
    const lines = [
      t('config.showTitle', locale),
      t('config.showChannel', locale, { value: channelStr }),
      t('config.showAutoread', locale, { value: cfg.autoread ? on : off }),
      t('config.showRole', locale, { value: roleStr }),
      t('config.showEnabled', locale, { value: cfg.enabled ? on : off }),
      t('config.showXsaid', locale, { value: cfg.xsaid ? on : off }),
      t('config.showAutojoin', locale, { value: cfg.autojoin ? on : off }),
      t('config.showReadBots', locale, { value: cfg.readBots ? on : off }),
      t('config.showTextInVoice', locale, { value: cfg.textInVoice ? on : off }),
      t('config.showGreet', locale, {
        value: cfg.greetOnJoin ? on : off,
        language: GREET_LANGUAGE_CHOICES.find((c) => c.value === cfg.greetLocale)?.name ?? cfg.greetLocale,
      }),
      t('config.showVoice', locale, { value: voiceStr }),
      t('config.showMaxChars', locale, { value: cfg.maxChars }),
      t('config.showRateLimit', locale, { value: cfg.ratePerMin }),
      t('config.showBlocklist', locale, { count: blocklistCount }),
      t('config.showPronunciation', locale, { count: pronunciationCount }),
    ];
    await reply(i, lines.join('\n'));
  } else if (sub === 'reset') {
    resetGuildConfig(deps.db, i.guildId!);
    await reply(i, t('config.reset', locale));
  }
}

// Estado de cada item do checklist de permissoes:
//  - 'ok'         -> o bot tem a permissao
//  - 'missing'    -> o bot NAO tem a permissao (precisa de ser corrigida)
//  - 'unchecked'  -> nao foi possivel verificar agora (ex.: perms de voz quando
//                    o invocador nao esta num canal de voz) — sera validada no /join
type PermState = 'ok' | 'missing' | 'unchecked';

function permLine(label: string, state: PermState, locale: string): string {
  if (state === 'ok') return t('setup.permOk', locale, { label });
  if (state === 'missing') return t('setup.permMissing', locale, { label });
  return t('setup.permUnchecked', locale, { label });
}

/**
 * /setup — assistente guiado para admins. Reduz a friccao de "settings nao
 * beginner-friendly": configura o canal de auto-leitura + liga autoread num so
 * passo e devolve um checklist claro das permissoes do bot.
 *
 * Decisoes de design (o contrato e omisso nalguns pontos):
 *  - Apenas um *tipo de canal invalido* (nao-texto) BLOQUEIA a gravacao. Perms em
 *    falta (texto OU voz) NAO bloqueiam: gravamos canal+autoread na mesma e
 *    avisamos no checklist. O objetivo e tirar o admin do estado "tentei tudo".
 *  - ViewChannel em falta e tratado como as restantes: aparece no checklist como
 *    "falta" mas a config e gravada na mesma (consistente com a politica de voz).
 *  - Resolucao do canal: a opcao `canal` pode chegar como APIChannel parcial
 *    (so id), tal como no /config tts-channel — resolvemos via guild.channels.cache.
 *    O canal da interacao (i.channel) ja vem completo; o fallback `?? ref`
 *    garante que esse caminho funciona mesmo sem hit na cache.
 */
async function handleSetup(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const member = i.member as GuildMember;
  if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(i, t('error.needManageGuild', locale));
    return;
  }

  // (a) Resolver o canal alvo: opcao `channel` ou, se omitida, o canal da interacao.
  const ref = (i.options.getChannel('channel', false) as { id: string; type?: number } | null) ?? i.channel;
  if (!ref || !('id' in ref)) {
    await reply(i, t('setup.noChannel', locale));
    return;
  }
  // Resolve o canal completo (com permissionsFor) a partir da cache; o canal da
  // interacao ja e completo, por isso o fallback `?? ref` cobre esse caso.
  const fullCh = (i.guild?.channels.cache.get(ref.id) ?? ref) as {
    id: string;
    type?: number;
    permissionsFor?: (u: unknown) => { has: (flag: bigint) => boolean } | null;
  };

  if (fullCh.type !== ChannelType.GuildText) {
    await reply(i, t('setup.channelWrongType', locale));
    return;
  }

  const me = deps.client.user;
  const textPerms = me && fullCh.permissionsFor ? fullCh.permissionsFor(me) : null;
  // O canal de texto precisa de ViewChannel E SendMessages (contrato 3a). Cada uma
  // tem a sua propria linha de checklist, com o seu estado independente — assim o
  // admin ve exatamente qual falta (antes fundiamos as duas e mostravamos "❌
  // ViewChannel" mesmo quando so faltava SendMessages, o que enganava).
  const canView = textPerms?.has(PermissionFlagsBits.ViewChannel) ?? false;
  const canSend = textPerms?.has(PermissionFlagsBits.SendMessages) ?? false;
  const viewState: PermState = canView ? 'ok' : 'missing';
  const sendState: PermState = canSend ? 'ok' : 'missing';

  // (b) Perms de voz: so da para verificar se o invocador esta num canal de voz.
  const voiceCh = member?.voice?.channel as
    | { name?: string; permissionsFor?: (u: unknown) => { has: (flag: bigint) => boolean } | null }
    | null
    | undefined;
  let connectState: PermState = 'unchecked';
  let speakState: PermState = 'unchecked';
  if (voiceCh) {
    const vp = me && voiceCh.permissionsFor ? voiceCh.permissionsFor(me) : null;
    connectState = vp?.has(PermissionFlagsBits.Connect) ? 'ok' : 'missing';
    speakState = vp?.has(PermissionFlagsBits.Speak) ? 'ok' : 'missing';
  }

  // (c) Configura num so passo — SEMPRE, mesmo que faltem perms (so avisamos).
  setGuildConfig(deps.db, i.guildId!, { ttsChannelId: fullCh.id, autoread: true });

  // (c2) Onboarding de 1-passo: se o invocador esta num canal de voz E o bot tem
  // Connect+Speak la (connectState/speakState === 'ok'), juntamo-nos JA a voz
  // reutilizando a MESMA logica de /join (helper partilhado joinUserVoice) — o
  // principiante fica pronto sem ter de correr /join a seguir. Se faltarem perms
  // ou nao estiver em voz, NAO tentamos juntar (o checklist ja avisa) — a reconci-
  // liacao e: /join = "entrar na voz" simples; /setup = onboarding guiado (config
  // + juntar-se quando da). O joinUserVoice NAO responde a interacao; dobramos o
  // resultado numa linha do checklist para manter UMA unica resposta.
  let joinedChannelName: string | null = null;
  if (connectState === 'ok' && speakState === 'ok') {
    const outcome = joinUserVoice(i, deps);
    if (outcome.status === 'joined') {
      joinedChannelName = outcome.channelName;
    }
  }

  // (d) Resumo beginner-friendly.
  const lines: string[] = [
    t('setup.done', locale),
    t('setup.channelLine', locale, { channel: `<#${fullCh.id}>` }),
    t('setup.autoreadOn', locale),
    '',
    t('setup.permsHeader', locale),
    permLine(t('setup.permView', locale), viewState, locale),
    permLine(t('setup.permSend', locale), sendState, locale),
    permLine(t('setup.permConnect', locale), connectState, locale),
    permLine(t('setup.permSpeak', locale), speakState, locale),
  ];

  if (joinedChannelName !== null) {
    lines.push('', t('setup.joinedVoice', locale, { channel: joinedChannelName }));
  }

  const anyMissing = [viewState, sendState, connectState, speakState].includes('missing');
  if (anyMissing) {
    lines.push('', t('setup.fixHint', locale));
  }
  if (connectState === 'unchecked' || speakState === 'unchecked') {
    lines.push('', t('setup.voiceUncheckedNote', locale));
  }
  // Ja juntos a voz -> proximo passo e so escrever; senao (nao estava em voz mas
  // tudo o resto ok) mantemos a dica de correr /join.
  if (!anyMissing && connectState === 'ok' && speakState === 'ok') {
    lines.push('', joinedChannelName !== null ? t('setup.readyTalk', locale) : t('setup.allGood', locale));
  }

  // Guia para MEMBROS: o admin acabou de configurar o servidor, mas os MEMBROS
  // precisam de saber o passo seguinte. Fechamos SEMPRE o /setup com o fluxo em 3
  // passos (join voz -> /join -> escrever) para o admin partilhar. Curto e a
  // apontar para /help (a referencia completa) — nao a duplica.
  lines.push('', t('setup.membersHeader', locale), t('setup.membersBody', locale));

  // Cartão: verde quando está tudo OK, amarelo quando falta alguma permissão.
  const embed = brandEmbed(anyMissing ? 'warning' : 'success').setDescription(lines.join('\n'));
  await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleStats(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeFor(deps, i.guildId);
  const member = i.member as GuildMember;
  if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(i, t('error.needManageGuild', locale));
    return;
  }
  const snap = metrics.snapshot();
  const uptimeSec = Math.floor(process.uptime());
  const lines = [
    t('stats.title', locale),
    t('stats.messagesSpoken', locale, { value: snap.messagesSpoken }),
    t('stats.cacheHits', locale, { value: snap.cacheHits }),
    t('stats.cacheMisses', locale, { value: snap.cacheMisses }),
    t('stats.synthErrors', locale, { value: snap.synthErrors }),
    t('stats.synthLatency', locale, {
      p50: snap.synthP50Ms,
      p95: snap.synthP95Ms,
      count: snap.synthCount,
    }),
    t('stats.voiceDrops', locale, { value: snap.voiceDrops }),
    t('stats.voiceReconnects', locale, { value: snap.voiceReconnects }),
    t('stats.votes', locale, { value: snap.votes }),
    t('stats.activePlayers', locale, { value: deps.players.size }),
    t('stats.servers', locale, { value: deps.client.guilds.cache.size }),
    t('stats.uptime', locale, { value: uptimeSec }),
  ];
  await i.reply({ embeds: [brandEmbed().setDescription(lines.join('\n'))], flags: MessageFlags.Ephemeral });
}

/**
 * Formata uma duração em segundos como "2d 3h 15m" (omite unidades a zero à cabeça;
 * < 1 min -> "<1m"). Universal (letras d/h/m), a frase à volta é que é localizada. PURA.
 */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(' ') : '<1m';
}

/** /uptime — PÚBLICO: há quanto tempo o Vozen está online. */
async function handleUptime(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  await reply(i, t('uptime.text', locale, { uptime: formatDuration(process.uptime()) }));
}

/** /botstats — PÚBLICO: números de confiança (servidores, sessões de voz, uptime). */
async function handleBotstats(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const snap = metrics.snapshot();
  const lines = [
    t('botstats.title', locale),
    t('botstats.servers', locale, { value: deps.client.guilds.cache.size }),
    t('botstats.voiceSessions', locale, { value: deps.players.size }),
    t('botstats.messagesSpoken', locale, { value: snap.messagesSpoken }),
    t('botstats.uptime', locale, { value: formatDuration(process.uptime()) }),
  ];
  await i.reply({ embeds: [brandEmbed().setDescription(lines.join('\n'))], flags: MessageFlags.Ephemeral });
}

/**
 * /game — minijogos de grupo. Subcomandos:
 *  - play <game>   : arranca um jogo (jogos de voz exigem o bot numa call);
 *  - stop          : para o jogo ativo (pontos da partida abortada nao contam);
 *  - list          : lista os jogos disponiveis (derivada de GAME_DEFS);
 *  - leaderboard   : top jogadores do servidor (persistido em game_score).
 *
 * O ARRANQUE/PARAGEM respondem EPHEMERAL (ack ao invocador — o jogo em si fala no
 * canal para todos). `list`/`leaderboard` sao informativos e partilhaveis, por isso
 * respondem PUBLICO. Toda a UI no locale do invocador (localeForUser). O gating de
 * "precisa de call" e "ja ha jogo" e feito aqui; o lock por-guild vive no GameManager.
 */
async function handleGame(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  if (!deps.games) {
    // Sem gestor de jogos (nunca deve acontecer em producao — sempre injetado no
    // bootstrap; guard defensivo p/ testes que nao o injetam).
    await reply(i, t('error.generic', locale));
    return;
  }
  const sub = i.options.getSubcommand();

  if (sub === 'play') {
    const gameId = i.options.getString('game', true);
    const def = gameById(gameId);
    if (!def) {
      await reply(i, t('game.unknownGame', locale));
      return;
    }
    // Jogos de voz exigem o bot numa call (como o /tts): sem player, nada a anunciar.
    if (def.needsVoice && !getPlayer(deps, i.guildId!)) {
      await reply(i, t('game.start.needVoice', locale));
      return;
    }
    // Jogos 💎 Premium (ex. xadrez): Plus do próprio OU Premium do servidor, mesmo
    // padrão do /voice clone e /voice effect.
    if (def.premium) {
      const now = Date.now();
      const premium = isUserPremium(deps.db, i.user.id, now) || isGuildPremium(deps.db, i.guildId!, now);
      if (!premium) {
        await reply(i, t('game.start.premiumLocked', locale, { game: t(def.nameKey, locale) }));
        return;
      }
    }
    // Locale do jogo = o de QUEM inicia (localeForUser), não o da guild — assim um
    // servidor sem /config language joga na língua de quem clicou (ex.: PT).
    // A opção `language` só é usada pelo word-chain; se omitida, cai no locale de quem
    // inicia (o resolveLang do jogo mapeia línguas não-suportadas para inglês). Os
    // outros jogos ignoram opts (create() sem parâmetros continua válido).
    const chosenLang = i.options.getString('language') ?? undefined;
    const res = deps.games.start(
      i.guildId!,
      i.channelId,
      def.create({ language: chosenLang ?? locale }),
      def.needsVoice,
      locale,
    );
    if (res === 'already-active') {
      const ch = deps.games.channelOf(i.guildId!) ?? i.channelId;
      await reply(i, t('game.start.alreadyActive', locale, { channel: ch }));
      return;
    }
    await reply(i, t('game.start.started', locale, { game: t(def.nameKey, locale) }));
    return;
  }

  if (sub === 'stop') {
    const ok = deps.games.stop(i.guildId!);
    await reply(i, ok ? t('game.stop.ok', locale) : t('game.stop.none', locale));
    return;
  }

  if (sub === 'list') {
    const lines = GAME_DEFS.map((g) =>
      t('game.list.line', locale, { name: t(g.nameKey, locale), desc: t(g.descKey, locale) }),
    );
    await i.reply({
      embeds: [brandEmbed().setDescription(`${t('game.list.title', locale)}\n${lines.join('\n')}`)],
    });
    return;
  }

  if (sub === 'leaderboard') {
    const rows = getLeaderboard(deps.db, i.guildId!, 10);
    if (rows.length === 0) {
      await reply(i, t('game.leaderboard.empty', locale));
      return;
    }
    const lines = rows.map((r, idx) =>
      t('game.leaderboard.line', locale, {
        rank: rankMedal(idx + 1),
        user: r.userId,
        points: r.points,
        wins: r.wins,
      }),
    );
    await i.reply({
      embeds: [brandEmbed().setDescription(`${t('game.leaderboard.title', locale)}\n${lines.join('\n')}`)],
    });
    return;
  }

  if (sub === 'stats') {
    // Estatisticas do PROPRIO (ephemeral): pontos, vitorias e posicao no ranking.
    const score = getUserScore(deps.db, i.guildId!, i.user.id);
    const { rank, total } = getUserRank(deps.db, i.guildId!, i.user.id);
    if (score.points === 0 && score.wins === 0) {
      await reply(i, t('game.stats.none', locale));
      return;
    }
    const rankStr = rank ? t('game.stats.rank', locale, { rank, total }) : t('game.stats.unranked', locale);
    await i.reply({
      embeds: [
        brandEmbed().setDescription(
          t('game.stats.body', locale, { points: score.points, wins: score.wins, rank: rankStr }),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}

/**
 * /invite — devolve o URL de convite OAuth2 do bot, construido a partir do
 * CLIENT_ID da config. Gatilho do "loop viral".
 *
 * Decisoes de design:
 *  - Reply NORMAL (nao ephemeral): o objetivo do comando e partilhar o link, por
 *    isso queremos que fique visivel no canal para quem mais quiser adicionar o
 *    Vozen. Por isso NAO usamos o helper reply() (que e ephemeral) — chamamos
 *    i.reply() diretamente sem flags.
 *  - O URL e montado com URLSearchParams para escapar corretamente os valores; o
 *    scope "bot applications.commands" fica codificado (o espaco vira '+'), o que
 *    e valido para o endpoint OAuth2.
 *  - permissions = INVITE_PERMISSIONS (inteiro derivado dos 5 bits, ver topo).
 *  - Sem CLIENT_ID configurado: respondemos com uma mensagem clara em vez de
 *    gerar um link partido (client_id vazio). Verificamos com !clientId para
 *    apanhar tanto undefined como string vazia.
 */
async function handleInvite(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const clientId = deps.config.clientId;
  if (!clientId) {
    await reply(i, t('invite.noClientId', locale));
    return;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: INVITE_PERMISSIONS,
  });
  const url = `https://discord.com/oauth2/authorize?${params.toString()}`;
  // Botão de link + o URL no texto (fica clicável e copiável). ButtonStyle.Link não tem
  // customId — leva só o URL, por isso não precisa de coletor.
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(t('invite.button', locale)).setEmoji('➕'),
  );
  await i.reply({ content: t('invite.link', locale, { url }), components: [row] });
}

/**
 * /vote — devolve o link da pagina de voto do Vozen no top.gg (P11.5),
 * construido a partir do CLIENT_ID da config. Gatilho de crescimento, irmao do
 * /invite.
 *
 * Decisoes de design (espelham o /invite):
 *  - Reply NORMAL (nao ephemeral): o objetivo e PARTILHAR o link para que mais
 *    gente vote, por isso fica visivel no canal — NAO usamos o helper reply()
 *    (ephemeral); chamamos i.reply() diretamente sem flags.
 *  - URL = https://top.gg/bot/<CLIENT_ID>/vote. O CLIENT_ID e o id da aplicacao
 *    (o mesmo do /invite); o top.gg usa-o como id do bot na sua listagem.
 *  - Sem CLIENT_ID configurado: mensagem clara ephemeral em vez de um link
 *    partido (top.gg/bot//vote). Verificamos com !clientId (apanha undefined e
 *    string vazia), tal como o /invite.
 */
async function handleVote(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const clientId = deps.config.clientId;
  if (!clientId) {
    await reply(i, t('vote.noClientId', locale));
    return;
  }
  const url = `https://top.gg/bot/${clientId}/vote`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(t('vote.button', locale)).setEmoji('🗳️'),
  );
  await i.reply({ content: t('vote.link', locale, { url }), components: [row] });
}

/**
 * /help — discovery de comandos em-app, pensado para PRINCIPIANTES (dono de
 * servidor ou membro que nunca usou o bot). Responde com um EMBED beginner-friendly:
 * intro do que o Vozen faz + um "Quick start (3 steps)" + comandos AGRUPADOS por
 * tarefa (Getting started / Your voice / Fun / Server admin / More), cada linha com
 * um one-liner amigavel e pelo menos um exemplo concreto.
 *
 * Decisoes de design:
 *  - TODO o texto e renderizado via t(key, locale) no locale da guild
 *    (getGuildConfig.locale). Por defeito (locale 'en') sai em INGLES; ha traducao
 *    'pt' para tudo. Os corpos dos grupos sao HAND-AUTHORED no catalogo (nao
 *    derivados das descricoes de commandDefs) porque "um exemplo concreto por
 *    seccao" nao se consegue derivar de uma descricao curta.
 *  - GUARD de cobertura: como os corpos sao hand-authored, corremos o risco de um
 *    comando NOVO em commandDefs ficar de fora. Para o /help continuar a ser a
 *    fonte de discovery, verificamos em runtime que TODOS os nomes top-level
 *    aparecem no texto montado; qualquer um que falte e APENSADO ao grupo "More".
 *    Assim o teste-guard (cada comando top-level aparece no /help) continua
 *    genuinamente protetor sem obrigar a listar tudo a mao.
 *  - Reply ephemeral para nao poluir o canal.
 */
async function handleHelp(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  // Locale da INTERFACE do UTILIZADOR que pediu ajuda (o /help e ephemeral, so ele
  // o ve): usa o Discord locale do cliente dele (localeForUser), com fallback para o
  // locale da guild e depois DEFAULT_LOCALE. Nunca lanca.
  const locale = localeForUser(deps, i);

  // Cada FIELD tem um nome (cabecalho traduzido) e um value (corpo traduzido). O
  // quick-start vem primeiro para o principiante arrancar sem ler tudo.
  const fields: { name: string; value: string }[] = [
    { name: t('help.quickStartTitle', locale), value: t('help.quickStartBody', locale) },
    { name: t('help.groupStarted', locale), value: t('help.groupStartedBody', locale) },
    { name: t('help.groupVoice', locale), value: t('help.groupVoiceBody', locale) },
    { name: t('help.groupFun', locale), value: t('help.groupFunBody', locale) },
    { name: t('help.groupAdmin', locale), value: t('help.groupAdminBody', locale) },
    { name: t('help.groupMore', locale), value: t('help.groupMoreBody', locale) },
  ];

  // GUARD de cobertura: garante que nenhum comando top-level fica invisivel. Junta
  // todos os values numa string e, para cada commandDef, se `/nome` nao aparecer,
  // apensa-o ao grupo "More" (o ultimo field). Mantem o /help como discovery real
  // sem repetir a lista a mao.
  const mentioned = fields.map((f) => f.value).join('\n');
  const missing = commandDefs
    .map((d) => d.name)
    .filter((name) => !mentioned.includes(`/${name}`));
  if (missing.length) {
    const more = fields[fields.length - 1];
    more.value += '\n' + missing.map((name) => `• /${name}`).join('\n');
  }

  // Linha de suporte/denúncia (requisito da Política de Desenvolvedor do Discord:
  // dar ao utilizador uma forma de reportar problemas). Vem do config (env
  // SUPPORT_URL; default = servidor de suporte oficial).
  const supportLine = t('help.support', locale, { url: deps.config.supportUrl });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2) // blurple — parece intencional, nao o cinzento default
    .setTitle(t('help.embedTitle', locale))
    // Descricao: tagline da marca + o que o Vozen faz (intro) + o diferenciador
    // (voz neural gratis) — a mesma chave do welcome embed — + a linha de suporte.
    .setDescription(
      `${t('help.title', locale)}\n${t('help.intro', locale)}\n\n${t('welcome.tagline', locale)}\n\n${supportLine}`,
    )
    .addFields(fields)
    .setFooter({ text: t('help.footer', locale, { command: '/setup' }) });

  await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

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
  return models
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
    .slice(0, 25);
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
    (code) => LOCALE_DISPLAY_NAMES[code].toLowerCase().includes(q) || code.toLowerCase().includes(q),
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
          .filter((m) => !q || m.displayName.toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q))
          .slice(0, 25)
          .map((m) => ({ name: m.displayName, value: m.id }))
      : [];
  }
  return [];
}

export async function handleAutocomplete(
  i: AutocompleteInteraction,
  deps: BotDeps,
): Promise<void> {
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

export async function handleInteraction(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
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
