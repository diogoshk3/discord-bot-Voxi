import type Database from 'better-sqlite3';

// Vozen Premium / Plus: assinaturas baseadas em EXPIRY (unix ms). Sem linha ou expirado =>
// Free. As features NOVAS (efeitos completos, soundboard, etc.) consultam isGuildPremium/
// isUserPremium; nada do que já é grátis passa a pago. As compras chegam pelo webhook do
// Ko-fi (source 'kofi'); o dono também pode conceder à mão com /vozengrant (source 'manual').

export type PremiumKind = 'guild' | 'user';

const DAY_MS = 86_400_000;

export function isGuildPremium(db: Database.Database, guildId: string, now: number): boolean {
  // Premium DIRETO do servidor (redeem/discord/manual)...
  const row = db.prepare('SELECT expires_at FROM premium_guild WHERE guild_id = ?').get(guildId) as
    { expires_at: number } | undefined;
  if (row && row.expires_at > now) return true;
  // ...OU um PASSE: existe uma ativação deste servidor cujo passe ainda não expirou?
  const pass = db
    .prepare(
      `SELECT 1 FROM premium_pass_activation a
       JOIN premium_pass p ON p.user_id = a.user_id
       WHERE a.guild_id = ? AND p.expires_at > ? LIMIT 1`,
    )
    .get(guildId, now) as { 1: number } | undefined;
  return !!pass;
}

export function isUserPremium(db: Database.Database, userId: string, now: number): boolean {
  const row = db.prepare('SELECT expires_at FROM premium_user WHERE user_id = ?').get(userId) as
    { expires_at: number } | undefined;
  return !!row && row.expires_at > now;
}

/** Expiry do premium da guild (unix ms) ou null se nunca teve. Pode estar no passado. */
export function getGuildPremiumExpiry(db: Database.Database, guildId: string): number | null {
  const row = db.prepare('SELECT expires_at FROM premium_guild WHERE guild_id = ?').get(guildId) as
    { expires_at: number } | undefined;
  return row ? row.expires_at : null;
}

/**
 * Fim EFETIVO do Premium do servidor para EXIBIÇÃO (só ativos): o máximo entre o expiry
 * direto (redeem/discord/manual) e o fim de qualquer passe que tenha uma licença ativa
 * aqui. null se o servidor não está Premium agora. (Para ESTENDER usa-se getGuildPremium
 * Expiry, que é só a linha direta.)
 */
export function effectiveGuildPremiumExpiry(
  db: Database.Database,
  guildId: string,
  now: number,
): number | null {
  const row = db
    .prepare(
      `SELECT MAX(exp) AS m FROM (
         SELECT expires_at AS exp FROM premium_guild WHERE guild_id = ? AND expires_at > ?
         UNION ALL
         SELECT p.expires_at FROM premium_pass_activation a
           JOIN premium_pass p ON p.user_id = a.user_id
           WHERE a.guild_id = ? AND p.expires_at > ?
       )`,
    )
    .get(guildId, now, guildId, now) as { m: number | null };
  return row.m ?? null;
}

/** Expiry do Plus do utilizador (unix ms) ou null se nunca teve. Pode estar no passado. */
export function getUserPremiumExpiry(db: Database.Database, userId: string): number | null {
  const row = db.prepare('SELECT expires_at FROM premium_user WHERE user_id = ?').get(userId) as
    { expires_at: number } | undefined;
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
  const row = db.prepare('SELECT expires_at FROM premium_user WHERE user_id = ?').get(userId) as
    { expires_at: number } | undefined;
  const base = row && row.expires_at > now ? row.expires_at : now;
  const expiresAt = base + days * DAY_MS;
  db.prepare(
    `INSERT INTO premium_user (user_id, expires_at, source)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET expires_at = excluded.expires_at, source = excluded.source`,
  ).run(userId, expiresAt, source);
  return expiresAt;
}

// ── Passe de Premium (Ko-fi): N licenças por-utilizador, ativadas por servidor ───────
// Uma compra de Premium (guild) dá à PESSOA um passe com `seats` licenças e uma data de
// fim ABSOLUTA. A pessoa gasta uma licença num servidor (activateSeat) e pode libertá-la
// (deactivateSeat) para a usar noutro — o relógio corre sempre no passe, não no servidor.

export interface PremiumPass {
  seats: number;
  expiresAt: number;
  source: string;
}

export type ActivateStatus = 'ok' | 'already' | 'no_pass' | 'expired' | 'no_seats';

