// src/commands/handlers/config.ts — handlers de /config, /setup e /stats (admin) extraídos de index.ts (plano 015).
import {
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import type { BotDeps } from '../../bot/deps';
import { metrics } from '../../metrics';
import { brandEmbed } from '../../ui/theme';
import { getGuildConfig, setGuildConfig, resetGuildConfig } from '../../store/guildConfig';
import { addBlockword, removeBlockword, getBlocklist } from '../../store/blocklist';
import {
  getPronunciations,
  addPronunciation,
  removePronunciation,
} from '../../store/pronunciation';
import { makeLocalizedNamer } from '../../language/voiceMap';
import { GREET_LANGUAGE_CHOICES, GREET_LOCALES } from '../../voice/greeting';
import { t, SUPPORTED_LOCALES, LOCALE_DISPLAY_NAMES, type SupportedLocale } from '../../i18n/index';
import { localeFor, localeForUser, reply } from '../helpers';
import { joinUserVoice } from './core';

export async function handleConfig(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
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
  } else if (sub === 'antispam') {
    // Não ler mensagens spamadas (repetição massiva / mesma msg grande repetida).
    // DESLIGADO por defeito (opt-in).
    const on = i.options.getBoolean('active', true);
    setGuildConfig(deps.db, i.guildId!, { antispam: on });
    await reply(i, on ? t('config.antispamOn', locale) : t('config.antispamOff', locale));
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
    await reply(
      i,
      t('config.defaultVoiceSet', locale, {
        name: makeLocalizedNamer(i.locale, deps.availableModels)(model),
        model,
      }),
    );
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
    await reply(i, t('config.language.set', chosen, { language: LOCALE_DISPLAY_NAMES[chosen] }));
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
      t('config.showAntispam', locale, { value: cfg.antispam ? on : off }),
      t('config.showGreet', locale, {
        value: cfg.greetOnJoin ? on : off,
        language:
          GREET_LANGUAGE_CHOICES.find((c) => c.value === cfg.greetLocale)?.name ?? cfg.greetLocale,
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
export async function handleSetup(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const member = i.member as GuildMember;
  if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(i, t('error.needManageGuild', locale));
    return;
  }

  // (a) Resolver o canal alvo: opcao `channel` ou, se omitida, o canal da interacao.
  const ref =
    (i.options.getChannel('channel', false) as { id: string; type?: number } | null) ?? i.channel;
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
    lines.push(
      '',
      joinedChannelName !== null ? t('setup.readyTalk', locale) : t('setup.allGood', locale),
    );
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

export async function handleStats(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
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
  await i.reply({
    embeds: [brandEmbed().setDescription(lines.join('\n'))],
    flags: MessageFlags.Ephemeral,
  });
}
