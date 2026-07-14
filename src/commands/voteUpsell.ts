// src/commands/voteUpsell.ts
//
// Convite a VOTAR como upsell do Plus (growth loop). Uma linha localizada que oferece
// 24h de Plus grátis por um voto no top.gg — anexada nos momentos em que um utilizador
// FREE já está a ser upsellado (serverstats, limite de pronúncias, /premium). NÃO é um
// portão novo nem um DM: só enriquece respostas que já existem. Sem clientId configurado
// devolve null (o link ficaria partido, top.gg/bot//vote) e o chamador não anexa nada.
import { t } from '../i18n/index';

/** URL da página de voto do top.gg (o clientId é o id do bot na listagem, = /invite). */
function voteUrl(clientId: string): string {
  return `https://top.gg/bot/${clientId}/vote`;
}

/** Linha de convite a votar → 24h de Plus grátis (ou null se não há clientId). */
export function voteUpsellLine(locale: string, clientId: string | undefined): string | null {
  if (!clientId) return null;
  return t('vote.upsell', locale, { url: voteUrl(clientId) });
}
