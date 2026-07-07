// src/games/wordchain/core.ts
//
// Núcleo PURO do minijogo "cadeia de palavras" (word-chain). Sem I/O, sem discord.js,
// sem estado global — só as regras da cadeia, para ser testado isolado e determinista.
// A orquestração (lobby, turnos, vidas, voz) vive em src/games/wordChain.ts.

/** Línguas latinas suportadas (têm wordlist em assets/wordlists/). */
export type WordChainLang = 'pt' | 'en' | 'es' | 'fr';
export const WORDCHAIN_LANGS: readonly WordChainLang[] = ['pt', 'en', 'es', 'fr'];

// NORMALIZAÇÃO — TEM de ser byte-a-byte igual à de tools/build-wordlists.mjs, senão o
// input do utilizador normaliza diferente da lista e palavras válidas são rejeitadas.
// O teste fixa os outputs canónicos (Cães->caes, éléphant->elephant, Straße->strasse).
const RE_PLAYABLE = /^[a-z]+$/;
export function normalize(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacríticos combinados
    .toLowerCase() // ANTES das ligaduras, para apanhar maiúsculas (Æ, Ø, Ł…)
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/đ/g, 'd')
    .replace(/ł/g, 'l');
}

/** true se a forma normalizada é "jogável" (só a-z, sem espaços/dígitos/pontuação). */
export function isPlayableForm(normalized: string): boolean {
  return RE_PLAYABLE.test(normalized);
}

/** Dicionário de uma língua: pertença + que letras iniciais têm palavras. */
export interface Dictionary {
  has(normalizedWord: string): boolean;
  /** Existe ALGUMA palavra que começa por esta letra (a-z)? Para a regra da letra-morta. */
  hasStartingWith(letter: string): boolean;
}

/** Dicionário a partir de uma lista de palavras JÁ normalizadas (o que o loader dá). */
export class WordSetDictionary implements Dictionary {
  private readonly words: Set<string>;
  private readonly firstLetters: Set<string>;
  constructor(normalizedWords: Iterable<string>) {
    this.words = new Set(normalizedWords);
    this.firstLetters = new Set();
    for (const w of this.words) if (w) this.firstLetters.add(w[0]);
  }
  has(w: string): boolean {
    return this.words.has(w);
  }
  hasStartingWith(letter: string): boolean {
    return this.firstLetters.has(letter);
  }
}

export type ValidationReason =
  | 'ok'
  | 'not-latin' // tem letras fora de a-z depois de normalizar (ex.: palavra noutro alfabeto)
  | 'too-short'
  | 'wrong-letter'
  | 'repeated'
  | 'not-a-word';

export interface ValidationResult {
  ok: boolean;
  reason: ValidationReason;
  /** Forma normalizada avaliada (para logs / mensagens). */
  normalized: string;
}

export interface ChainConfig {
  /** Duração do 1.º turno (ms). Default 15000. */
  startTurnMs?: number;
  /** Piso da duração do turno (ms). Default 6000. */
  minTurnMs?: number;
  /** Quanto encurta o turno por cada palavra aceite (ms). Default 400. */
  turnDecrementMs?: number;
  /** Tamanho mínimo inicial da palavra. Default 3. */
  baseMinLength?: number;
}

const DEFAULTS: Required<ChainConfig> = {
  startTurnMs: 15000,
  minTurnMs: 6000,
  turnDecrementMs: 400,
  baseMinLength: 3,
};

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/** RNG determinista (mulberry32) — start-letter reproduzível a partir do seed do jogo. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Motor da cadeia: mantém a letra obrigatória, as palavras já usadas e a dificuldade.
 * NÃO sabe nada de jogadores/turnos/vidas — isso é do jogo. Mutável por design (uma
 * instância = uma partida), mas cada método é determinista dado o estado.
 */
export class ChainEngine {
  private readonly cfg: Required<ChainConfig>;
  private readonly used = new Set<string>();
  private letter: string;
  private accepted = 0;

  constructor(
    private readonly dict: Dictionary,
    seed: number,
    config: ChainConfig = {},
  ) {
    this.cfg = { ...DEFAULTS, ...config };
    // Letra de arranque: aleatória (seeded) entre as que TÊM palavras no dicionário.
    const rng = mulberry32(seed);
    const candidates = [...ALPHABET].filter((l) => dict.hasStartingWith(l));
    const pool = candidates.length ? candidates : [...ALPHABET];
    this.letter = pool[Math.floor(rng() * pool.length)];
  }

  /** Letra por que a próxima palavra tem de começar. */
  get requiredLetter(): string {
    return this.letter;
  }

  /** Palavras aceites até agora (comprimento da cadeia). */
  get chainLength(): number {
    return this.accepted;
  }

  /** Tamanho mínimo atual: 3 → 4 (após 8 palavras) → 5 (após 16). */
  get minLength(): number {
    const base = this.cfg.baseMinLength;
    if (this.accepted >= 16) return base + 2;
    if (this.accepted >= 8) return base + 1;
    return base;
  }

  /** Duração do turno atual (ms): encurta com a cadeia, com piso. */
  get turnMs(): number {
    const raw = this.cfg.startTurnMs - this.accepted * this.cfg.turnDecrementMs;
    return Math.max(this.cfg.minTurnMs, raw);
  }

  /** Valida uma palavra crua (como o utilizador a escreveu) contra o estado atual. */
  validate(rawWord: string): ValidationResult {
    const normalized = normalize(rawWord.trim());
    if (!isPlayableForm(normalized) || normalized.length === 0) {
      return { ok: false, reason: 'not-latin', normalized };
    }
    if (normalized[0] !== this.letter) {
      return { ok: false, reason: 'wrong-letter', normalized };
    }
    if (normalized.length < this.minLength) {
      return { ok: false, reason: 'too-short', normalized };
    }
    if (this.used.has(normalized)) {
      return { ok: false, reason: 'repeated', normalized };
    }
    if (!this.dict.has(normalized)) {
      return { ok: false, reason: 'not-a-word', normalized };
    }
    return { ok: true, reason: 'ok', normalized };
  }

  /**
   * Aceita uma palavra JÁ validada: regista-a, avança a dificuldade e escolhe a próxima
   * letra obrigatória. Regra da letra-morta: usa a última letra; se nenhuma palavra do
   * dicionário começa por ela, cai na penúltima; se essa também for morta, escolhe uma
   * letra viva qualquer (determinista). Assume validate()===ok — não revalida.
   */
  accept(normalizedWord: string): void {
    this.used.add(normalizedWord);
    this.accepted += 1;
    const last = normalizedWord[normalizedWord.length - 1];
    const penult = normalizedWord.length >= 2 ? normalizedWord[normalizedWord.length - 2] : last;
    if (this.dict.hasStartingWith(last)) {
      this.letter = last;
    } else if (this.dict.hasStartingWith(penult)) {
      this.letter = penult;
    } else {
      const alive = [...ALPHABET].find((l) => this.dict.hasStartingWith(l));
      this.letter = alive ?? last;
    }
  }

  /** Uma palavra já foi usada nesta partida? (para mensagens/testes) */
  isUsed(normalizedWord: string): boolean {
    return this.used.has(normalizedWord);
  }
}
