// src/premium/entitlementSync.ts
//
// Liga os entitlements (Premium Apps) do Discord ao premium interno. INERTE quando não
// há SKUs configurados. Faz um FETCH TOTAL dos entitlements ativos e reconcilia com as
// tabelas premium_* (concede ativos, revoga cancelados) — no arranque e a cada evento
// de entitlement. Fetch-total-por-evento é simples e seguro (entitlements são de baixo
// volume) e evita reconciliação incremental frágil.

import { type Client, Events } from 'discord.js';
import type Database from 'better-sqlite3';
import {
  activeEntitlementGrants,
  entitlementsEnabled,
  type EntitlementLike,
  type EntitlementSkuConfig,
} from './entitlements';
import { syncDiscordEntitlements } from '../store/premium';

export interface EntitlementSyncDeps {
  client: Client;
  db: Database.Database;
  sku: EntitlementSkuConfig;
  now: () => number;
  logInfo: (msg: string) => void;
  logError: (msg: string, err: unknown) => void;
}

/**
 * Arranca a sincronização de entitlements. No-op (e diz porquê) se não houver SKUs
 * configurados. Deve ser chamado quando o client já está pronto (ClientReady), porque
 * usa client.application.
 */
export function startEntitlementSync(deps: EntitlementSyncDeps): void {
  const { client, db, sku, now, logInfo, logError } = deps;
  if (!entitlementsEnabled(sku)) {
    logInfo('[premium] Premium Apps do Discord inativos (sem PREMIUM_*_SKU_ID) — só /redeem.');
    return;
  }

  const refresh = async (): Promise<void> => {
    try {
      const app = client.application;
      if (!app) return;
      const raw = await app.entitlements.fetch();
      const list: EntitlementLike[] = raw.map((e) => ({
        skuId: e.skuId,
        guildId: e.guildId ?? null,
        userId: e.userId ?? null,
        endsTimestamp: e.endsTimestamp ?? null,
        deleted: e.deleted ?? false,
      }));
      const grants = activeEntitlementGrants(list, sku, now());
      const res = syncDiscordEntitlements(db, grants);
      logInfo(
        `[premium] entitlements sincronizados: ${res.guildsActive} servidor(es), ${res.usersActive} utilizador(es) ativos; ${res.revoked} revogado(s).`,
      );
    } catch (err) {
      logError('[premium] falha ao sincronizar entitlements (ignorado)', err);
    }
  };

  // Reconcilia agora e a cada mudança de entitlement (compra/renovação/reembolso).
  void refresh();
  client.on(Events.EntitlementCreate, () => void refresh());
  client.on(Events.EntitlementUpdate, () => void refresh());
  client.on(Events.EntitlementDelete, () => void refresh());
}
