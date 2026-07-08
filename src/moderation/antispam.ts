// src/moderation/antispam.ts — deteção de spam para a leitura em voz (plano 017).
//
// Duas heurísticas PURAS e conservadoras (opt-in por guild; OFF por defeito):
//  1) isRepetitionSpam — repetição massiva de tokens DENTRO de uma mensagem
//     (ex. "POKEBOLAS POKEBOLAS ×39"): muitos tokens + baixíssima diversidade.
//  2) DuplicateTracker — a MESMA pessoa a repetir a MESMA mensagem grande em
//     janela curta (a 1.ª lê-se; as seguintes, dentro da janela, não).
//
// Limiares pinados como constantes exportadas — a superfície de afinação. São
// deliberadamente conservadores para minimizar falsos positivos (letras de música,
// contagens). Nada aqui faz I/O.

/** Nº mínimo de tokens para sequer considerar repetição (mensagens curtas nunca são spam). */
export const REPETITION_MIN_TOKENS = 10;
/** Diversidade (únicos/total) NO MÁXIMO isto => spam. 0.35: "abc abc abc" (0.33) apanha; frase normal (~0.9) não. */
export const REPETITION_UNIQUE_RATIO_MAX = 0.35;
/** Comprimento mínimo (chars normalizados) para uma mensagem contar como duplicado-spam. */
export const DUPLICATE_MIN_CHARS = 40;
/** Janela do duplicado: repetições da MESMA mensagem dentro disto são suprimidas. */
export const DUPLICATE_WINDOW_MS = 60 * 1000;
/** Teto de entradas do tracker (anti-crescimento); evict da mais antiga ao exceder. */
const MAX_ENTRIES = 10_000;

/** Tokeniza para a heurística de repetição: minúsculas, corta em não-(letra|número), sem vazios. PURA. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * A mensagem é REPETIÇÃO-spam? True se tiver ≥ REPETITION_MIN_TOKENS tokens E a
 * diversidade (únicos/total) for ≤ REPETITION_UNIQUE_RATIO_MAX. Mensagens curtas
 * (< min tokens) são sempre falsas — não queremos apanhar "sim sim sim". PURA.
 */
export function isRepetitionSpam(text: string): boolean {
  const tokens = tokenize(text);
  if (tokens.length < REPETITION_MIN_TOKENS) return false;
  const unique = new Set(tokens).size;
  return unique / tokens.length <= REPETITION_UNIQUE_RATIO_MAX;
}

/** Normaliza para comparar duplicados: minúsculas, espaços colapsados, trim. PURA. */
export function normalizeForDuplicate(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

interface DupEntry {
  text: string;
  ts: number;
}

/**
 * Deteta a MESMA pessoa a repetir a MESMA mensagem grande em janela curta, por
 * (guild, author). Estado em memória com cap + evict (padrão do rateLimiter). É uma
 * janela FIXA: uma repetição suprimida NÃO renova o timestamp — passada a janela, a
 * mensagem volta a ser lida uma vez. Relógio passado por chamada (como o rateLimiter).
 */
export class DuplicateTracker {
  // Map preserva ordem de inserção → a 1.ª chave é a mais antiga (evict simples).
  private readonly last = new Map<string, DupEntry>();

  private static keyOf(guildId: string, authorId: string): string {
    return `${guildId}:${authorId}`;
  }

  /**
   * `text` (o corpo já limpo) é duplicado-spam AGORA? False para mensagens curtas
   * (< DUPLICATE_MIN_CHARS normalizados) — só o flood de mensagens GRANDES conta.
   * True se for idêntica à última desta pessoa dentro de DUPLICATE_WINDOW_MS. A 1.ª
   * ocorrência (ou depois da janela, ou texto novo) é REGISTADA e devolve false.
   */
  isDuplicateSpam(guildId: string, authorId: string, text: string, nowMs: number): boolean {
    const norm = normalizeForDuplicate(text);
    if (norm.length < DUPLICATE_MIN_CHARS) return false;
    const key = DuplicateTracker.keyOf(guildId, authorId);
    const prev = this.last.get(key);
    if (prev && prev.text === norm && nowMs - prev.ts < DUPLICATE_WINDOW_MS) {
      return true; // duplicado dentro da janela — suprime, sem renovar (janela fixa)
    }
    this.last.delete(key); // reinsere no fim (MRU) para o evict acertar na mais antiga
    this.last.set(key, { text: norm, ts: nowMs });
    if (this.last.size > MAX_ENTRIES) {
      const oldest = this.last.keys().next().value as string | undefined;
      if (oldest !== undefined) this.last.delete(oldest);
    }
    return false;
  }
}
