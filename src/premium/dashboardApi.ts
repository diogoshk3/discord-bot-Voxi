// Core of the web dashboard for guild configuration.
// Discord is authoritative for identity and manageable guilds. Config and option lists are only
// returned after MANAGE_GUILD/ADMINISTRATOR and bot presence have both been confirmed.

import type Database from 'better-sqlite3';
import { ChannelType, PermissionFlagsBits, type Guild } from 'discord.js';
import { LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES } from '../i18n/index';
import { voiceDisplayName } from '../language/voiceMap';
import { getGuildConfig, setGuildConfig, type GuildConfig } from '../store/guildConfig';

const BOOL_FIELDS = [
  'autoread',
  'xsaid',
  'autojoin',
  'readBots',
  'textInVoice',
  'antispam',
  'streakAnnounce',
  'soundboard',
  'greetOnJoin',
] as const;

export const DASHBOARD_FIELDS = [
  ...BOOL_FIELDS,
  'maxChars',
  'ratePerMin',
  'locale',
  'ttsChannelId',
  'defaultVoice',
] as const;
type DashboardField = (typeof DASHBOARD_FIELDS)[number];

export type DashboardConfig = Pick<GuildConfig, DashboardField>;

export interface DashboardOption {
  id: string;
  label: string;
  unavailable?: boolean;
}

export interface DashboardGuildPayload {
  config: DashboardConfig;
  capabilities: {
    ttsChannelId: true;
    defaultVoice: true;
  };
  options: {
    channels: DashboardOption[];
    voices: DashboardOption[];
    locales: DashboardOption[];
  };
}

export interface InvalidDashboardSetting {
  error: 'invalid_setting';
  field: 'ttsChannelId' | 'defaultVoice';
}

export type DashboardSaveResult = DashboardGuildPayload | InvalidDashboardSetting | null;

const MAX_CHARS_MIN = 1;
const MAX_CHARS_MAX = 2000;
const RATE_MIN = 1;
const RATE_MAX = 120;

const clampInt = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, Math.floor(value)));

export interface DashboardValidationOptions {
  channelIds: ReadonlySet<string>;
  voiceIds: ReadonlySet<string>;
}

export type SanitizePatchResult =
  { ok: true; patch: Partial<DashboardConfig> } | ({ ok: false } & InvalidDashboardSetting);

/**
 * Converts a raw client body to the dashboard whitelist and validates server-generated choices.
 * Unknown keys are discarded. A missing channel always wins over an attempted Auto-read=true so
 * the database cannot contain that impossible state.
 */
export function sanitizePatch(
  input: unknown,
  options: DashboardValidationOptions,
  current: Pick<DashboardConfig, 'ttsChannelId' | 'autoread'>,
): SanitizePatchResult {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const patch: Partial<DashboardConfig> = {};

  for (const field of BOOL_FIELDS) {
    if (field in src) patch[field] = Boolean(src[field]);
  }
  if (typeof src.maxChars === 'number' && Number.isFinite(src.maxChars)) {
    patch.maxChars = clampInt(src.maxChars, MAX_CHARS_MIN, MAX_CHARS_MAX);
  }
  if (typeof src.ratePerMin === 'number' && Number.isFinite(src.ratePerMin)) {
    patch.ratePerMin = clampInt(src.ratePerMin, RATE_MIN, RATE_MAX);
  }
  if (
    typeof src.locale === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(src.locale)
  ) {
    patch.locale = src.locale;
  }

  if ('ttsChannelId' in src) {
    if (
      src.ttsChannelId !== null &&
      (typeof src.ttsChannelId !== 'string' || !options.channelIds.has(src.ttsChannelId))
    ) {
      return { ok: false, error: 'invalid_setting', field: 'ttsChannelId' };
    }
    patch.ttsChannelId = src.ttsChannelId as string | null;
  }

  if ('defaultVoice' in src) {
    if (
      typeof src.defaultVoice !== 'string' ||
      (src.defaultVoice !== '' && !options.voiceIds.has(src.defaultVoice))
    ) {
      return { ok: false, error: 'invalid_setting', field: 'defaultVoice' };
    }
    patch.defaultVoice = src.defaultVoice;
  }

  const effectiveChannel =
    patch.ttsChannelId !== undefined ? patch.ttsChannelId : current.ttsChannelId;
  if ('ttsChannelId' in src && src.ttsChannelId !== null && !('autoread' in src)) {
    patch.autoread = true;
  }
  if (effectiveChannel === null && ('autoread' in src || 'ttsChannelId' in src)) {
    patch.autoread = false;
  }

  return { ok: true, patch };
}

export interface ManageableGuild {
  id: string;
  name: string;
  icon: string | null;
}

/** Returns only ordinary text channels where the bot can read and respond. */
export function listAuthorizedTextChannels(guild: Guild): DashboardOption[] {
  const botMember = guild.members.me;
  if (!botMember) return [];
  return [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildText)
    .filter((channel) =>
      channel
        .permissionsFor(botMember)
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ]),
    )
    .sort(
      (left, right) => left.rawPosition - right.rawPosition || left.name.localeCompare(right.name),
    )
    .map((channel) => ({ id: channel.id, label: `#${channel.name}` }));
}

export interface DashboardApiDeps {
  db: Database.Database;
  now: () => number;
  fetchImpl: typeof fetch;
  botHasGuild: (guildId: string) => boolean;
  resolveChannels: (guildId: string) => DashboardOption[];
  availableModels: readonly string[];
  guildsTtlMs?: number;
  cacheMaxEntries?: number;
  logError?: (message: string, error: unknown) => void;
}

