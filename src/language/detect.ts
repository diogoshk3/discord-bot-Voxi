import franc from 'franc';
import { lookupShortLang } from './greetings';

/**
 * Deteta a lingua de um texto.
 * Devolve um codigo ISO 639-3 (ex. 'por', 'eng') ou '' se desconhecido/muito curto.
 * PURO: sem efeitos secundarios.
 *
 * Ordem: (1) lexico de saudacoes/palavras curtas — o franc NAO decide texto curto
 * ("ola"->'und', "ola tudo bem"->Tok Pisin), por isso o lexico curado tem
 * PRECEDENCIA para essas; (2) franc para texto suficientemente longo.
 */
export function detectLang(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';

  // (1) Lexico de texto curto (saudacoes/palavras-marca). Baseado no TEXTO, por isso
  // funciona no /tts e na leitura de canal. So casa quando reconhece — senao ''.
  const short = lookupShortLang(trimmed);
  if (short) return short;

  // (2) franc (trigramas) para o resto. Devolve 'und' em texto curto/ambiguo -> ''.
  const code = franc(trimmed);
  if (code === 'und') return '';
  return code;
}
