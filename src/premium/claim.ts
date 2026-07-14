// src/premium/claim.ts
//
// Lógica PURA do CLAIM: o comprador reclama uma compra Ko-fi pendente (que chegou sem Discord
// ID, ver store/kofiPending.ts) introduzindo o CÓDIGO da transação do recibo — chave forte que
// só ele tem. A identidade do Discord vem já validada por OAuth (o endpoint chama
// statusApi.resolveIdentity ANTES disto), por isso aqui confiamos no `discordId`. Aplica o
// grant, marca o pendente reclamado e memoriza email->Discord ID (renovações futuras
// resolvem-se sozinhas). Sem IO de rede; testável isoladamente.

import type Database from 'better-sqlite3';
import { grantUserPremium, grantGuildPass, rememberKofiSupporter } from '../store/premium';
import {
  findUnclaimedPendingByTx,
  listUnclaimedPendingByEmailHash,
  markPendingClaimed,
  type PendingGrant,
} from '../store/kofiPending';

/** Uma compra aplicada no claim (para a resposta ao site). */
export interface ClaimedItem {
  plan: string; // 'plus' | 'premium'
  days: number;
  seats: number;
  expiresAt: number;
}

export type ClaimOutcome =
  | { ok: true; items: ClaimedItem[] }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'use_receipt_code' };

/** Aplica UM pendente ao Discord ID (Plus por-utilizador ou passe de Premium). source='kofi'. */
function applyPending(
  db: Database.Database,
  discordId: string,
  p: PendingGrant,
  now: number,
): ClaimedItem {
  const expiresAt =
    p.plan === 'plus'
      ? grantUserPremium(db, discordId, p.days, 'kofi', now)
      : grantGuildPass(db, discordId, p.seats, p.days, 'kofi', now);
  return { plan: p.plan, days: p.days, seats: p.seats, expiresAt };
}

/**
 * Reclama uma compra Ko-fi pendente. O `input` deve ser o CÓDIGO da transação do recibo Ko-fi
 * (chave forte que só o comprador tem). Um `input` do tipo EMAIL (contém '@') é REJEITADO com
 * `use_receipt_code` sem tocar na BD — o email NÃO é aceite como prova de posse: não é segredo,
 * e para qualquer conta Discord logada que o soubesse era possível reclamar o Premium de outra
 * pessoa durante os 90 dias de retenção do pendente (ver "## Decision" no plano 021). A
 * identidade Discord vem já validada por OAuth. Aplica ao `discordId` TODAS as compras
 * pendentes do MESMO email (renovações órfãs), marca-as reclamadas e memoriza email->Discord ID
 * (renovações futuras resolvem-se sozinhas). Transacional e de USO ÚNICO. `webhookToken` já não
 * é usado no caminho por email (mantido na assinatura por estabilidade).
 */
export function claimPendingGrant(
  db: Database.Database,
  discordId: string,
  input: string,
  webhookToken: string | undefined,
  now: number,
): ClaimOutcome {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: 'not_found' };
  const tx = db.transaction((): ClaimOutcome => {
    let targets: PendingGrant[];
    let emailHashForRemember: string | null;

    if (trimmed.includes('@')) {
      // Via EMAIL: plano 021 — já não é aceite como prova de posse (não é segredo). Devolve
      // use_receipt_code SEM tocar na BD: a resposta não varia consoante o email pertença ou
      // não a uma compra pendente, por isso não há oráculo nenhum a explorar aqui.
      return { ok: false, reason: 'use_receipt_code' };
    } else {
      // Via CÓDIGO (tx id): acha o pendente e, por ele, todas as compras do mesmo email.
      const match = findUnclaimedPendingByTx(db, trimmed);
      if (!match) return { ok: false, reason: 'not_found' };
      targets = match.emailHash ? listUnclaimedPendingByEmailHash(db, match.emailHash) : [match];
      emailHashForRemember = match.emailHash;
    }

    const items: ClaimedItem[] = [];
    for (const p of targets) {
      // markPendingClaimed devolve false se já estava reclamado (corrida) — nesse caso não
      // aplicamos, para nunca dar dias a dobrar.
      if (!markPendingClaimed(db, p.transactionId, now)) continue;
      items.push(applyPending(db, discordId, p, now));
    }
    if (items.length === 0) return { ok: false, reason: 'not_found' };
    if (emailHashForRemember) rememberKofiSupporter(db, emailHashForRemember, discordId, now);
    return { ok: true, items };
  });
  return tx();
}
