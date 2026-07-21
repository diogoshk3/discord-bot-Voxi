import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  StringSelectMenuBuilder,
} from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import type { BotDeps } from '../../bot/deps';
import { getLimiter, getPlayer } from '../../bot/deps';
import { getGuildConfig } from '../../store/guildConfig';
import { getUserVoice } from '../../store/userVoice';
import { resolveUserEngine } from '../../tts/resolveEngine';
import {
  CAST_LANGUAGE_CHOICES,
  CAST_THEMES,
  assignCast,
  buildCastSpeech,
  castThemeByKey,
  chunkCastSpeech,
} from '../../content/cast';
import { editCard, replyCard } from '../../ui/messages';
import { localeForUser } from '../helpers';
import { t } from '../../i18n/index';

const CAST_WAIT_MS = 120_000;
const CAST_MAX_MEMBERS = 25;

type VoiceMember = {
  id: string;
  displayName?: string;
  nickname?: string | null;
  user?: { bot?: boolean };
  bot?: boolean;
  voice?: { channelId?: string | null };
};

function currentVoiceChannelId(i: ChatInputCommandInteraction): string | null {
  const member = i.member as { voice?: { channelId?: string | null } } | null;
  return member?.voice?.channelId ?? null;
}

function botVoiceChannelId(i: ChatInputCommandInteraction, deps: BotDeps): string | null {
  const connection = i.guildId ? getVoiceConnection(i.guildId) : undefined;
  const fromConnection = connection?.joinConfig.channelId;
  if (fromConnection) return fromConnection;

  const members = i.guild?.members;
  const me =
    members?.me ?? (deps.client.user?.id ? members?.cache.get(deps.client.user.id) : undefined);
  return (me as VoiceMember | undefined)?.voice?.channelId ?? null;
}

function voiceMembers(i: ChatInputCommandInteraction, channelId: string): VoiceMember[] {
  const channel = i.guild?.channels.cache.get(channelId) as
    { members?: { values(): IterableIterator<VoiceMember> } } | undefined;
  return channel?.members ? Array.from(channel.members.values()) : [];
}

function panelContent(themeKey: string | null, language: string): string {
  const theme = themeKey ? CAST_THEMES.find((item) => item.key === themeKey)?.label : null;
  const lines = [
    '🎭 **Create a cast for your voice call**',
    `Theme: ${theme ?? 'choose a theme'}`,
    `Language: ${CAST_LANGUAGE_CHOICES.find((choice) => choice.value === language)?.name ?? 'English'}`,
  ];
  if (themeKey === 'pokemon') {
    lines.push(
      '-# Unofficial fan reference; not affiliated with Nintendo, Game Freak, or The Pokémon Company.',
    );
  }
  return lines.join('\n');
}

