import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  GuildMember,
  ChannelType,
  MessageFlags,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { metrics } from '../metrics';
import { joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import type { BotDeps } from '../bot/deps';
import { getPlayer, removePlayer, getLimiter } from '../bot/deps';
import { GuildVoicePlayer } from '../voice/player';
import { getUserVoice, setUserVoice, resetUserVoice } from '../store/userVoice';
import { getGuildConfig, setGuildConfig, resetGuildConfig } from '../store/guildConfig';
import { addBlockword, removeBlockword, getBlocklist } from '../store/blocklist';
import { setOptOut, setOptIn } from '../store/optout';
import {
  getPronunciations,
  addPronunciation,
  removePronunciation,
} from '../store/pronunciation';
import {
  getUserAbbrev,
  addUserAbbrev,
  removeUserAbbrev,
  USER_ABBREV_CAP,
} from '../store/userAbbrev';
import { cleanText } from '../textCleaning/clean';
import { applyPronunciation } from '../textCleaning/pronunciation';
import { applyUserAbbrev } from '../textCleaning/userAbbrev';
import { expandAbbreviations, isAllEnglishAbbrev } from '../textCleaning/abbreviations';
import { isBlocked } from '../moderation/filter';
import { resolveSynth } from './resolveSynth';
import type { SynthRequest } from '../tts/engine';
import { modelDisplayName, voiceDisplayName, formatVoiceList } from '../language/voiceMap';
import { laughterFor } from '../content/laughter';
import { JOKE_LANGUAGES, jokeLangByKey, pickJoke } from '../content/jokes';
import { log } from '../logging/logger';
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
 * Permissoes minimas que o Voxi precisa no servidor onde for convidado, derivadas
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
])
  .bitfield.toString();

