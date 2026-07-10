// src/premium/kofi.ts
//
// Lógica PURA do webhook do Ko-fi (opção A: Discord ID na mensagem da compra). Sem IO —
// recebe o corpo do POST e devolve o grant a aplicar. O servidor HTTP fino (kofiWebhook.ts)
// verifica o token, chama isto e aplica no store. INERTE sem KOFI_WEBHOOK_TOKEN.
//
// O Ko-fi faz POST `application/x-www-form-urlencoded` com um único campo `data` = JSON.
// Campos que usamos: verification_token, type, message (onde o comprador põe o Discord ID),
// is_subscription_payment, tier_name (memberships) e shop_items (compras únicas → anual).

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Nº de licenças (servidores) de um passe de Premium. Decisão de produto: paga 1, usa 3. */
export const PREMIUM_PASS_SEATS = 3;
/** Licenças do tier "Premium Max" (nome do produto Ko-fi contém "max"): paga 1, usa 10. */
export const PREMIUM_MAX_SEATS = 10;

export type KofiPlan = 'premium' | 'plus';

/** Subconjunto do payload do Ko-fi de que precisamos (o resto é ignorado). */
export interface KofiEvent {
  verificationToken: string;
  type: string; // Donation | Subscription | Shop Order | Commission
  message: string | null;
  isSubscriptionPayment: boolean;
  tierName: string | null;
  /** Nomes/códigos dos itens de loja concatenados, para casar palavras-chave (anual, plus…). */
  shopItemsText: string;
  fromName: string | null;
  /** Email do comprador (do Ko-fi). Chave para reencontrar o Discord ID nas renovações. */
  email: string | null;
  amount: string | null;
  transactionId: string | null;
}

export interface KofiGrant {
  plan: KofiPlan;
  days: number;
  seats: number; // relevante só para 'premium'
  /** Discord ID extraído da mensagem; null => não deu para associar (grant manual). */
  discordId: string | null;
  /** Rótulo do produto (para logs). */
  label: string;
}

/**
 * Faz parse do corpo do POST do Ko-fi. Aceita tanto o formato oficial
 * (`data=<json url-encoded>`) como JSON puro (útil em testes). Devolve null se não der.
 */
export function parseKofiPayload(raw: string): KofiEvent | null {
  try {
    let jsonText = raw.trim();
    if (jsonText.startsWith('data=') || jsonText.includes('data=')) {
      const data = new URLSearchParams(raw).get('data');
      if (data) jsonText = data;
    }
    const o = JSON.parse(jsonText) as Record<string, unknown>;
    const shopItems = Array.isArray(o.shop_items)
      ? (o.shop_items as Record<string, unknown>[])
      : [];
    const shopItemsText = shopItems
      .map((s) => `${String(s.variation_name ?? '')} ${String(s.direct_link_code ?? '')}`)
      .join(' ')
      .trim();
    return {
      verificationToken: String(o.verification_token ?? ''),
      type: String(o.type ?? ''),
      message: o.message == null ? null : String(o.message),
      isSubscriptionPayment: o.is_subscription_payment === true,
      tierName: o.tier_name == null ? null : String(o.tier_name),
      shopItemsText,
      fromName: o.from_name == null ? null : String(o.from_name),
      email: o.email == null ? null : String(o.email),
      amount: o.amount == null ? null : String(o.amount),
      transactionId: o.kofi_transaction_id == null ? null : String(o.kofi_transaction_id),
    };
  } catch {
    return null;
  }
}

/**
 * true se o token do payload bate certo com o esperado (e o esperado não é vazio).
 * Comparação em TEMPO CONSTANTE: `===` short-circuita no 1.º byte diferente e vaza um
 * oráculo de prefixo por timing. Hashamos ambos os lados para SHA-256 (comprimento fixo,
 * também não vaza o tamanho do secret) e usamos timingSafeEqual — o mesmo padrão do
 * webhook do top.gg (authMatches em src/vote.ts).
 */
export function verifyKofiToken(event: KofiEvent, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = createHash('sha256').update(event.verificationToken).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Chave OPACA para o email do comprador do Ko-fi: HMAC-SHA256(token, email normalizado).
 * Guardamos ISTO na BD (tabela kofi_supporter) em vez do email em claro — minimização de
 * PII. As renovações reenviam o email → hasheia-se e casa com o hash guardado, por isso a
 * associação email→Discord ID continua a funcionar sem nunca reter o email. O token do
 * webhook serve de chave secreta (alta entropia ⇒ sem rainbow tables sobre emails).
 * NOTA: se rodares o KOFI_WEBHOOK_TOKEN, os hashes antigos deixam de casar (renovações
 * desses supporters voltam a precisar do Discord ID na mensagem).
 */
export function hashKofiEmail(webhookToken: string, email: string): string {
  return createHmac('sha256', webhookToken).update(email.trim().toLowerCase()).digest('hex');
}

/** Extrai o 1.º Discord ID (17–20 dígitos) da mensagem, ou null. */
export function extractDiscordId(message: string | null): string | null {
  if (!message) return null;
  const m = message.match(/\b(\d{17,20})\b/);
  return m ? m[1] : null;
}

/**
 * Decide o grant a partir do evento, por PALAVRAS-CHAVE no nome do tier/itens (robusto a
 * nomes exatos): "plus" => Plus (user); "premium" => passe de Premium (guild), com "max"
 * => 10 licenças (Premium Max) e senão as 3 default. "annual"/"anual"/"year"/"ano" => 365
 * dias, senão 30 (mensal). Devolve null se não for um produto reconhecível (ex.: donativo
 * avulso) — esses são ignorados. ORDEM CRÍTICA: o "plus" é testado ANTES do "premium", por
 * isso um produto Premium Max NUNCA pode conter a palavra "plus" no nome.
 */
export function mapKofiToGrant(event: KofiEvent, now: number): KofiGrant | null {
  void now; // reservado (datas são calculadas no store ao aplicar)
  const label = `${event.tierName ?? ''} ${event.shopItemsText}`.trim();
  const lower = label.toLowerCase();
  let plan: KofiPlan | null = null;
  if (/\bplus\b/.test(lower) || lower.includes('plus')) plan = 'plus';
  else if (lower.includes('premium')) plan = 'premium';
  if (!plan) return null;
  const annual = /(annual|anual|yearly|year|ano)/.test(lower);
  const days = annual ? 365 : 30;
  // Tier "Max": um passe de Premium com 10 licenças em vez de 3. Só se aplica ao 'premium'
  // (o Plus é por-utilizador, seats irrelevante).
  const seats =
    plan === 'premium' && /\bmax\b/.test(lower) ? PREMIUM_MAX_SEATS : PREMIUM_PASS_SEATS;
  return {
    plan,
    days,
    seats,
    discordId: extractDiscordId(event.message),
    label: label || plan,
  };
}
