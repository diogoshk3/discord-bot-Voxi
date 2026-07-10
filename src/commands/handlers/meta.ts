// src/commands/handlers/meta.ts — handlers informativos/de crescimento: /help, /invite, /vote, /uptime, /botstats, /topspeakers, /premium, /vozengrant (extraídos de index.ts, plano 015).
import {
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import type { BotDeps } from '../../bot/deps';
import { metrics } from '../../metrics';
import { brandEmbed } from '../../ui/theme';
import { getTopSpeakers } from '../../store/talkStats';
import {
  getUserPremiumExpiry,
  isGuildPremium,
  effectiveGuildPremiumExpiry,
  getPremiumPass,
  countActiveSeats,
  listPassActivations,
  activateSeat,
  deactivateSeat,
  grantGuildPass,
  grantUserPremium,
} from '../../store/premium';
import { randomInt } from 'node:crypto';
import { t } from '../../i18n/index';
import { INVITE_PERMISSIONS, formatDuration, localeForUser, reply } from '../helpers';
import { commandDefs } from '../index';
import { insertPremiumCode, redeemPremiumCode } from '../../store/premiumCode';
import { generateCodeString, normalizeCode } from '../../premium/codeGen';

/**
 * /topspeakers — ranking público de quem teve mais mensagens LIDAS pelo Vozen nesta guild,
 * com o streak (dias seguidos a falar) de cada um. Mesma renderização do game leaderboard
 * (<@id> + linhas i18n). Vazio -> mensagem a convidar a falar.
 */
export async function handleTopSpeakers(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
): Promise<void> {
  const locale = localeForUser(deps, i);
  const rows = getTopSpeakers(deps.db, i.guildId!, new Date(), 10);
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

// Discord renderiza <t:SEGUNDOS:D> como data localizada por-utilizador.
const stampDate = (ms: number): string => `<t:${Math.floor(ms / 1000)}:D>`;

/** Nomes dos servidores (best-effort via cache; fallback = id) para as mensagens do passe. */
function serverNames(deps: BotDeps, ids: string[]): string {
  return ids.map((id) => deps.client.guilds.cache.get(id)?.name ?? id).join(', ');
}

/** /premium — despacha os subcomandos info | activate | deactivate. */
export async function handlePremium(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const sub = i.options.getSubcommand(false) ?? 'info';
  if (sub === 'activate') return handlePremiumActivate(i, deps);
  if (sub === 'deactivate') return handlePremiumDeactivate(i, deps);
  return handlePremiumInfo(i, deps);
}

/** /premium info — estado (servidor + passe + Plus) OU montra + link de compra. */
async function handlePremiumInfo(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const now = Date.now();
  const lines: string[] = [];

  const guildActive = i.guildId ? isGuildPremium(deps.db, i.guildId, now) : false;
  if (i.guildId) {
    if (guildActive) {
      const exp = effectiveGuildPremiumExpiry(deps.db, i.guildId, now);
      lines.push(t('premium.lineServerActive', locale, { date: stampDate(exp ?? now) }));
    } else {
      lines.push(t('premium.lineServerFree', locale));
    }
  }

  const pass = getPremiumPass(deps.db, i.user.id);
  const passActive = pass !== null && pass.expiresAt > now;
  if (passActive) {
    const used = countActiveSeats(deps.db, i.user.id);
    lines.push(
      t('premium.linePass', locale, {
        used,
        total: pass!.seats,
        date: stampDate(pass!.expiresAt),
      }),
    );
    const acts = listPassActivations(deps.db, i.user.id);
    if (acts.length)
      lines.push(t('premium.passServers', locale, { servers: serverNames(deps, acts) }));
  }

  const uExp = getUserPremiumExpiry(deps.db, i.user.id);
  const uActive = uExp !== null && uExp > now;
  lines.push(
    uActive
      ? t('premium.lineUserActive', locale, { date: stampDate(uExp!) })
      : t('premium.lineUserFree', locale),
  );

  const anyActive = guildActive || passActive || uActive;
  const desc = anyActive
    ? lines
    : [t('premium.pitch', locale), '', t('premium.buyHint', locale, { link: deps.config.kofiUrl })];
  const embed = brandEmbed(anyActive ? 'premium' : 'brand')
    .setTitle(t('premium.title', locale))
    .setDescription(desc.join('\n'));
  await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/**
 * /premium activate — gasta 1 licença do passe NESTE servidor, com pop-up de confirmação.
 * Precisa de Gerir Servidor (ativar Premium afeta o servidor inteiro). A confirmação é
 * efémera (só o invocador a vê), por isso não é preciso filtrar cliques de terceiros.
 */
async function handlePremiumActivate(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const member = i.member as GuildMember | null;
  if (!i.guildId || !member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(i, t('premium.needManageGuild', locale));
    return;
  }
  const now = Date.now();
  const pass = getPremiumPass(deps.db, i.user.id);
  if (!pass || pass.expiresAt <= now) {
    await reply(i, t('premium.noPass', locale, { link: deps.config.kofiUrl }));
    return;
  }
  const acts = listPassActivations(deps.db, i.user.id);
  if (acts.includes(i.guildId)) {
    await reply(i, t('premium.alreadyActive', locale));
    return;
  }
  if (acts.length >= pass.seats) {
    await reply(
      i,
      t('premium.noSeats', locale, { total: pass.seats, servers: serverNames(deps, acts) }),
    );
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('premActYes')
      .setLabel(t('premium.confirmYes', locale))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('premActNo')
      .setLabel(t('premium.confirmNo', locale))
      .setStyle(ButtonStyle.Secondary),
  );
  await i.reply({
    content: t('premium.confirmActivate', locale, { total: pass.seats, used: acts.length }),
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
  const msg = await i.fetchReply();

  let btn;
  try {
    btn = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 30_000 });
  } catch {
    await i
      .editReply({ content: t('premium.activateTimeout', locale), components: [] })
      .catch(() => {});
    return;
  }
  if (btn.customId === 'premActNo') {
    await btn.update({ content: t('premium.activateCancelled', locale), components: [] });
    return;
  }
  // Re-verifica e gasta numa transação (o estado pode ter mudado nos 30s da confirmação).
  const res = activateSeat(deps.db, i.user.id, i.guildId, Date.now());
  let out: string;
  if (res.status === 'ok') {
    out = t('premium.activateOk', locale, {
      date: stampDate(res.expiresAt!),
      used: res.used!,
      total: res.seats!,
    });
  } else if (res.status === 'already') {
    out = t('premium.alreadyActive', locale);
  } else if (res.status === 'no_seats') {
    out = t('premium.noSeats', locale, {
      total: res.seats!,
      servers: serverNames(deps, listPassActivations(deps.db, i.user.id)),
    });
  } else {
    out = t('premium.noPass', locale, { link: deps.config.kofiUrl });
  }
  await btn.update({ content: out, components: [] });
}

/** /premium deactivate — liberta a licença deste servidor (ação reversível e segura). */
async function handlePremiumDeactivate(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
): Promise<void> {
  const locale = localeForUser(deps, i);
  const member = i.member as GuildMember | null;
  if (!i.guildId || !member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply(i, t('premium.needManageGuild', locale));
    return;
  }
  const freed = deactivateSeat(deps.db, i.user.id, i.guildId);
  await reply(i, freed ? t('premium.deactivateOk', locale) : t('premium.deactivateNone', locale));
}

/**
 * /vozengrant — OWNER-ONLY. Concede um passe de Premium (guild) ou Plus (user) a alguém,
 * por N dias. Defesa em profundidade: (1) o comando é registado SÓ na OWNER_GUILD_ID, por
 * isso o público nem o vê; (2) AQUI recusa quem não estiver em deps.ownerIds — o dono REAL
 * resolvido do Discord no arranque, não falsificável por env; (3) resposta sempre efémera.
 */
export async function handleVozenGrant(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
): Promise<void> {
  const locale = localeForUser(deps, i);
  // Camada 2: só o(s) dono(s) real(is). Sem ownerIds resolvidos, ninguém passa.
  if (!deps.ownerIds || !deps.ownerIds.has(i.user.id)) {
    await reply(i, t('grant.denied', locale));
    return;
  }
  const target = i.options.getUser('user', true);
  const plan = i.options.getString('plan', true);
  const days = i.options.getInteger('days') ?? 30;
  const now = Date.now();
  if (plan === 'plus') {
    const exp = grantUserPremium(deps.db, target.id, days, 'manual', now);
    await reply(i, t('grant.okPlus', locale, { user: target.id, days, date: stampDate(exp) }));
  } else {
    const seats = i.options.getInteger('seats') ?? 3;
    const exp = grantGuildPass(deps.db, target.id, seats, days, 'manual', now);
    await reply(
      i,
      t('grant.okPremium', locale, { user: target.id, days, seats, date: stampDate(exp) }),
    );
  }
}

/**
 * /gencode — OWNER-ONLY: gera código(s) de presente. Defesa em profundidade igual ao
 * /vozengrant: (1) registado só na OWNER_GUILD_ID (invisível ao público); (2) gate por
 * dono real aqui; (3) resposta efémera. Cada código é uso único; resgata-se com /redeem.
 * `seats` só conta para premium (0 para plus). Regenera em colisão de PK (praticamente nula).
 */
export async function handleGenCode(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  if (!deps.ownerIds || !deps.ownerIds.has(i.user.id)) {
    await reply(i, t('grant.denied', locale));
    return;
  }
  const plan = i.options.getString('plan', true) as 'premium' | 'plus';
  const days = i.options.getInteger('days') ?? 30;
  const seats = plan === 'plus' ? 0 : (i.options.getInteger('seats') ?? 3);
  const amount = i.options.getInteger('amount') ?? 1;
  const expiresDays = i.options.getInteger('expires_days');
  const now = Date.now();
  const expiresAt = expiresDays ? now + expiresDays * 86_400_000 : null;
  const codes: string[] = [];
  for (let n = 0; n < amount; n++) {
    for (let tries = 0; tries < 5; tries++) {
      const code = generateCodeString((max) => randomInt(max));
      const inserted = insertPremiumCode(deps.db, {
        code,
        plan,
        days,
        seats,
        createdBy: i.user.id,
        createdAt: now,
        expiresAt,
      });
      if (inserted) {
        codes.push(code);
        break;
      }
    }
  }
  await reply(
    i,
    t('gencode.done', locale, {
      count: codes.length,
      plan,
      days,
      list: codes.map((c) => `\`${c}\``).join('\n'),
    }),
  );
}

/**
 * /redeem — PÚBLICO: resgata um código de presente (uso único, resgate atómico no store).
 * Concede à CONTA de quem resgata — Plus direto, ou um passe Premium que ativa com
 * /premium activate. Resposta efémera. source 'code' (distingue de kofi/manual).
 */
export async function handleRedeem(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const code = normalizeCode(i.options.getString('code', true));
  const now = Date.now();
  const res = redeemPremiumCode(deps.db, code, i.user.id, now);
  if (!res.ok) {
    const key =
      res.reason === 'not-found'
        ? 'redeem.notFound'
        : res.reason === 'expired'
          ? 'redeem.expired'
          : 'redeem.used';
    await reply(i, t(key, locale));
    return;
  }
  if (res.plan === 'plus') {
    const exp = grantUserPremium(deps.db, i.user.id, res.days, 'redeem', now);
    await reply(i, t('redeem.okPlus', locale, { days: res.days, date: stampDate(exp) }));
  } else {
    const exp = grantGuildPass(deps.db, i.user.id, res.seats, res.days, 'redeem', now);
    await reply(
      i,
      t('redeem.okPremium', locale, { days: res.days, seats: res.seats, date: stampDate(exp) }),
    );
  }
}

/** /uptime — PÚBLICO: há quanto tempo o Vozen está online. */
export async function handleUptime(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  await reply(i, t('uptime.text', locale, { uptime: formatDuration(process.uptime()) }));
}

/** /botstats — PÚBLICO: números de confiança (servidores, sessões de voz, uptime). */
export async function handleBotstats(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const snap = metrics.snapshot();
  const lines = [
    t('botstats.title', locale),
    t('botstats.servers', locale, { value: deps.client.guilds.cache.size }),
    t('botstats.voiceSessions', locale, { value: deps.players.size }),
    t('botstats.messagesSpoken', locale, { value: snap.messagesSpoken }),
    t('botstats.uptime', locale, { value: formatDuration(process.uptime()) }),
  ];
  await i.reply({
    embeds: [brandEmbed().setDescription(lines.join('\n'))],
    flags: MessageFlags.Ephemeral,
  });
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
export async function handleInvite(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
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
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(url)
      .setLabel(t('invite.button', locale))
      .setEmoji('➕'),
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
export async function handleVote(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const clientId = deps.config.clientId;
  if (!clientId) {
    await reply(i, t('vote.noClientId', locale));
    return;
  }
  const url = `https://top.gg/bot/${clientId}/vote`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(url)
      .setLabel(t('vote.button', locale))
      .setEmoji('🗳️'),
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
export async function handleHelp(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
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
  const missing = commandDefs.map((d) => d.name).filter((name) => !mentioned.includes(`/${name}`));
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
