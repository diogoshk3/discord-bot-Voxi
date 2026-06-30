import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
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
import { cleanText } from '../textCleaning/clean';
import { applyPronunciation } from '../textCleaning/pronunciation';
import { isBlocked } from '../moderation/filter';
import { resolveSynth } from './resolveSynth';
import { log } from '../logging/logger';

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
    .setDescription('Mostra o link para adicionar o Voxi ao teu servidor')
    .toJSON(),
  new SlashCommandBuilder().setName('join').setDescription('Entra no teu canal de voz').toJSON(),
  new SlashCommandBuilder().setName('leave').setDescription('Sai do canal de voz').toJSON(),
  new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Voxi le um texto em voz alta')
    .addStringOption((o) => o.setName('texto').setDescription('O que ler').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder().setName('skip').setDescription('Salta o audio atual').toJSON(),
  new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Gere a tua voz')
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Define a tua voz')
        .addStringOption((o) => o.setName('model').setDescription('Modelo Piper').setRequired(true))
        .addNumberOption((o) => o.setName('speed').setDescription('Velocidade (0.5-2.0)').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Lista os modelos disponiveis'))
    .addSubcommand((s) => s.setName('reset').setDescription('Repoe a tua voz por defeito'))
    .addSubcommand((s) =>
      s.setName('optout').setDescription('Deixa de ser lido automaticamente no canal de auto-leitura'),
    )
    .addSubcommand((s) =>
      s.setName('optin').setDescription('Volta a ser lido automaticamente no canal de auto-leitura'),
    )
    .addSubcommand((s) =>
      s
        .setName('preview')
        .setDescription('Toca uma frase de amostra na tua voz atual (ou num modelo especifico)')
        .addStringOption((o) =>
          o.setName('model').setDescription('Modelo Piper (opcional)').setRequired(false),
        ),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configuracao do servidor (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('tts-channel')
        .setDescription('Define o canal de auto-leitura')
        .addChannelOption((o) =>
          o.setName('canal').setDescription('Canal de texto').addChannelTypes(ChannelType.GuildText).setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('autoread')
        .setDescription('Liga/desliga auto-leitura')
        .addBooleanOption((o) => o.setName('ativo').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('max-chars')
        .setDescription('Maximo de caracteres por mensagem')
        .addIntegerOption((o) =>
          o.setName('valor').setDescription('1-2000').setRequired(true).setMinValue(1).setMaxValue(2000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('rate-limit')
        .setDescription('Mensagens por minuto por user')
        .addIntegerOption((o) =>
          o.setName('valor').setDescription('1-120').setRequired(true).setMinValue(1).setMaxValue(120),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('role')
        .setDescription('Restringe a auto-leitura a um role (omitir o role limpa a restricao)')
        .addRoleOption((o) =>
          o.setName('role').setDescription('Role permitido (vazio = sem restricao)').setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('enabled')
        .setDescription('Liga/desliga o TTS neste servidor (kill-switch)')
        .addBooleanOption((o) => o.setName('ativo').setDescription('on/off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('default-voice')
        .setDescription('Define a voz default do servidor (usada quando o user nao tem voz propria)')
        .addStringOption((o) => o.setName('model').setDescription('Modelo Piper').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('show').setDescription('Mostra a configuracao atual do servidor'))
    .addSubcommand((s) => s.setName('reset').setDescription('Repoe a configuracao do servidor aos valores por defeito'))
    .addSubcommandGroup((g) =>
      g
        .setName('blockword')
        .setDescription('Gere a blocklist')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Adiciona palavra')
            .addStringOption((o) => o.setName('palavra').setDescription('Palavra a bloquear').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove palavra')
            .addStringOption((o) => o.setName('palavra').setDescription('Palavra a desbloquear').setRequired(true)),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('pronunciation')
        .setDescription('Gere o dicionario de pronuncia')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Adiciona/edita um termo')
            .addStringOption((o) => o.setName('termo').setDescription('Termo a substituir').setRequired(true))
            .addStringOption((o) =>
              o.setName('pronuncia').setDescription('Como deve ser lido').setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove um termo')
            .addStringOption((o) => o.setName('termo').setDescription('Termo a remover').setRequired(true)),
        )
        .addSubcommand((s) => s.setName('list').setDescription('Lista os termos definidos')),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configuracao guiada num so passo (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName('canal')
        .setDescription('Canal de auto-leitura (omitir = usa o canal atual)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Estatísticas do bot (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

async function reply(i: ChatInputCommandInteraction, content: string): Promise<void> {
  await i.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleJoin(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const member = i.member as GuildMember;
  const channel = member?.voice?.channel;
  if (!channel) {
    await reply(i, 'Tens de estar num canal de voz.');
    return;
  }
  // Verificar permissoes Connect/Speak ANTES de tocar no player existente: um
  // /join para um canal proibido nao deve destruir um player que ja funciona.
  const me = deps.client.user;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms || !perms.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
    await reply(i, `Nao tenho permissao para Ligar/Falar em ${channel.name}.`);
    return;
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
    removePlayer(deps, i.guildId!);
    getVoiceConnection(i.guildId!)?.destroy();
  });
  deps.players.set(i.guildId!, player);
  await reply(i, `Entrei em ${channel.name}.`);
}

async function handleLeave(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  removePlayer(deps, i.guildId!);
  getVoiceConnection(i.guildId!)?.destroy();
  await reply(i, 'Sai do canal de voz.');
}

async function handleTts(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  // A sintese pode demorar ate ~15s; defer imediato para nao perder o token (3s).
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await i.editReply('Nao estou num canal de voz. Usa /join primeiro.');
    return;
  }
  const raw = i.options.getString('texto', true).trim();
  if (!raw) {
    await i.editReply('Nada para ler.');
    return;
  }
  const cfg = getGuildConfig(deps.db, i.guildId!);

  // rate-limit por user (mesmo pipeline do messageHandler)
  const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
  if (!rl.allow(i.user.id, Date.now())) {
    await i.editReply('Estas a ir rapido demais. Espera um pouco.');
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
  if (!cleaned) {
    await i.editReply('Nada para ler depois da limpeza.');
    return;
  }

  // dicionario de pronuncia por servidor: aplicado DEPOIS do cleanText e ANTES do
  // synth. Aplicado antes da blocklist para que o texto realmente falado seja o que
  // a blocklist guarda (uma pronuncia que produza uma palavra bloqueada e apanhada).
  const spoken = applyPronunciation(cleaned, getPronunciations(deps.db, i.guildId!));

  // blocklist antes de sintetizar
  const blocklist = getBlocklist(deps.db, i.guildId!);
  if (isBlocked(spoken, blocklist)) {
    await i.editReply('Esse texto contem uma palavra bloqueada.');
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
  });
  await player.say(req);
  await i.editReply('Na fila.');
}

async function handleSkip(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await reply(i, 'Nao estou num canal de voz.');
    return;
  }
  player.skip();
  await reply(i, 'Saltado.');
}

async function handleVoice(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const sub = i.options.getSubcommand();
  if (sub === 'set') {
    const model = i.options.getString('model', true);
    if (!deps.availableModels.includes(model)) {
      await reply(i, `Modelo desconhecido. Usa /voice list.`);
      return;
    }
    const speed = i.options.getNumber('speed') ?? deps.config.defaultSpeed;
    const clamped = Math.min(2.0, Math.max(0.5, speed));
    setUserVoice(deps.db, i.guildId!, i.user.id, model, clamped);
    await reply(i, `Voz definida: ${model} @ ${clamped}x.`);
  } else if (sub === 'list') {
    const list = deps.availableModels.length ? deps.availableModels.map((m) => `- ${m}`).join('\n') : '(nenhum)';
    await reply(i, `Modelos disponiveis:\n${list}`);
  } else if (sub === 'reset') {
    resetUserVoice(deps.db, i.guildId!, i.user.id);
    await reply(i, 'Voz reposta por defeito.');
  } else if (sub === 'optout') {
    // Por-utilizador (sem gate de admin): cada um gere o seu opt-out da auto-leitura.
    setOptOut(deps.db, i.guildId!, i.user.id);
    await reply(i, 'Ja nao seras lido automaticamente. Usa /voice optin para voltar.');
  } else if (sub === 'optin') {
    setOptIn(deps.db, i.guildId!, i.user.id);
    await reply(i, 'Voltas a ser lido automaticamente.');
  } else if (sub === 'preview') {
    const SAMPLE = 'Ola, eu sou o Voxi. type it, hear it.';
    const explicitModel = i.options.getString('model');

    // Valida o model explícito ANTES de verificar o player.
    if (explicitModel !== null && !deps.availableModels.includes(explicitModel)) {
      await reply(i, 'Modelo desconhecido. Usa /voice list.');
      return;
    }

    const player = getPlayer(deps, i.guildId!);
    if (!player) {
      await reply(i, 'Nao estou num canal de voz. Usa /join primeiro.');
      return;
    }

    const cfg = getGuildConfig(deps.db, i.guildId!);
    const stored = getUserVoice(deps.db, i.guildId!, i.user.id);
    // Se foi dado um model explícito, constrói um userVoice sintético para que
    // resolveSynth o use directamente (sem deteção de língua). A velocidade
    // vem da voz guardada do utilizador, senão do default global.
    const userVoice =
      explicitModel !== null
        ? { model: explicitModel, speed: stored?.speed ?? deps.config.defaultSpeed }
        : stored;
    const req = resolveSynth({
      text: SAMPLE,
      userVoice,
      available: deps.availableModels,
      guildDefaultVoice: cfg.defaultVoice,
      defaultVoice: deps.config.defaultVoice,
      defaultSpeed: deps.config.defaultSpeed,
    });
    await player.say(req);
    await reply(i, 'A reproduzir uma amostra…');
  }
}

async function handleConfig(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const member = i.member as GuildMember;
  if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(i, 'Precisas da permissao Gerir Servidor.');
    return;
  }
  const group = i.options.getSubcommandGroup(false);
  if (group === 'blockword') {
    const sub = i.options.getSubcommand();
    const word = i.options.getString('palavra', true).trim();
    if (!word) {
      await reply(i, 'A palavra nao pode ser vazia.');
      return;
    }
    if (sub === 'add') {
      addBlockword(deps.db, i.guildId!, word);
      await reply(i, `Bloqueado: ${word}.`);
    } else {
      removeBlockword(deps.db, i.guildId!, word);
      await reply(i, `Desbloqueado: ${word}.`);
    }
    return;
  }
  if (group === 'pronunciation') {
    const sub = i.options.getSubcommand();
    // `list` nao tem opcoes: tratar ANTES de exigir o termo (getString(..., true) lancaria).
    if (sub === 'list') {
      const dict = getPronunciations(deps.db, i.guildId!);
      const out = dict.length
        ? dict.map((e) => `- ${e.term} -> ${e.replacement || '(vazio)'}`).join('\n')
        : '(nenhum)';
      await reply(i, `Dicionario de pronuncia:\n${out}`);
      return;
    }
    const term = i.options.getString('termo', true).trim();
    if (!term) {
      await reply(i, 'O termo nao pode ser vazio.');
      return;
    }
    if (sub === 'add') {
      const replacement = i.options.getString('pronuncia', true).trim();
      if (!replacement) {
        await reply(i, 'A pronuncia nao pode ser vazia.');
        return;
      }
      addPronunciation(deps.db, i.guildId!, term, replacement);
      await reply(i, `Pronuncia definida: ${term} -> ${replacement}.`);
    } else {
      removePronunciation(deps.db, i.guildId!, term);
      await reply(i, `Pronuncia removida: ${term}.`);
    }
    return;
  }
  const sub = i.options.getSubcommand();
  if (sub === 'tts-channel') {
    const ch = i.options.getChannel('canal', true);
    if (ch.type !== ChannelType.GuildText) {
      await reply(i, 'Tens de escolher um canal de texto (nao voz nem categoria).');
      return;
    }
    const me = deps.client.user;
    // ch pode ser um objeto parcial (APIChannel) — usa guild.channels.cache para obter o canal completo
    const fullCh = i.guild?.channels.cache.get(ch.id);
    const perms = me && fullCh ? fullCh.permissionsFor(me) : null;
    if (!perms || !perms.has(PermissionFlagsBits.ViewChannel)) {
      await reply(i, `Nao tenho acesso ao canal <#${ch.id}>. Verifica as permissoes.`);
      return;
    }
    setGuildConfig(deps.db, i.guildId!, { ttsChannelId: ch.id });
    await reply(i, `Canal de auto-leitura: <#${ch.id}>.`);
  } else if (sub === 'autoread') {
    const on = i.options.getBoolean('ativo', true);
    setGuildConfig(deps.db, i.guildId!, { autoread: on });
    await reply(i, `Auto-leitura: ${on ? 'ligada' : 'desligada'}.`);
  } else if (sub === 'max-chars') {
    const v = i.options.getInteger('valor', true);
    if (v < 1 || v > 2000) {
      await reply(i, 'O valor de max-chars tem de estar entre 1 e 2000.');
      return;
    }
    setGuildConfig(deps.db, i.guildId!, { maxChars: v });
    await reply(i, `Max chars: ${v}.`);
  } else if (sub === 'rate-limit') {
    const v = i.options.getInteger('valor', true);
    if (v < 1 || v > 120) {
      await reply(i, 'O valor de rate-limit tem de estar entre 1 e 120.');
      return;
    }
    setGuildConfig(deps.db, i.guildId!, { ratePerMin: v });
    await reply(i, `Rate-limit: ${v}/min.`);
  } else if (sub === 'role') {
    // Opcao de role e opcional: omiti-la (getRole devolve null) limpa a restricao.
    const role = i.options.getRole('role', false);
    if (role) {
      setGuildConfig(deps.db, i.guildId!, { ttsRoleId: role.id });
      await reply(i, `Auto-leitura restrita ao role <@&${role.id}>.`);
    } else {
      setGuildConfig(deps.db, i.guildId!, { ttsRoleId: null });
      await reply(i, 'Restricao de role removida: todos podem ser lidos.');
    }
  } else if (sub === 'enabled') {
    // Kill-switch do servidor: o messageHandler ja ignora tudo quando enabled=false.
    const on = i.options.getBoolean('ativo', true);
    setGuildConfig(deps.db, i.guildId!, { enabled: on });
    await reply(i, on ? 'TTS ativado neste servidor.' : 'TTS desativado neste servidor.');
  } else if (sub === 'default-voice') {
    // Valida contra os modelos disponiveis, tal como /voice set.
    const model = i.options.getString('model', true);
    if (!deps.availableModels.includes(model)) {
      await reply(i, 'Modelo desconhecido. Usa /voice list.');
      return;
    }
    setGuildConfig(deps.db, i.guildId!, { defaultVoice: model });
    await reply(i, `Voz default do servidor: ${model}.`);
  } else if (sub === 'show') {
    const cfg = getGuildConfig(deps.db, i.guildId!);
    const blocklistCount = getBlocklist(deps.db, i.guildId!).length;
    const pronunciationCount = getPronunciations(deps.db, i.guildId!).length;
    const channelStr = cfg.ttsChannelId ? `<#${cfg.ttsChannelId}>` : '(nenhum)';
    const roleStr = cfg.ttsRoleId ? `<@&${cfg.ttsRoleId}>` : 'qualquer';
    const voiceStr = cfg.defaultVoice || '(deteção automática)';
    const lines = [
      '**Configuracao do servidor:**',
      `Canal TTS: ${channelStr}`,
      `Autoread: ${cfg.autoread ? 'on' : 'off'}`,
      `Role: ${roleStr}`,
      `Enabled: ${cfg.enabled ? 'on' : 'off'}`,
      `Voz default: ${voiceStr}`,
      `Max chars: ${cfg.maxChars}`,
      `Rate-limit: ${cfg.ratePerMin}/min`,
      `Blocklist: ${blocklistCount} palavras`,
      `Pronuncia: ${pronunciationCount} entradas`,
    ];
    await reply(i, lines.join('\n'));
  } else if (sub === 'reset') {
    resetGuildConfig(deps.db, i.guildId!);
    await reply(
      i,
      'Config reposta aos valores por defeito. Blocklist e pronuncia mantidas.',
    );
  }
}

// Estado de cada item do checklist de permissoes:
//  - 'ok'         -> o bot tem a permissao
//  - 'missing'    -> o bot NAO tem a permissao (precisa de ser corrigida)
//  - 'unchecked'  -> nao foi possivel verificar agora (ex.: perms de voz quando
//                    o invocador nao esta num canal de voz) — sera validada no /join
type PermState = 'ok' | 'missing' | 'unchecked';

function permLine(label: string, state: PermState): string {
  if (state === 'ok') return `✅ ${label}`;
  if (state === 'missing') return `❌ ${label} — falta`;
  return `⏳ ${label} — nao verificado (sera validado no /join)`;
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
  const member = i.member as GuildMember;
  if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(i, 'Precisas da permissao Gerir Servidor.');
    return;
  }

  // (a) Resolver o canal alvo: opcao `canal` ou, se omitida, o canal da interacao.
  const ref = (i.options.getChannel('canal', false) as { id: string; type?: number } | null) ?? i.channel;
  if (!ref || !('id' in ref)) {
    await reply(i, 'Nao consegui identificar o canal. Indica um canal de texto na opcao "canal".');
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
    await reply(
      i,
      'O canal de auto-leitura tem de ser um canal de texto do servidor (nao voz nem categoria). Indica um na opcao "canal".',
    );
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

  // (d) Resumo beginner-friendly.
  const lines: string[] = [
    '**Setup do Voxi concluido.**',
    `Canal de auto-leitura: <#${fullCh.id}>`,
    'Auto-leitura: ligada',
    '',
    '**Permissoes:**',
    permLine('ViewChannel (ver o canal de texto)', viewState),
    permLine('SendMessages (escrever no canal de texto)', sendState),
    permLine('Connect (ligar ao canal de voz)', connectState),
    permLine('Speak (falar no canal de voz)', speakState),
  ];

  const anyMissing = [viewState, sendState, connectState, speakState].includes('missing');
  if (anyMissing) {
    lines.push(
      '',
      'Para corrigir o que falta: nas definicoes do servidor abre o role do Voxi (ou as permissoes do canal) e ativa as permissoes marcadas com ❌.',
    );
  }
  if (connectState === 'unchecked' || speakState === 'unchecked') {
    lines.push(
      '',
      'Nao estas num canal de voz, por isso nao deu para verificar Connect/Speak agora — serao validados quando correres /join.',
    );
  }
  if (!anyMissing && connectState === 'ok' && speakState === 'ok') {
    lines.push('', 'Esta tudo pronto. Entra num canal de voz e usa /join.');
  }

  await reply(i, lines.join('\n'));
}

async function handleStats(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const member = i.member as GuildMember;
  if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(i, 'Precisas da permissao Gerir Servidor.');
    return;
  }
  const snap = metrics.snapshot();
  const uptimeSec = Math.floor(process.uptime());
  const lines = [
    '**Estatisticas do Voxi:**',
    `Mensagens faladas: ${snap.messagesSpoken}`,
    `Cache hits: ${snap.cacheHits}`,
    `Cache misses: ${snap.cacheMisses}`,
    `Erros de sintese: ${snap.synthErrors}`,
    `Quedas de voz: ${snap.voiceDrops}`,
    `Reconexoes: ${snap.voiceReconnects}`,
    `Players ativos: ${deps.players.size}`,
    `Servidores: ${deps.client.guilds.cache.size}`,
    `Uptime: ${uptimeSec}s`,
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
  const clientId = deps.config.clientId;
  if (!clientId) {
    await i.reply({
      content:
        'O link de convite ainda nao esta configurado (CLIENT_ID em falta). Avisa o admin do bot.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: INVITE_PERMISSIONS,
  });
  const url = `https://discord.com/oauth2/authorize?${params.toString()}`;
  await i.reply({ content: `Adiciona o Voxi ao teu servidor:\n${url}` });
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
    }
  } catch (err) {
    log.error('[command] erro em', i.commandName, err);
    if (!i.isRepliable()) return;
    if (i.deferred && !i.replied) {
      // Ja foi deferido (caso do /tts): editReply para o utilizador receber o erro
      // em vez de ficar preso em "a pensar...".
      await i.editReply({ content: 'Ocorreu um erro.' }).catch(() => {});
    } else if (!i.replied) {
      await i.reply({ content: 'Ocorreu um erro.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
