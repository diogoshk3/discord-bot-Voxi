import type Database from 'better-sqlite3';

// Vozen Premium / Plus: assinaturas baseadas em EXPIRY (unix ms). Sem linha ou expirado =>
// Free. As features NOVAS (efeitos completos, soundboard, etc.) consultam isGuildPremium/
// isUserPremium; nada do que já é grátis passa a pago. Códigos de resgate (Ko-fi/Patreon)
// são gerados offline (tools/premium-codes.ts) e resgatados 1x com /redeem.

export type PremiumKind = 'guild' | 'user';

const DAY_MS = 86_400_000;

export interface RedeemResult {
  status: 'ok' | 'invalid' | 'used';
  kind?: PremiumKind;
  days?: number;
  expiresAt?: number;
}

export function isGuildPremium(db: Database.Database, guildId: string, now: number): boolean {
  const row = db
    .prepare('SELECT expires_at FROM premium_guild WHERE guild_id = ?')
    .get(guildId) as { expires_at: number } | undefined;
  return !!row && row.expires_at > now;
}

export function isUserPremium(db: Database.Database, userId: string, now: number): boolean {
  const row = db
    .prepare('SELECT expires_at FROM premium_user WHERE user_id = ?')
    .get(userId) as { expires_at: number } | undefined;
  return !!row && row.expires_at > now;
}

/** Expiry do premium da guild (unix ms) ou null se nunca teve. Pode estar no passado. */
export function getGuildPremiumExpiry(db: Database.Database, guildId: string): number | null {
  const row = db
    .prepare('SELECT expires_at FROM premium_guild WHERE guild_id = ?')
    .get(guildId) as { expires_at: number } | undefined;
  return row ? row.expires_at : null;
}

/** Expiry do Plus do utilizador (unix ms) ou null se nunca teve. Pode estar no passado. */
export function getUserPremiumExpiry(db: Database.Database, userId: string): number | null {
  const row = db
    .prepare('SELECT expires_at FROM premium_user WHERE user_id = ?')
    .get(userId) as { expires_at: number } | undefined;
  return row ? row.expires_at : null;
}

/**
 * Concede `days` de premium à guild. ESTENDE a partir do máximo entre agora e o expiry
 * atual (renovar antes de expirar acumula, não perde tempo). Devolve o novo expiry (ms).
 */
export function grantGuildPremium(
  db: Database.Database,
  guildId: string,
  days: number,
  source: string,
  now: number,
): number {
  const cur = getGuildPremiumExpiry(db, guildId);
  const base = cur && cur > now ? cur : now;
  const expiresAt = base + days * DAY_MS;
  db.prepare(
    `INSERT INTO premium_guild (guild_id, expires_at, source)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET expires_at = excluded.expires_at, source = excluded.source`,
  ).run(guildId, expiresAt, source);
  return expiresAt;
}

/** Igual ao grantGuildPremium mas para o Vozen Plus (por-utilizador). */
export function grantUserPremium(
  db: Database.Database,
  userId: string,
  days: number,
  source: string,
  now: number,
): number {
  const row = db
    .prepare('SELECT expires_at FROM premium_user WHERE user_id = ?')
    .get(userId) as { expires_at: number } | undefined;
  const base = row && row.expires_at > now ? row.expires_at : now;
  const expiresAt = base + days * DAY_MS;
  db.prepare(
    `INSERT INTO premium_user (user_id, expires_at, source)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET expires_at = excluded.expires_at, source = excluded.source`,
  ).run(userId, expiresAt, source);
  return expiresAt;
}

// ── Discord Premium Apps (entitlements) ──────────────────────────────────────
// Quando o operador liga a monetização nativa do Discord (SKUs), as compras chegam
// como "entitlements". Reutilizamos as tabelas premium_* com source='discord' para
// não duplicar a lógica de gating (isGuildPremium/isUserPremium já bastam). A sync
// completa (sync*Entitlements) é reconciliadora: concede os ativos e revoga os
// source='discord' que já não existem (reembolso/cancelamento). Nunca ENCURTA um
// premium existente (usa o MÁXIMO) e nunca toca em linhas de outra origem (ex.: redeem):
// se um redeem tiver expiry mais longo, a linha mantém source e é ignorada na revogação.

/** Concede/estende premium de guild vindo de um entitlement do Discord (source='discord'). */
export function upsertDiscordGuildPremium(
  db: Database.Database,
  guildId: string,
  expiresAt: number,
): void {
  db.prepare(
    `INSERT INTO premium_guild (guild_id, expires_at, source)
     VALUES (?, ?, 'discord')
     ON CONFLICT(guild_id) DO UPDATE SET
       expires_at = MAX(excluded.expires_at, premium_guild.expires_at),
       source = CASE WHEN premium_guild.expires_at > excluded.expires_at
                     THEN premium_guild.source ELSE 'discord' END`,
  ).run(guildId, expiresAt);
}

