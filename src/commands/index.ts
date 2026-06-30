import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  GuildMember,
  ChannelType,
  MessageFlags,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import type { BotDeps } from '../bot/deps';
import { getPlayer, removePlayer, getLimiter } from '../bot/deps';
import { GuildVoicePlayer } from '../voice/player';
import { getUserVoice, setUserVoice, resetUserVoice } from '../store/userVoice';
import { getGuildConfig, setGuildConfig } from '../store/guildConfig';
import { addBlockword, removeBlockword, getBlocklist } from '../store/blocklist';
import { cleanText } from '../textCleaning/clean';
import { isBlocked } from '../moderation/filter';
import { resolveSynth } from './resolveSynth';

export const commandDefs: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder().setName('join').setDescription('Entra no teu canal de voz').toJSON(),
  new SlashCommandBuilder().setName('leave').setDescription('Sai do canal de voz').toJSON(),
  new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Le um texto em voz alta')
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

  // blocklist antes de sintetizar
  const blocklist = getBlocklist(deps.db, i.guildId!);
  if (isBlocked(cleaned, blocklist)) {
    await i.editReply('Esse texto contem uma palavra bloqueada.');
    return;
  }

  const userVoice = getUserVoice(deps.db, i.guildId!, i.user.id);
  const req = resolveSynth({
    text: cleaned,
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
      case 'voice':
        return await handleVoice(i, deps);
      case 'config':
        return await handleConfig(i, deps);
    }
  } catch (err) {
    console.error('[command] erro em', i.commandName, err);
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
