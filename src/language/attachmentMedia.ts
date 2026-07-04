// src/language/attachmentMedia.ts
//
// Classifica ANEXOS e STICKERS do Discord em itens de media a anunciar (imagem,
// vídeo, áudio, ficheiro comprimido, ficheiro, gif, múltiplos). A localização em
// voz ("uma imagem"/"an image") acontece a jusante (spokenPhrases); aqui só se
// decide o TIPO. PURO — opera sobre formas mínimas ({contentType,name}), por isso
// testa-se sem objetos reais do Discord.

import type { MediaKind, MediaItem } from './spokenPhrases';

/** Forma mínima de um anexo (subconjunto do Attachment do discord.js). */
export interface AttachmentLike {
  contentType?: string | null;
  name?: string | null;
}

const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz']);

function extOf(name: string | null | undefined): string {
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Tipo de UM anexo, por content-type (preferido) ou extensão do nome (fallback).
 * gif tem prioridade sobre image (um .gif é uma imagem, mas o Diogo quer "um gif").
 * PURO.
 */
export function classifyAttachment(att: AttachmentLike): MediaKind {
  const ct = (att.contentType ?? '').toLowerCase();
  const ext = extOf(att.name);

  if (ct === 'image/gif' || ext === 'gif') return 'gif';
  if (ct.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'ico', 'tiff'].includes(ext))
    return 'image';
  if (ct.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv'].includes(ext))
    return 'video';
  if (ct.startsWith('audio/') || ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'opus'].includes(ext))
    return 'audio';
  if (ARCHIVE_EXT.has(ext)) return 'archive';
  return 'file';
}

/**
 * Media dos anexos: 0 -> nenhum; 1 -> o seu tipo; >1 -> um único "múltiplos ficheiros"
 * (como o concorrente — evita "imagem imagem vídeo" verboso). PURO.
 */
export function mediaFromAttachments(atts: AttachmentLike[]): MediaItem[] {
  if (atts.length === 0) return [];
  if (atts.length > 1) return [{ kind: 'multiple' }];
  return [{ kind: classifyAttachment(atts[0]) }];
}

/** Forma mínima de um sticker. */
export interface StickerLike {
  name?: string | null;
}

/**
 * Media dos stickers: um por sticker, lendo o NOME (o concorrente lê o nome do
 * sticker). Nome vazio -> o item cai em "um sticker" a jusante. PURO.
 */
export function mediaFromStickers(stickers: StickerLike[]): MediaItem[] {
  return stickers.map((s) => ({ kind: 'sticker' as const, text: s.name ?? undefined }));
}