export interface ActivateResult {
  status: ActivateStatus;
  seats?: number; // total de licenças do passe
  used?: number; // licenças em uso após a operação
  expiresAt?: number; // fim do passe (unix ms)
}

/** Passe do utilizador (ou null se nunca comprou). expiresAt pode estar no passado. */
export function getPremiumPass(db: Database.Database, userId: string): PremiumPass | null {
  const row = db
    .prepare('SELECT seats, expires_at, source FROM premium_pass WHERE user_id = ?')
    .get(userId) as { seats: number; expires_at: number; source: string } | undefined;
  return row ? { seats: row.seats, expiresAt: row.expires_at, source: row.source } : null;
}

/** Servidores onde o utilizador tem uma licença ativa (ordem de ativação). */
export function listPassActivations(db: Database.Database, userId: string): string[] {
  return (
    db
      .prepare(
        'SELECT guild_id FROM premium_pass_activation WHERE user_id = ? ORDER BY activated_at',
      )
      .all(userId) as { guild_id: string }[]
  ).map((r) => r.guild_id);
}

/**
 * Dono (e nº de seats) do passe ATIVO que cobre esta guild — para saber a que POOL de
 * allowance do Google HD debitar (o pool é do PASSE, partilhado entre os servidores dele,
 * keyed pelo dono). Só passes não-expirados. `premium_pass_activation` não tem UNIQUE em
 * guild_id, por isso dois donos PODERIAM ter ativado a mesma guild — desempate
 * DETERMINÍSTICO pelo `activated_at` mais antigo (o primeiro a cobrir a guild). null se
 * nenhum passe ativo cobre a guild (ex.: Premium direto por redeem/discord, sem passe).
 */
export function resolveGuildPassOwner(
  db: Database.Database,
  guildId: string,
  now: number,
): { ownerId: string; seats: number } | null {
  const row = db
    .prepare(
      `SELECT a.user_id AS owner, p.seats AS seats
       FROM premium_pass_activation a
       JOIN premium_pass p ON p.user_id = a.user_id
       WHERE a.guild_id = ? AND p.expires_at > ?
       ORDER BY a.activated_at ASC
       LIMIT 1`,
    )
    .get(guildId, now) as { owner: string; seats: number } | undefined;
  return row ? { ownerId: row.owner, seats: row.seats } : null;
}

/** Quantas licenças o utilizador tem em uso agora. */
export function countActiveSeats(db: Database.Database, userId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM premium_pass_activation WHERE user_id = ?')
    .get(userId) as { n: number };
  return row.n;
}

/**
 * Concede/renova um passe de `seats` licenças por `days` dias. ESTENDE a partir do máximo
 * entre agora e o fim atual (renovar antes de expirar acumula). Nunca REDUZ o nº de
 * licenças (usa o máximo) — subir de plano aumenta, renovar mantém. Devolve o novo fim.
 */
export function grantGuildPass(
  db: Database.Database,
  userId: string,
  seats: number,
  days: number,
  source: string,
  now: number,
): number {
  const cur = getPremiumPass(db, userId);
  const base = cur && cur.expiresAt > now ? cur.expiresAt : now;
  const expiresAt = base + days * DAY_MS;
  const finalSeats = cur ? Math.max(cur.seats, seats) : seats;
  db.prepare(
    `INSERT INTO premium_pass (user_id, seats, expires_at, source)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET seats = excluded.seats, expires_at = excluded.expires_at, source = excluded.source`,
  ).run(userId, finalSeats, expiresAt, source);
  return expiresAt;
}

/**
 * Gasta uma licença do passe no servidor `guildId`. Transacional (conta-e-insere) para não
 * passar do limite com dois cliques simultâneos. Idempotente: reativar o mesmo servidor
 * devolve 'already' sem gastar outra licença.
 */
export function activateSeat(
  db: Database.Database,
  userId: string,
  guildId: string,
  now: number,
): ActivateResult {
  const tx = db.transaction((): ActivateResult => {
    const pass = getPremiumPass(db, userId);
    if (!pass) return { status: 'no_pass' };
    if (pass.expiresAt <= now) return { status: 'expired', expiresAt: pass.expiresAt };
    const already = db
      .prepare('SELECT 1 FROM premium_pass_activation WHERE user_id = ? AND guild_id = ?')
      .get(userId, guildId);
    const used = countActiveSeats(db, userId);
    if (already) return { status: 'already', seats: pass.seats, used, expiresAt: pass.expiresAt };
    if (used >= pass.seats)
      return { status: 'no_seats', seats: pass.seats, used, expiresAt: pass.expiresAt };
    db.prepare(
      'INSERT INTO premium_pass_activation (user_id, guild_id, activated_at) VALUES (?, ?, ?)',
    ).run(userId, guildId, now);
    return { status: 'ok', seats: pass.seats, used: used + 1, expiresAt: pass.expiresAt };
  });
  return tx();
}