function panelRows(
  interactionId: string,
  themeKey: string | null,
  language: string,
): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const theme = new StringSelectMenuBuilder()
    .setCustomId(`cast:theme:${interactionId}`)
    .setPlaceholder('Choose a theme')
    .addOptions(CAST_THEMES.map((item) => ({ label: item.label, value: item.key })).slice(0, 25));
  const languageSelect = new StringSelectMenuBuilder()
    .setCustomId(`cast:language:${interactionId}`)
    .setPlaceholder('Choose a language')
    .addOptions(
      CAST_LANGUAGE_CHOICES.map((choice) => ({
        label: choice.name,
        value: choice.value,
        default: choice.value === language,
      })),
    );
  const reveal = new ButtonBuilder()
    .setCustomId(`cast:reveal:${interactionId}`)
    .setLabel('Reveal cast')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!themeKey);
  const cancel = new ButtonBuilder()
    .setCustomId(`cast:cancel:${interactionId}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);
  return [
    new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(theme),
    new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(languageSelect),
    new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(reveal, cancel),
  ];
}

function publicCastText(
  themeKey: string,
  language: string,
  assignments: readonly { userId: string; displayName: string; entry: { label: string } }[],
): string {
  const theme = CAST_THEMES.find((item) => item.key === themeKey)?.label ?? themeKey;
  const languageName =
    CAST_LANGUAGE_CHOICES.find((choice) => choice.value === language)?.name ?? 'English';
  const lines = assignments.map(
    (assignment) => `• <@${assignment.userId}> → ${assignment.entry.label}`,
  );
  const output = [`🎭 **Cast revealed — ${theme} · ${languageName}**`, ...lines];
  if (themeKey === 'pokemon') {
    output.push(
      '-# Unofficial fan reference; not affiliated with Nintendo, Game Freak, or The Pokémon Company.',
    );
  }
  return output.join('\n');
}

/** `/cast` — an ephemeral two-menu setup followed by a public text + voice result. */
export async function handleCast(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  if (!i.guildId) {
    await i.reply(replyCard('This command can only be used in a server.', { ephemeral: true }));
    return;
  }
  const player = getPlayer(deps, i.guildId);
  const invokerChannelId = currentVoiceChannelId(i);
  const botChannelId = botVoiceChannelId(i, deps);
  if (!player || !invokerChannelId || !botChannelId || invokerChannelId !== botChannelId) {
    await i.reply(replyCard(t('tts.notInVoice', locale), { ephemeral: true, tone: 'danger' }));
    return;
  }

  let themeKey: string | null = null;
  let language = 'en';
  await i.reply(
    replyCard(panelContent(themeKey, language), {
      ephemeral: true,
      rows: panelRows(i.id, themeKey, language),
    }),
  );

  let revealed = false;
  while (!revealed) {
    let component;
    try {
      component = await i.channel?.awaitMessageComponent({
        time: CAST_WAIT_MS,
        filter: (candidate) =>
          candidate.user.id === i.user.id &&
          candidate.customId.startsWith(`cast:`) &&
          candidate.customId.endsWith(`:${i.id}`),
      });
    } catch {
      await i
        .editReply(editCard('This cast panel expired. Run `/cast` again.', { tone: 'warning' }))
        .catch(() => {});
      return;
    }
    if (!component) return;

    if (component.isButton() && component.customId === `cast:cancel:${i.id}`) {
      await component.deferUpdate();
      await i.editReply(editCard('Cast cancelled.', { tone: 'warning' })).catch(() => {});
      return;
    }
    if (component.isStringSelectMenu()) {
      if (component.customId === `cast:theme:${i.id}`) {
        const selected = component.values[0];
        if (selected && castThemeByKey(selected)) themeKey = selected;
      }
      if (component.customId === `cast:language:${i.id}`) {
        const selected = component.values[0];
        if (selected && CAST_LANGUAGE_CHOICES.some((choice) => choice.value === selected)) {
          language = selected;
        }
      }
      await component.deferUpdate();
      await i
        .editReply(
          editCard(panelContent(themeKey, language), {
            rows: panelRows(i.id, themeKey, language),
          }),
        )
        .catch(() => {});
      continue;
    }
    if (component.isButton() && component.customId === `cast:reveal:${i.id}`) {
      if (!themeKey) {
        await component.deferUpdate();
        continue;
      }
      await component.deferUpdate();
      revealed = true;
    }
  }

  const members = voiceMembers(i, invokerChannelId).map((member) => ({
    id: member.id,
    displayName: member.displayName ?? member.nickname ?? member.id,
    bot: member.bot ?? member.user?.bot ?? false,
  }));
  const humans = members.filter((member) => !member.bot);
  if (humans.length === 0 || humans.length > CAST_MAX_MEMBERS) {
    await i
      .editReply(
        editCard(
          humans.length > CAST_MAX_MEMBERS
            ? 'There are too many people in this call. `/cast` supports up to 25 humans.'
            : 'Nobody else is available in the voice call.',
          { tone: 'warning' },
        ),
      )
      .catch(() => {});
    return;
  }

  const cfg = getGuildConfig(deps.db, i.guildId);
  const limiter = getLimiter(deps, i.guildId, cfg.ratePerMin);
  if (!limiter.allow(i.user.id, Date.now())) {
    await i.editReply(editCard(t('tts.tooFast', locale), { tone: 'warning' })).catch(() => {});
    return;
  }

  const selectedTheme = themeKey;
  if (!selectedTheme) return;
  const assignments = assignCast(humans, selectedTheme);
  const text = publicCastText(selectedTheme, language, assignments);
  await i.followUp(
    replyCard(text, {
      tone: 'success',
      allowedMentions: { parse: [] },
    }),
  );

  const stored = getUserVoice(deps.db, i.guildId, i.user.id);
  const prefix = `${language}_`;
  const model =
    deps.availableModels.find((available) => available.startsWith(prefix)) ||
    cfg.defaultVoice ||
    deps.config.defaultVoice ||
    'en_US-amy-medium';
  const speech = buildCastSpeech(assignments, language);
  const chunks = chunkCastSpeech(speech);
  const resolvedEngine = resolveUserEngine(
    deps.db,
    i.guildId,
    i.user.id,
    stored?.engine,
    Date.now(),
  );
  let spoken = false;
  for (const chunk of chunks) {
    const queued = await player.say({
      text: chunk,
      model,
      speed: deps.config.defaultSpeed,
      singleVoice: true,
      ...resolvedEngine,
    });
    if (!queued) break;
    spoken = true;
  }
  await i
    .editReply(
      editCard(
        spoken ? 'Cast revealed and spoken in the call.' : 'Cast revealed in chat; voice is busy.',
        {
          tone: spoken ? 'success' : 'warning',
        },
      ),
    )
    .catch(() => {});
}
