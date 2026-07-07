// src/premium/entitlements.ts
//
// Ponte entre os "entitlements" (compras Premium Apps) do Discord e o premium interno.
// A Política de Monetização do Discord exige que features pagas sejam também compráveis
// via Premium Apps; quando o operador cria os SKUs e define PREMIUM_GUILD_SKU_ID /
// PREMIUM_USER_SKU_ID, cada compra ativa vira um grant nas tabelas premium_* (source
// 'discord'). SEM esses IDs configurados, TUDO isto fica INERTE (o bot corre como hoje,
// só com códigos /redeem) — por isso é seguro ter em produção antes de a app estar
// verificada e a monetização nativa ligada.
//
// A lógica é PURA e testável: recebe objetos tipo-Entitlement (não depende de discord.js).

import type { EntitlementGrant } from '../store/premium';

/** SKUs configurados (env). Ausentes => o mapeamento desse tipo não produz grants. */
export interface EntitlementSkuConfig {
  guildSkuId?: string;
  userSkuId?: string;
}

/** Forma mínima de um Entitlement do Discord de que precisamos (subset de discord.js). */
export interface EntitlementLike {
  skuId: string;
  guildId?: string | null;
  userId?: string | null;
  /** Fim da subscrição (unix ms) ou null = compra única/perpétua. */
  endsTimestamp?: number | null;
  /** true quando o entitlement foi removido (reembolso). */
  deleted?: boolean;
}

/**
 * Compras únicas (endsTimestamp null) são perpétuas; damos-lhes um expiry muito à frente
 * (renovado a cada sync). ~100 anos — na prática "para sempre" sem overflow de datas.
 */
export const PERPETUAL_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/** true se o entitlement está ATIVO agora (não removido e não expirado). */
export function isEntitlementActive(e: EntitlementLike, now: number): boolean {
  if (e.deleted) return false;
  const ends = e.endsTimestamp ?? null;
  return ends === null || ends > now;
}

/**
 * Traduz a lista COMPLETA de entitlements do Discord nos grants premium ativos, segundo
 * os SKUs configurados. Ignora entitlements inativos, de SKUs desconhecidos, ou sem o
 * id do alvo (guild/user). Função pura.
 */
export function activeEntitlementGrants(
  entitlements: EntitlementLike[],
  sku: EntitlementSkuConfig,
  now: number,
): EntitlementGrant[] {
  const grants: EntitlementGrant[] = [];
  for (const e of entitlements) {
    if (!isEntitlementActive(e, now)) continue;
    const expiresAt = e.endsTimestamp ?? now + PERPETUAL_MS;
    if (sku.guildSkuId && e.skuId === sku.guildSkuId && e.guildId) {
      grants.push({ kind: 'guild', id: e.guildId, expiresAt });
    } else if (sku.userSkuId && e.skuId === sku.userSkuId && e.userId) {
      grants.push({ kind: 'user', id: e.userId, expiresAt });
    }
  }
  return grants;
}

/** true se há pelo menos um SKU configurado (senão o subsistema fica inerte). */
export function entitlementsEnabled(sku: EntitlementSkuConfig): boolean {
  return !!(sku.guildSkuId || sku.userSkuId);
}

/**
 * Junta TODAS as páginas de um endpoint cursor-based (o `/entitlements` do Discord NÃO
 * auto-pagina: devolve no máximo `pageSize` por chamada). CRÍTICO para a reconciliação:
 * a sync apaga o premium 'discord' que não vier na lista, por isso a lista TEM de ser
 * completa — senão, ao passar de `pageSize` subscrições, revogaríamos clientes pagantes.
 * `fetchPage(after)` devolve a próxima página (após o id `after`); paramos quando uma
 * página vem incompleta (< pageSize) ou vazia. `maxPages` é uma guarda anti-loop.
 */
export async function collectPaged<T extends { id: string }>(
  fetchPage: (after: string | undefined) => Promise<T[]>,
  pageSize = 100,
  maxPages = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let after: string | undefined;
  for (let p = 0; p < maxPages; p++) {
    const page = await fetchPage(after);
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < pageSize) break;
    after = page[page.length - 1].id;
  }
  return all;
}