/** Igual, para o Vozen Plus por-utilizador. */
export function upsertDiscordUserPremium(
  db: Database.Database,
  userId: string,
  expiresAt: number,
): void {
  db.prepare(
    `INSERT INTO premium_user (user_id, expires_at, source)
     VALUES (?, ?, 'discord')
     ON CONFLICT(user_id) DO UPDATE SET
       expires_at = MAX(excluded.expires_at, premium_user.expires_at),
       source = CASE WHEN premium_user.expires_at > excluded.expires_at
                     THEN premium_user.source ELSE 'discord' END`,
  ).run(userId, expiresAt);
}

export interface EntitlementGrant {
  kind: PremiumKind;
  id: string; // guildId (guild) ou userId (user)
  expiresAt: number; // unix ms
}

export interface EntitlementSyncResult {
  guildsActive: number;
  usersActive: number;
  revoked: number;
}

/**
 * Reconcilia TODOS os entitlements ativos do Discord com as tabelas premium_*.
 * `grants` tem de ser a lista COMPLETA de entitlements ativos (fetch total) — concede
 * os ativos e revoga (apaga) as linhas source='discord' que já não constam. Transacional.
 */
export function syncDiscordEntitlements(
  db: Database.Database,
  grants: EntitlementGrant[],
): EntitlementSyncResult {
  const tx = db.transaction((): EntitlementSyncResult => {
    const activeGuilds = new Set(grants.filter((g) => g.kind === 'guild').map((g) => g.id));
    const activeUsers = new Set(grants.filter((g) => g.kind === 'user').map((g) => g.id));

    // Revoga o que era 'discord' e já não está ativo (reembolso/cancelamento).
    const staleGuilds = (
      db.prepare("SELECT guild_id FROM premium_guild WHERE source = 'discord'").all() as {
        guild_id: string;
      }[]
    ).filter((r) => !activeGuilds.has(r.guild_id));
    const staleUsers = (
      db.prepare("SELECT user_id FROM premium_user WHERE source = 'discord'").all() as {
        user_id: string;
      }[]
    ).filter((r) => !activeUsers.has(r.user_id));
    for (const r of staleGuilds) {
      db.prepare("DELETE FROM premium_guild WHERE guild_id = ? AND source = 'discord'").run(r.guild_id);
    }
    for (const r of staleUsers) {
      db.prepare("DELETE FROM premium_user WHERE user_id = ? AND source = 'discord'").run(r.user_id);
    }

    // Concede/estende os ativos.
    for (const g of grants) {
      if (g.kind === 'guild') upsertDiscordGuildPremium(db, g.id, g.expiresAt);
      else upsertDiscordUserPremium(db, g.id, g.expiresAt);
    }
    return {
      guildsActive: activeGuilds.size,
      usersActive: activeUsers.size,
      revoked: staleGuilds.length + staleUsers.length,
    };
  });
  return tx();
}

/** Cria um código de resgate (gerado offline). Lança se o código já existir (PK). */
export function createRedeemCode(
  db: Database.Database,
  code: string,
  kind: PremiumKind,
  days: number,
  now: number,
): void {
  db.prepare(
    `INSERT INTO redeem_code (code, kind, days, used_by, used_at, created_at)
     VALUES (?, ?, ?, NULL, NULL, ?)`,
  ).run(code, kind, days, now);
}

/**
 * Resgata um código: verifica-e-marca-usado + concede premium NUMA ÚNICA TRANSAÇÃO — sem
 * isto um crash a meio consumia o código sem conceder, ou dois /redeem simultâneos do
 * mesmo código passavam ambos o check de "não usado". Um código 'guild' concede à guild
 * (target.guildId); 'user' concede ao invocador (target.userId). Devolve o resultado.
 */
export function redeemCode(
  db: Database.Database,
  code: string,
  target: { guildId?: string; userId: string },
  now: number,
): RedeemResult {
  const tx = db.transaction((): RedeemResult => {
    const row = db
      .prepare('SELECT kind, days, used_by FROM redeem_code WHERE code = ?')
      .get(code) as { kind: string; days: number; used_by: string | null } | undefined;
    if (!row) return { status: 'invalid' };
    if (row.used_by) return { status: 'used' };

    const kind: PremiumKind = row.kind === 'guild' ? 'guild' : 'user';
    // Código 'guild' precisa de uma guild-alvo; se faltar (ex. resgatado fora de servidor),
    // trata-se como inválido em vez de rebentar (o /redeem é guild-only, por isso raro).
    if (kind === 'guild' && !target.guildId) return { status: 'invalid' };

    const usedBy = kind === 'guild' ? (target.guildId as string) : target.userId;
    db.prepare('UPDATE redeem_code SET used_by = ?, used_at = ? WHERE code = ?').run(usedBy, now, code);

    const expiresAt =
      kind === 'guild'
        ? grantGuildPremium(db, target.guildId as string, row.days, 'redeem', now)
        : grantUserPremium(db, target.userId, row.days, 'redeem', now);
    return { status: 'ok', kind, days: row.days, expiresAt };
  });
  return tx();
}