export interface DashboardApi {
  listGuilds(token: string): Promise<ManageableGuild[] | null>;
  getGuild(token: string, guildId: string): Promise<DashboardGuildPayload | null>;
  saveConfig(token: string, guildId: string, patch: unknown): Promise<DashboardSaveResult>;
}

const DISCORD_GUILDS = 'https://discord.com/api/v10/users/@me/guilds';
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;
const FETCH_TIMEOUT_MS = 5_000;

function projectConfig(config: GuildConfig): DashboardConfig {
  const out = {} as DashboardConfig;
  for (const field of DASHBOARD_FIELDS) {
    (out as Record<string, unknown>)[field] = config[field];
  }
  return out;
}

function canManage(permissions: unknown, owner: unknown): boolean {
  if (owner === true) return true;
  if (typeof permissions !== 'string' && typeof permissions !== 'number') return false;
  try {
    const bits = BigInt(permissions);
    return (bits & MANAGE_GUILD) !== 0n || (bits & ADMINISTRATOR) !== 0n;
  } catch {
    return false;
  }
}

export function createDashboardApi(deps: DashboardApiDeps): DashboardApi {
  const ttl = deps.guildsTtlMs ?? 60_000;
  const maxEntries = Math.max(1, Math.floor(deps.cacheMaxEntries ?? 512));
  const cache = new Map<string, { guilds: ManageableGuild[] | null; exp: number }>();

  function prune(now: number): void {
    for (const [key, value] of cache) if (value.exp <= now) cache.delete(key);
    while (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value as string | undefined;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }

  async function fetchManageable(token: string): Promise<ManageableGuild[] | null> {
    const now = deps.now();
    const hit = cache.get(token);
    if (hit && hit.exp > now) return hit.guilds;
    if (hit) cache.delete(token);
    prune(now);

    let guilds: ManageableGuild[] | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await deps.fetchImpl(DISCORD_GUILDS, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (response.ok) {
        const raw = (await response.json()) as unknown;
        guilds = (Array.isArray(raw) ? raw : [])
          .filter((guild): guild is Record<string, unknown> => !!guild && typeof guild === 'object')
          .filter((guild) => typeof guild.id === 'string' && deps.botHasGuild(guild.id))
          .filter((guild) => canManage(guild.permissions, guild.owner))
          .map((guild) => ({
            id: guild.id as string,
            name: typeof guild.name === 'string' ? guild.name : (guild.id as string),
            icon: typeof guild.icon === 'string' ? guild.icon : null,
          }));
      }
    } catch (error) {
      deps.logError?.('[dashboard] failed to list Discord guilds', error);
    } finally {
      clearTimeout(timer);
    }
    prune(now);
    cache.set(token, { guilds, exp: now + ttl });
    return guilds;
  }

  async function authorize(token: string, guildId: string): Promise<boolean> {
    const guilds = await fetchManageable(token);
    // Recheck live bot presence even when the user's manageable-guild list came from the TTL cache.
    return (
      guilds !== null && deps.botHasGuild(guildId) && guilds.some((guild) => guild.id === guildId)
    );
  }

  function availableOptions(guildId: string): DashboardGuildPayload['options'] {
    let channels: DashboardOption[] = [];
    try {
      channels = deps.resolveChannels(guildId);
    } catch (error) {
      deps.logError?.('[dashboard] failed to resolve guild channels', error);
    }
    const voices = [...new Set(deps.availableModels)].map((id) => ({
      id,
      label: voiceDisplayName(id),
    }));
    const locales = SUPPORTED_LOCALES.map((id) => ({ id, label: LOCALE_DISPLAY_NAMES[id] }));
    return { channels, voices, locales };
  }

  function buildPayload(guildId: string): DashboardGuildPayload {
    const config = projectConfig(getGuildConfig(deps.db, guildId));
    const options = availableOptions(guildId);
    if (
      config.ttsChannelId &&
      !options.channels.some((option) => option.id === config.ttsChannelId)
    ) {
      options.channels.unshift({
        id: config.ttsChannelId,
        label: config.ttsChannelId,
        unavailable: true,
      });
    }
    if (
      config.defaultVoice &&
      !options.voices.some((option) => option.id === config.defaultVoice)
    ) {
      options.voices.unshift({
        id: config.defaultVoice,
        label: config.defaultVoice,
        unavailable: true,
      });
    }
    return {
      config,
      capabilities: { ttsChannelId: true, defaultVoice: true },
      options,
    };
  }

  return {
    listGuilds: (token) => fetchManageable(token),

    async getGuild(token, guildId) {
      if (!(await authorize(token, guildId))) return null;
      return buildPayload(guildId);
    },

    async saveConfig(token, guildId, input) {
      if (!(await authorize(token, guildId))) return null;
      const current = getGuildConfig(deps.db, guildId);
      const options = availableOptions(guildId);
      const clean = sanitizePatch(
        input,
        {
          channelIds: new Set(options.channels.map((option) => option.id)),
          voiceIds: new Set(options.voices.map((option) => option.id)),
        },
        current,
      );
      if (!clean.ok) return { error: clean.error, field: clean.field };
      setGuildConfig(deps.db, guildId, clean.patch);
      return buildPayload(guildId);
    },
  };
}
