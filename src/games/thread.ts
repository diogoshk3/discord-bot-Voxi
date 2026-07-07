// src/games/thread.ts
//
// Glue de discord.js para as THREADS descartáveis dos jogos. Isolado aqui para o resto
// do framework (manager, jogos) continuar desacoplado do discord.js e testável com um
// env falso. Tudo best-effort: qualquer falha (sem permissões, tipo de canal sem
// threads, canal já apagado) devolve o fallback (null / arquivar), nunca lança — mas
// LOGA sempre o desfecho, para uma falha de permissões não passar despercebida.

import { ChannelType, PermissionFlagsBits, type Client } from 'discord.js';
import { log } from '../logging/logger';

/** Duração de auto-arquivo (min) — rede de segurança se o apagar E o arquivar falharem. */
const AUTO_ARCHIVE_MIN = 60;

/**
 * Diagnóstico da permissão de apagar ANTES de tentar: distingue as duas causas do
 * "Missing Permissions", que se resolvem de formas OPOSTAS, e escreve no log a que se
 * aplica (senão anda-se às cegas a re-convidar quando o problema é do canal, ou vice-versa):
 *  - falta a nível do SERVIDOR  → o re-convite não pegou (link antigo?) → usar o /invite atual;
 *  - tem no servidor mas o CANAL-pai remove-a por exceção → ligar "Gerir Tópicos" ao role
 *    Vozen nas permissões DESSE canal.
 * Best-effort e puramente informativo — nunca altera o fluxo nem lança.
 */
function diagnoseThreadDelete(ch: unknown, _channelId: string): void {
  try {
    const thread = ch as {
      parentId?: string;
      guild?: { members?: { me?: unknown } };
      parent?: { permissionsFor?: (m: unknown) => { has?: (p: bigint) => boolean } | null };
    };
    const me = thread.guild?.members?.me as
      | { permissions?: { has?: (p: bigint) => boolean } }
      | undefined;
    if (!me) return; // sem o membro-bot em cache não há o que comparar
    const guildHas = me.permissions?.has?.(PermissionFlagsBits.ManageThreads) ?? false;
    // Permissão EFETIVA no canal-pai (já com as exceções aplicadas); se o pai não está em
    // cache cai para o valor do servidor (não conseguimos afirmar exceção nesse caso).
    const chanPerms = thread.parent?.permissionsFor?.(me);
    const chanHas = chanPerms?.has?.(PermissionFlagsBits.ManageThreads) ?? guildHas;
    if (chanHas) return; // deve conseguir apagar — nada a assinalar
    if (!guildHas) {
      log.warn(
        `[game] diagnóstico: o Vozen NÃO tem "Gerir Tópicos" ao nível do servidor — o ` +
          `re-convite não aplicou (link antigo?). Corre /invite no Discord e usa ESSE link.`,
      );
    } else {
      log.warn(
        `[game] diagnóstico: o Vozen tem "Gerir Tópicos" no servidor, mas o canal-pai ` +
          `(${thread.parentId ?? '?'}) tem uma exceção que a remove — nas permissões DESSE ` +
          `canal, adiciona o role Vozen com "Gerir Tópicos" ligado.`,
      );
    }
  } catch {
    // diagnóstico é só uma ajuda — se algo faltar, seguimos para a tentativa real
  }
}

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
    if (thread.id) log.info(`[game] thread ${thread.id} criada para a partida.`);
    return thread.id ?? null;
  } catch (err) {
    log.warn(
      `[game] criar thread falhou (${(err as Error)?.message ?? String(err)}) — jogo segue no próprio canal.`,
    );
    return null;
  }
}

/**
 * Apaga a thread do jogo pelo id. Escada de degradação, sempre logada:
 *  1. delete — precisa de Manage Threads (convite novo);
 *  2. arquivar — o bot criou a thread, por isso consegue arquivá-la mesmo sem
 *     Manage Threads (desaparece da lista de canais na mesma);
 *  3. nada — a thread auto-arquiva pela AUTO_ARCHIVE_MIN.
 */
export async function deleteChannelSafe(client: Client, channelId: string): Promise<void> {
  const ch =
    client.channels.cache.get(channelId) ??
    (await client.channels.fetch(channelId).catch(() => null));
  if (!ch) {
    log.warn(`[game] thread ${channelId} não encontrada para apagar (já removida?).`);
    return;
  }
  // Antes de tentar, diz no log se (e onde) falta a permissão de apagar.
  diagnoseThreadDelete(ch, channelId);
  const c = ch as {
    delete?: (reason?: string) => Promise<unknown>;
    setArchived?: (archived?: boolean, reason?: string) => Promise<unknown>;
  };
  try {
    if (typeof c.delete === 'function') {
      await c.delete('Vozen game ended');
      log.info(`[game] thread ${channelId} apagada.`);
      return;
    }
  } catch (err) {
    log.warn(
      `[game] apagar thread ${channelId} falhou (${(err as Error)?.message ?? String(err)}) — ` +
        `falta Manage Threads? Re-convida o bot com o link do /invite. A arquivar como fallback…`,
    );
  }
  try {
    if (typeof c.setArchived === 'function') {
      await c.setArchived(true, 'Vozen game ended');
      log.info(`[game] thread ${channelId} arquivada (fallback do apagar).`);
    }
  } catch (err) {
    log.warn(
      `[game] arquivar thread ${channelId} também falhou (${(err as Error)?.message ?? String(err)}) — ` +
        `auto-arquiva em ${AUTO_ARCHIVE_MIN} min.`,
    );
  }
}