/** Liberta a licença de `guildId`. Devolve true se havia uma ativação para remover. */
export function deactivateSeat(db: Database.Database, userId: string, guildId: string): boolean {
  const res = db
    .prepare('DELETE FROM premium_pass_activation WHERE user_id = ? AND guild_id = ?')
    .run(userId, guildId);
  return res.changes > 0;
}

// ── Vista do estado premium (para o Painel Premium do site) ───────────────────────────
// Monta, para UM utilizador, tudo o que o painel mostra: Plus (por-utilizador) + passe de
// Premium (licenças usadas/total, fim, servidores ativados). Função PURA de leitura — a API
// HTTP (statusApi.ts) só a chama depois de validar a identidade na Discord. Nunca por ID
// arbitrário: o chamador tem de provar que é o dono do token.

export interface PremiumStatusView {
  plus: { active: boolean; expiresAt: number | null };
  pass: {
    seats: number;
    used: number;
    expiresAt: number;
    active: boolean;
    guilds: string[];
  } | null;
}

/** Estado premium completo de um utilizador (para exibição no painel). */
export function buildPremiumStatus(
  db: Database.Database,
  userId: string,
  now: number,
): PremiumStatusView {
  const plusExp = getUserPremiumExpiry(db, userId);
  const pass = getPremiumPass(db, userId);
  return {
    plus: { active: !!plusExp && plusExp > now, expiresAt: plusExp },
    pass: pass
      ? {
          seats: pass.seats,
          used: countActiveSeats(db, userId),
          expiresAt: pass.expiresAt,
          active: pass.expiresAt > now,
          guilds: listPassActivations(db, userId),
        }
      : null,
  };
}

// ── Ko-fi: mapa HASH(email) -> Discord ID (para as renovações) ─────────────────────────
// A 1.ª compra traz o Discord ID na mensagem; guardamo-lo indexado pelo HASH do email. As
// renovações não reenviam a mensagem, por isso reencontramos o Discord ID pelo hash do
// email do pagamento. A BD NUNCA guarda o email em claro (minimização de PII) — a chave
// `emailHash` é opaca (HMAC calculado no webhook, ver hashKofiEmail em premium/kofi.ts).

/** Guarda/atualiza o Discord ID associado ao HASH de um email do Ko-fi. */
export function rememberKofiSupporter(
  db: Database.Database,
  emailHash: string,
  discordId: string,
  now: number,
): void {
  db.prepare(
    `INSERT INTO kofi_supporter (email_hash, discord_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(email_hash) DO UPDATE SET discord_id = excluded.discord_id, updated_at = excluded.updated_at`,
  ).run(emailHash, discordId, now);
}

/** Reencontra o Discord ID a partir do HASH de um email do Ko-fi (ou null). */
export function lookupKofiSupporter(db: Database.Database, emailHash: string): string | null {
  const row = db
    .prepare('SELECT discord_id FROM kofi_supporter WHERE email_hash = ?')
    .get(emailHash) as { discord_id: string } | undefined;
  return row ? row.discord_id : null;
}

/**
 * Regista uma transação Ko-fi como processada (idempotência do webhook). Devolve true
 * na 1.ª vez (a entrega deve ser aplicada) e false num duplicado/retry (já processada
 * — o chamador confirma 200 SEM voltar a aplicar o grant, que acumula expiry).
 * O chamador deve embrulhar registo+grant numa db.transaction para serem atómicos:
 * se o grant falhar, o registo também reverte e um retry legítimo volta a passar.
 */
export function recordKofiTransaction(
  db: Database.Database,
  transactionId: string,
  now: number,
): boolean {
  const res = db
    .prepare('INSERT OR IGNORE INTO kofi_transaction (transaction_id, processed_at) VALUES (?, ?)')
    .run(transactionId, now);
  return res.changes > 0;
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
      db.prepare("DELETE FROM premium_guild WHERE guild_id = ? AND source = 'discord'").run(
        r.guild_id,
      );
    }
    for (const r of staleUsers) {
      db.prepare("DELETE FROM premium_user WHERE user_id = ? AND source = 'discord'").run(
        r.user_id,
      );
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
