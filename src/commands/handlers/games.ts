// src/commands/handlers/games.ts — handler de /game (play/stop/list/leaderboard/stats) extraído de index.ts (plano 015).
import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from 'discord.js';
import type { BotDeps } from '../../bot/deps';
import { getPlayer } from '../../bot/deps';
import { brandEmbed, rankMedal } from '../../ui/theme';
import { isGuildPremium, isUserPremium } from '../../store/premium';
import { GAME_DEFS, gameById } from '../../games/index';
import { createGameThread, deleteChannelSafe } from '../../games/thread';
import { getLeaderboard, getUserScore, getUserRank } from '../../store/gameScore';
import { t } from '../../i18n/index';
import { localeForUser, reply } from '../helpers';

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
export async function handleGame(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  if (!deps.games) {
    // Sem gestor de jogos (nunca deve acontecer em producao — sempre injetado no
    // bootstrap; guard defensivo p/ testes que nao o injetam).
    await reply(i, t('error.generic', locale));
    return;
  }
  const sub = i.options.getSubcommand();

  if (sub === 'play') {
    let gameId = i.options.getString('game');
    if (!gameId) {
      // Beginner-friendly (plano v4): /game play sem jogo mostra um SELECT com os jogos
      // (nome localizado), como o /setup faz com o canal. Só depois seguimos o fluxo normal.
      const select = new StringSelectMenuBuilder()
        .setCustomId(`gamePick:${i.id}`)
        .setPlaceholder(t('game.pickPlaceholder', locale))
        .addOptions(
          GAME_DEFS.slice(0, 25).map((g) => ({
            label: t(g.nameKey, locale),
            description: t(g.descKey, locale).slice(0, 100),
            value: g.id,
          })),
        );
      await i.reply({
        content: t('game.pickPrompt', locale),
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
      let picked;
      try {
        picked = await i.channel?.awaitMessageComponent({
          componentType: ComponentType.StringSelect,
          time: 60_000,
          filter: (c) => c.customId === `gamePick:${i.id}` && c.user.id === i.user.id,
        });
      } catch {
        await i
          .editReply({ content: t('game.pickTimeout', locale), components: [] })
          .catch(() => {});
        return;
      }
      if (!picked) return;
      await picked.deferUpdate(); // a UI segue via i.editReply (mesma mensagem ephemeral)
      await i.editReply({ components: [] }).catch(() => {});
      gameId = picked.values[0];
    } else {
      // Ack IMEDIATO: criar a thread é uma chamada REST que num gateway lento estoira
      // os 3s do token da interação (10062 Unknown interaction) com o jogo JÁ criado.
      // deferReply compra 15 min; TODAS as respostas deste ramo passam a editReply.
      await i.deferReply({ flags: MessageFlags.Ephemeral });
    }
    const def = gameById(gameId);
    if (!def) {
      await i.editReply(t('game.unknownGame', locale));
      return;
    }
    // Jogos de voz exigem o bot numa call (como o /tts): sem player, nada a anunciar.
    if (def.needsVoice && !getPlayer(deps, i.guildId!)) {
      await i.editReply(t('game.start.needVoice', locale));
      return;
    }
    // Jogos 💎 Premium (ex. xadrez): Plus do próprio OU Premium do servidor, mesmo
    // padrão do /voice clone e /voice effect.
    if (def.premium) {
      const now = Date.now();
      const premium =
        isUserPremium(deps.db, i.user.id, now) || isGuildPremium(deps.db, i.guildId!, now);
      if (!premium) {
        await i.editReply(t('game.start.premiumLocked', locale, { game: t(def.nameKey, locale) }));
        return;
      }
    }
    // Verifica o lock ANTES de criar a thread (evita uma thread órfã no caso comum de
    // já haver jogo). Há uma janela minúscula até ao start real (que é o gate a sério);
    // se a perdermos, apagamos a thread órfã abaixo.
    if (deps.games.active(i.guildId!)) {
      const ch = deps.games.channelOf(i.guildId!) ?? i.channelId;
      await i.editReply(t('game.start.alreadyActive', locale, { channel: ch }));
      return;
    }
    // Servidores grandes afogam o canal com as mensagens do jogo — corremo-lo numa
    // THREAD descartável criada a partir deste canal. Fallback (canal de voz/DM, sem
    // permissões): joga no próprio canal, como antes.
    const gameName = t(def.nameKey, locale);
    const threadId = await createGameThread(i.channel, `🎮 ${gameName}`);
    const gameChannelId = threadId ?? i.channelId;

    // Locale do jogo = o de QUEM inicia (localeForUser), não o da guild — assim um
    // servidor sem /config language joga na língua de quem clicou (ex.: PT).
    // A opção `language` só é usada pelo word-chain; se omitida, cai no locale de quem
    // inicia (o resolveLang do jogo mapeia línguas não-suportadas para inglês). Os
    // outros jogos ignoram opts (create() sem parâmetros continua válido).
    const chosenLang = i.options.getString('language') ?? undefined;
    const res = deps.games.start(
      i.guildId!,
      gameChannelId,
      def.create({ language: chosenLang ?? locale }),
      def.needsVoice,
      locale,
      threadId ? i.channelId : undefined, // canal-pai só quando corre em thread
    );
    if (res === 'already-active') {
      // Perdemos a race após o active() acima — limpa a thread que acabámos de criar.
      if (threadId) void deleteChannelSafe(i.client, threadId);
      const ch = deps.games.channelOf(i.guildId!) ?? i.channelId;
      await i.editReply(t('game.start.alreadyActive', locale, { channel: ch }));
      return;
    }
    await i.editReply(
      threadId
        ? t('game.start.startedThread', locale, { game: gameName, channel: threadId })
        : t('game.start.started', locale, { game: gameName }),
    );
    return;
  }

  if (sub === 'stop') {
    // Gate ManageGuild (ABUSE-04): sem isto, QUALQUER membro parava o jogo de outro
    // (troll de play->stop->play sem fricção). Sem "starter próprio pode parar" por
    // agora — o GameManager (src/games/manager.ts) não guarda quem iniciou a partida;
    // seguir esse caminho exigiria adicionar esse estado lá, fora do âmbito deste
    // plano (030) — segue como follow-up. Mesmo padrão do /transcribe stop.
    if (!(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false)) {
      await reply(i, t('error.needManageGuild', locale));
      return;
    }
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
      embeds: [
        brandEmbed().setDescription(`${t('game.leaderboard.title', locale)}\n${lines.join('\n')}`),
      ],
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
    const rankStr = rank
      ? t('game.stats.rank', locale, { rank, total })
      : t('game.stats.unranked', locale);
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
