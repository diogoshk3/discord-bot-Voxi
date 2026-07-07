// src/games/thread.ts
//
// Glue de discord.js para as THREADS descartáveis dos jogos. Isolado aqui para o resto
// do framework (manager, jogos) continuar desacoplado do discord.js e testável com um
// env falso. Tudo best-effort: qualquer falha (sem permissões, tipo de canal sem
// threads, canal já apagado) devolve o fallback silencioso (null / no-op), nunca lança.

import { ChannelType, type Client } from 'discord.js';

/** Duração de auto-arquivo (min) — rede de segurança se o apagar falhar (sem ManageThreads). */
const AUTO_ARCHIVE_MIN = 60;

/**
 * Cria uma thread pública a partir de `channel` (o canal onde o /game play foi dado).
 * Devolve o id da thread, ou null se não der (tipo de canal sem threads, sem permissões,
 * canais de voz/DM) — o chamador joga então no próprio canal (comportamento de sempre).
 */
export async function createGameThread(channel: unknown, name: string): Promise<string | null> {
  try {
    const ch = channel as {
      type?: number;
      threads?: { create?: (o: unknown) => Promise<{ id: string }> };
    };
    // Só canais de TEXTO/ANÚNCIO de servidor suportam threads públicas.
    if (ch?.type !== ChannelType.GuildText && ch?.type !== ChannelType.GuildAnnouncement) return null;
    if (typeof ch.threads?.create !== 'function') return null;
    const thread = await ch.threads.create({
      name: name.slice(0, 100), // limite do Discord
      autoArchiveDuration: AUTO_ARCHIVE_MIN,
      reason: 'Vozen game session',
    });
    return thread.id ?? null;
  } catch {
    return null;
  }
}

/** Apaga um canal (a thread do jogo) pelo id. Best-effort — no-op se não existir/sem permissão. */
export async function deleteChannelSafe(client: Client, channelId: string): Promise<void> {
  try {
    const ch =
      client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
    if (ch && 'delete' in ch && typeof (ch as { delete?: unknown }).delete === 'function') {
      await (ch as { delete: (reason?: string) => Promise<unknown> }).delete('Vozen game ended');
    }
  } catch {
    // sem permissão/já apagada — a thread auto-arquiva pela AUTO_ARCHIVE_MIN
  }
}