export const commandDefs: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  // /invite — gatilho do loop viral: qualquer utilizador pode pedir o link de
  // convite OAuth2 do bot. Top-level e SEM setDefaultMemberPermissions (nao
  // admin-only), para que quem ouve o Voxi numa call o possa adicionar.
  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Show the link to add Voxi to your server')
    .toJSON(),
  // /vote — link para a pagina de voto do Voxi no top.gg (P11.5). Top-level e SEM
  // setDefaultMemberPermissions (NAO admin-only): qualquer utilizador pode votar.
  // Tal como o /invite, e um gatilho de crescimento — votar (gratis, a cada 12h)
  // sobe a visibilidade do bot no top.gg.
  new SlashCommandBuilder()
    .setName('vote')
    .setDescription('Show the link to vote for Voxi on top.gg')
    .toJSON(),
  // /help — discovery de comandos em-app, para donos de servidor nao-tecnicos.
  // Top-level e SEM setDefaultMemberPermissions (NAO admin-only): qualquer
  // utilizador pode pedir a lista. O texto e DERIVADO destes commandDefs (ver
  // handleHelp), por isso este comando inclui-se a si proprio no grupo "Geral".
  new SlashCommandBuilder()
    .setName('help')
    .setDescription("Show Voxi's command list")
    .toJSON(),
  new SlashCommandBuilder().setName('join').setDescription('Join your voice channel').toJSON(),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel').toJSON(),
  new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Voxi reads a text out loud')
    .addStringOption((o) => o.setName('texto').setDescription('What to read').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current audio').toJSON(),
  // /laugh — diversao por-utilizador (como /tts): o Voxi ri na voz ATUAL do user.
  // Sem opcoes, sem gate de admin; exige um player ativo (user numa call).
  new SlashCommandBuilder()
    .setName('laugh')
    .setDescription('Voxi laughs out loud in your current voice')
    .toJSON(),
  // /joke — conta uma piada curta na LINGUA escolhida. `idioma` usa AUTOCOMPLETE
  // (nao choices): suportamos ~34 linguas e o Discord limita choices estaticas a
  // 25. `risos` (obrigatorio) acrescenta uma gargalhada no fim.
  new SlashCommandBuilder()
    .setName('joke')
    .setDescription('Voxi tells a short joke in the language you pick')
    .addStringOption((o) =>
      o
        .setName('idioma')
        .setDescription('Language of the joke')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addBooleanOption((o) =>
      o.setName('risos').setDescription('Add laughter at the end?').setRequired(true),
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
        .addNumberOption((o) => o.setName('speed').setDescription('Speed (0.5-2.0)').setRequired(false)),
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
    .addSubcommandGroup((g) =>
      g
        .setName('abbrev')
        .setDescription('Manage your personal abbreviations')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Create a personal abbreviation')
            .addStringOption((o) => o.setName('termo').setDescription('Short word to replace').setRequired(true))
            .addStringOption((o) =>
              o.setName('leitura').setDescription('How it should be read out').setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a personal abbreviation')
            .addStringOption((o) => o.setName('termo').setDescription('Short word to remove').setRequired(true)),
        )
        .addSubcommand((s) => s.setName('list').setDescription('List your personal abbreviations')),
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
          o.setName('canal').setDescription('Text channel').addChannelTypes(ChannelType.GuildText).setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('autoread')
        .setDescription('Turn auto-read on/off')
        .addBooleanOption((o) => o.setName('ativo').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('max-chars')
        .setDescription('Maximum characters per message')
        .addIntegerOption((o) =>
          o.setName('valor').setDescription('1-2000').setRequired(true).setMinValue(1).setMaxValue(2000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('rate-limit')
        .setDescription('Messages per minute per user')
        .addIntegerOption((o) =>
          o.setName('valor').setDescription('1-120').setRequired(true).setMinValue(1).setMaxValue(120),
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
        .addBooleanOption((o) => o.setName('ativo').setDescription('on/off').setRequired(true)),
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
        // As CHOICES sao DERIVADAS de SUPPORTED_LOCALES (map -> {name,value}): quando
        // se adiciona um locale ao i18n, este comando acompanha automaticamente, sem
        // editar aqui. O nome legivel vem de LOCALE_DISPLAY_NAMES (endonimo).
        .addStringOption((o) =>
          o
            .setName('locale')
            .setDescription('Interface language')
            .setRequired(true)
            .addChoices(
              ...SUPPORTED_LOCALES.map((l) => ({ name: LOCALE_DISPLAY_NAMES[l], value: l })),
            ),
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
            .addStringOption((o) => o.setName('palavra').setDescription('Word to block').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a word')
            .addStringOption((o) => o.setName('palavra').setDescription('Word to unblock').setRequired(true)),
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
            .addStringOption((o) => o.setName('termo').setDescription('Term to replace').setRequired(true))
            .addStringOption((o) =>
              o.setName('pronuncia').setDescription('How it should be read').setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a term')
            .addStringOption((o) => o.setName('termo').setDescription('Term to remove').setRequired(true)),
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
        .setName('canal')
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
];

async function reply(i: ChatInputCommandInteraction, content: string): Promise<void> {
  await i.reply({ content, flags: MessageFlags.Ephemeral });
}

/**
 * Resultado (discriminado) de tentar juntar o Voxi ao canal de voz do invocador.
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
  removePlayer(deps, i.guildId!);
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: i.guildId!,
    adapterCreator: i.guild!.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });
  const player = new GuildVoicePlayer(connection, deps.engine, deps.config.queueCap, deps.config.inactivityMs, () => {
    // Identity-aware (defesa extra, cobre QUALQUER caller de onIdle): so agir se
    // este player ainda for o registado na guild. Se ja foi substituido (ex.: um
    // /join durante a reconexao instalou um player NOVO no mesmo slot), esta closure
    // e stale — remove-la iria derrubar o SUBSTITUTO e matar a sessao nova. No-op.
    if (deps.players.get(i.guildId!) !== player) return;
    removePlayer(deps, i.guildId!);
    getVoiceConnection(i.guildId!)?.destroy();
  });
  deps.players.set(i.guildId!, player);
  return { status: 'joined', channelName: channel.name };
}

async function handleJoin(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeFor(deps, i.guildId);
  const outcome = joinUserVoice(i, deps);
  switch (outcome.status) {
    case 'no-channel':
      await reply(i, t('join.needVoiceChannel', locale));
      return;
    case 'missing-perms':
      await reply(i, t('join.missingPerms', locale, { channel: outcome.channelName }));
      return;
    case 'joined':
      await reply(i, t('join.joined', locale, { channel: outcome.channelName }));
      return;
  }
}

async function handleLeave(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  removePlayer(deps, i.guildId!);
  getVoiceConnection(i.guildId!)?.destroy();
  await reply(i, t('leave.left', localeFor(deps, i.guildId)));
}

async function handleTts(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  // A sintese pode demorar ate ~15s; defer imediato para nao perder o token (3s).
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const locale = localeFor(deps, i.guildId);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await i.editReply(t('tts.notInVoice', locale));
    return;
  }
  const raw = i.options.getString('texto', true).trim();
  if (!raw) {
    await i.editReply(t('tts.nothingToRead', locale));
    return;
  }
  const cfg = getGuildConfig(deps.db, i.guildId!);

  // rate-limit por user (mesmo pipeline do messageHandler)
  const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
  if (!rl.allow(i.user.id, Date.now())) {
    await i.editReply(t('tts.tooFast', locale));
    return;
  }

  // limpeza de texto
  const cleaned = cleanText(raw, {
    maxChars: cfg.maxChars,
    resolveUser: (id: string) =>
      i.guild!.members.cache.get(id)?.displayName ??
      deps.client.users.cache.get(id)?.username ??
      'alguem',
    resolveChannel: (id: string) => {
      const ch = i.guild!.channels.cache.get(id);
      return ch && 'name' in ch ? (ch.name as string) : 'canal';
    },
  });
  // Guard de vazio endurecido (mesma regra do messageHandler): exige >=1 letra ou
  // numero (\p{L}\p{N}). Cobre '' e tambem texto so com pontuacao/simbolos/residuo
  // zero-width (rede de seguranca do strip de emoji) — nada legivel, nao vale
  // sintetizar. Nota: "!!!" (so-pontuacao) passa a responder nothingAfterClean.
  if (!/[\p{L}\p{N}]/u.test(cleaned)) {
    await i.editReply(t('tts.nothingAfterClean', locale));
    return;
  }

  // Abreviaturas PESSOAIS do utilizador (globais, chave = i.user.id): aplicadas
  // PRIMEIRO — precedencia pessoal > embutido. Em qualquer lingua; no-op se o user
  // nao tiver nenhuma.
  const personal = applyUserAbbrev(cleaned, getUserAbbrev(deps.db, i.user.id));

  // Stretch P18: mensagem SO com girias EN -> forca voz inglesa. Calculado sobre o
  // texto JA com as abreviaturas pessoais aplicadas, para que um atalho pessoal que
  // sombreie uma giria (ex. "brb"->"bora rapaz") nao force ingles indevidamente.
  const forceLang = isAllEnglishAbbrev(personal) ? 'eng' : undefined;

  // expansao de girias INGLESAS embutidas: DEPOIS das pessoais e ANTES da pronuncia
  // — mesma ordem do messageHandler. As girias sao SO EN e aplicam-se em qualquer
  // lingua. Expandir antes da pronuncia faz esta operar sobre a palavra ja expandida.
  const expanded = expandAbbreviations(personal);

  // dicionario de pronuncia por servidor: aplicado DEPOIS do cleanText e ANTES do
  // synth. Aplicado antes da blocklist para que o texto realmente falado seja o que
  // a blocklist guarda (uma pronuncia que produza uma palavra bloqueada e apanhada).
  const spoken = applyPronunciation(expanded, getPronunciations(deps.db, i.guildId!));

  // blocklist antes de sintetizar
  const blocklist = getBlocklist(deps.db, i.guildId!);
  if (isBlocked(spoken, blocklist)) {
    await i.editReply(t('tts.blocked', locale));
    return;
  }

  const userVoice = getUserVoice(deps.db, i.guildId!, i.user.id);
  const req = resolveSynth({
    text: spoken,
    userVoice,
    available: deps.availableModels,
    guildDefaultVoice: cfg.defaultVoice,
    defaultVoice: deps.config.defaultVoice,
    defaultSpeed: deps.config.defaultSpeed,
    forceLang,
  });
  // say() devolve false quando a fila esta no cap (nada foi enfileirado): nesse caso
  // NAO mentir "queued" — responder que estamos ocupados. So o sinal SINCRONO de
  // fila-cheia; nao esperamos pela reproducao real (fora de escopo).
  const queued = await player.say(req);
  await i.editReply(queued ? t('tts.queued', locale) : t('tts.busy', locale));
}

async function handleSkip(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeFor(deps, i.guildId);
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
 * /laugh — o Voxi ri na voz ATUALMENTE selecionada pelo utilizador. Por-utilizador
 * (como /tts), sem gate de admin, mas exige um player ativo (user numa call). A voz
 * e RESOLVIDA por precedencia (voz do user > default da guild > .env) e o riso e
 * escolhido pela LINGUA dessa voz (nao por deteccao) — por isso construimos o
 * SynthRequest DIRETAMENTE, sem passar por resolveSynth/detectLang (mesma logica do
 * /voice preview: a lingua e conhecida, nao detetada).
 */
async function handleLaugh(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  // A sintese pode demorar; defer imediato para nao perder o token (3s).
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const locale = localeFor(deps, i.guildId);
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
  const req: SynthRequest = { text: laughterFor(localePrefixOf(model)), model, speed };
  // say() devolve false quando a fila esta no cap: nesse caso reutilizamos tts.busy.
  const queued = await player.say(req);
  await i.editReply(queued ? t('laugh.playing', locale) : t('tts.busy', locale));
}

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
  const locale = localeFor(deps, i.guildId);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await i.editReply(t('tts.notInVoice', locale));
    return;
  }
  const langKey = i.options.getString('idioma', true);
  const lang = jokeLangByKey(langKey);
  if (!lang) {
    await i.editReply(t('joke.unknownLang', locale));
    return;
  }
  const risos = i.options.getBoolean('risos', true);

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

  // pickJoke e PURO/seeded; em runtime usamos Date.now() como seed (variedade sem
  // sacrificar a testabilidade determinista da funcao).
  const joke = pickJoke(langKey, Date.now());
  const text = risos ? `${joke} ${laughterFor(lang.prefix)}` : joke;
  const req: SynthRequest = { text, model, speed: deps.config.defaultSpeed };
  const queued = await player.say(req);
  // Confirmacao inclui a piada escrita (o user ve o que esta a ser lido).
  await i.editReply(queued ? t('joke.playing', locale, { joke }) : t('tts.busy', locale));
}

/**
 * /voice abbrev add|remove|list — abreviaturas PESSOAIS do utilizador, GLOBAIS
 * (chave = i.user.id, sem guild). Espelha a ESTRUTURA do /config pronunciation, mas
 * SEM gate de admin (e por-utilizador, sob o /voice que nao tem gate). As respostas
 * sao i18n (default ingles). Mapeia os reason-codes do store a mensagens amigaveis.
 */
async function handleVoiceAbbrev(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
  locale: string,
): Promise<void> {
  const sub = i.options.getSubcommand();
  const userId = i.user.id;

  // `list` nao tem opcoes: tratar ANTES de exigir o termo (getString(..., true) lancaria).
  if (sub === 'list') {
    const entries = getUserAbbrev(deps.db, userId);
    const body = entries.length
      ? entries.map((e) => `- ${e.term} -> ${e.replacement}`).join('\n')
      : t('voice.abbrev.listEmpty', locale);
    const header = t('voice.abbrev.listHeader', locale, {
      count: entries.length,
      cap: USER_ABBREV_CAP,
    });
    await reply(i, `${header}\n${body}`);
    return;
  }

  const term = i.options.getString('termo', true).trim();
  if (!term) {
    await reply(i, t('voice.abbrev.invalidTerm', locale));
    return;
  }

  if (sub === 'add') {
    const replacement = i.options.getString('leitura', true).trim();
    const res = addUserAbbrev(deps.db, userId, term, replacement);
    if (res.ok) {
      await reply(i, t('voice.abbrev.added', locale, { term: term.toLowerCase(), replacement }));
      return;
    }
    // Mapa reason-code -> chave i18n (mensagens distintas e amigaveis).
    switch (res.reason) {
      case 'cap':
        await reply(i, t('voice.abbrev.capReached', locale, { cap: USER_ABBREV_CAP }));
        return;
      case 'empty-replacement':
        await reply(i, t('voice.abbrev.emptyReplacement', locale));
        return;
      case 'too-long-replacement':
        await reply(i, t('voice.abbrev.tooLong', locale));
        return;
      case 'invalid-term':
      default:
        await reply(i, t('voice.abbrev.invalidTerm', locale));
        return;
    }
  }

  // remove
  removeUserAbbrev(deps.db, userId, term);
  await reply(i, t('voice.abbrev.removed', locale, { term: term.toLowerCase() }));
}

async function handleVoice(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeFor(deps, i.guildId);
  // Grupo `abbrev` PRIMEIRO (mesmo padrao do handleConfig): sem isto, o subcomando
  // `/voice abbrev list` daria getSubcommand()==='list' e cairia no ramo da lista de
  // modelos. As abreviaturas pessoais sao POR-UTILIZADOR e GLOBAIS (sem gate de
  // admin, sem guild) — usamos i.user.id como chave.
  const group = i.options.getSubcommandGroup(false);
  if (group === 'abbrev') {
    await handleVoiceAbbrev(i, deps, locale);
    return;
  }
  const sub = i.options.getSubcommand();
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
    setUserVoice(deps.db, i.guildId!, i.user.id, model, clamped);
    // Copy beginner-friendly: lidera com o nome amigavel (voiceDisplayName) e mantem
    // o id cru copy-pasteavel. Comportamento inalterado (so params de apresentacao).
    await reply(i, t('voice.set', locale, { name: voiceDisplayName(model), model, speed: clamped }));
  } else if (sub === 'list') {
    // Beginner-friendly: em vez de uma lista plana de ids Piper, agrupa por lingua
    // com nomes humanos (formatVoiceList). O id cru fica entre parenteses para
    // /voice set continuar copy-pasteavel. Cabecalho i18n; vozes/linguas autonimos.
    const list = deps.availableModels.length
      ? formatVoiceList(deps.availableModels)
      : t('voice.listEmpty', locale);
    await reply(i, `${t('voice.listHeader', locale)}\n${list}`);
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
    const req: SynthRequest = { text: SAMPLE, model, speed };
    // say() devolve false quando a fila esta no cap: nesse caso NAO mentir "a
    // reproduzir" — reutilizamos a mesma chave tts.busy do /tts (consistencia).
    const queued = await player.say(req);
    await reply(i, queued ? t('voice.previewPlaying', locale) : t('tts.busy', locale));
  }
}

async function handleConfig(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeFor(deps, i.guildId);
  const member = i.member as GuildMember;
  if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(i, t('error.needManageGuild', locale));
    return;
  }
  const group = i.options.getSubcommandGroup(false);
  if (group === 'blockword') {
    const sub = i.options.getSubcommand();
    const word = i.options.getString('palavra', true).trim();
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
    const term = i.options.getString('termo', true).trim();
    if (!term) {
      await reply(i, t('config.termEmpty', locale));
      return;
    }
    if (sub === 'add') {
      const replacement = i.options.getString('pronuncia', true).trim();
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
    const ch = i.options.getChannel('canal', true);
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
    const on = i.options.getBoolean('ativo', true);
    setGuildConfig(deps.db, i.guildId!, { autoread: on });
    await reply(i, on ? t('config.autoreadOn', locale) : t('config.autoreadOff', locale));
  } else if (sub === 'max-chars') {
    const v = i.options.getInteger('valor', true);
    if (v < 1 || v > 2000) {
      await reply(i, t('config.maxCharsRange', locale));
      return;
    }
    setGuildConfig(deps.db, i.guildId!, { maxChars: v });
    await reply(i, t('config.maxCharsSet', locale, { value: v }));
  } else if (sub === 'rate-limit') {
    const v = i.options.getInteger('valor', true);
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
    const on = i.options.getBoolean('ativo', true);
    setGuildConfig(deps.db, i.guildId!, { enabled: on });
    await reply(i, on ? t('config.enabledOn', locale) : t('config.enabledOff', locale));
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
    await reply(i, t('config.defaultVoiceSet', locale, { name: voiceDisplayName(model), model }));
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
  const locale = localeFor(deps, i.guildId);
  const member = i.member as GuildMember;
  if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(i, t('error.needManageGuild', locale));
    return;
  }

  // (a) Resolver o canal alvo: opcao `canal` ou, se omitida, o canal da interacao.
  const ref = (i.options.getChannel('canal', false) as { id: string; type?: number } | null) ?? i.channel;
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

  await reply(i, lines.join('\n'));
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
    t('stats.voiceDrops', locale, { value: snap.voiceDrops }),
    t('stats.voiceReconnects', locale, { value: snap.voiceReconnects }),
    t('stats.votes', locale, { value: snap.votes }),
    t('stats.activePlayers', locale, { value: deps.players.size }),
    t('stats.servers', locale, { value: deps.client.guilds.cache.size }),
    t('stats.uptime', locale, { value: uptimeSec }),
  ];
  await reply(i, lines.join('\n'));
}

/**
 * /invite — devolve o URL de convite OAuth2 do bot, construido a partir do
 * CLIENT_ID da config. Gatilho do "loop viral".
 *
 * Decisoes de design:
 *  - Reply NORMAL (nao ephemeral): o objetivo do comando e partilhar o link, por
 *    isso queremos que fique visivel no canal para quem mais quiser adicionar o
 *    Voxi. Por isso NAO usamos o helper reply() (que e ephemeral) — chamamos
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
  const locale = localeFor(deps, i.guildId);
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
  await i.reply({ content: t('invite.link', locale, { url }) });
}

/**
 * /vote — devolve o link da pagina de voto do Voxi no top.gg (P11.5),
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
  const locale = localeFor(deps, i.guildId);
  const clientId = deps.config.clientId;
  if (!clientId) {
    await reply(i, t('vote.noClientId', locale));
    return;
  }
  const url = `https://top.gg/bot/${clientId}/vote`;
  await i.reply({ content: t('vote.link', locale, { url }) });
}

/**
 * /help — discovery de comandos em-app, pensado para PRINCIPIANTES (dono de
 * servidor ou membro que nunca usou o bot). Responde com um EMBED beginner-friendly:
 * intro do que o Voxi faz + um "Quick start (3 steps)" + comandos AGRUPADOS por
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
  // Locale da INTERFACE por guild (default 'en'). Em DMs (guildId null) usamos o
  // default via localeFor, que nunca lanca.
  const locale = localeFor(deps, i.guildId);

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

  const embed = new EmbedBuilder()
    .setColor(0x5865f2) // blurple — parece intencional, nao o cinzento default
    .setTitle(t('help.embedTitle', locale))
    // Descricao: tagline da marca + o que o Voxi faz (intro) + o diferenciador
    // (voz neural gratis) — a mesma chave do welcome embed.
    .setDescription(`${t('help.title', locale)}\n${t('help.intro', locale)}\n\n${t('welcome.tagline', locale)}`)
    .addFields(fields)
    .setFooter({ text: t('help.footer', locale, { command: '/setup' }) });

  await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/**
 * Filtra os modelos disponíveis pelo que o utilizador escreveu (case-insensitive),
 * limitado a 25 (máximo do Discord para autocomplete). Função pura e testável.
 */
export function filterModelChoices(
  models: string[],
  query: string,
): { name: string; value: string }[] {
  const q = query.trim().toLowerCase();
  return models
    .map((m) => ({ name: modelDisplayName(m), value: m }))
    .filter((c) => c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q))
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
 * Autocomplete das opções `model` (/voice set, /voice preview, /config
 * default-voice) e `idioma` (/joke): mostra as vozes REALMENTE instaladas / as
 * linguas suportadas para o utilizador escolher de uma lista, em vez de escrever o
 * nome à mão. Beginner-friendly. Qualquer outra opção -> [] (sem sugestões).
 */
export async function handleAutocomplete(
  i: AutocompleteInteraction,
  deps: BotDeps,
): Promise<void> {
  try {
    const focused = i.options.getFocused(true);
    if (focused.name === 'model') {
      await i.respond(filterModelChoices(deps.availableModels, focused.value));
      return;
    }
    if (focused.name === 'idioma') {
      await i.respond(filterJokeLanguages(focused.value));
      return;
    }
    await i.respond([]);
  } catch (err) {
    log.error('[autocomplete] erro', err);
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
      case 'laugh':
        return await handleLaugh(i, deps);
      case 'joke':
        return await handleJoke(i, deps);
      case 'voice':
        return await handleVoice(i, deps);
      case 'config':
        return await handleConfig(i, deps);
      case 'setup':
        return await handleSetup(i, deps);
      case 'stats':
        return await handleStats(i, deps);
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
