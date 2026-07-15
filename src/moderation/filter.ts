function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Cache de RegExp compiladas por CONTEUDO da blocklist. Sem isto, isBlocked/redactBlocked
// recompilavam N RegExp unicode a CADA mensagem lida (o array da blocklist chega como copia
// nova a cada chamada, por isso a IDENTIDADE nao serve para memoizar — usamos o conteudo
// juntado). Reutilizar as RegExp e seguro: os padroes de isBlocked sao NAO-globais (`.test`
// e stateless) e `String.replace` com uma RegExp global reseta o `lastIndex` a cada chamada.
// Cap simples com limpeza total ao atingir o teto (poucas guilds com blocklist ativa).
const CACHE_CAP = 256;
const blockedTestCache = new Map<string, RegExp[]>();
const redactCache = new Map<string, RegExp[]>();

function compiled(
  cache: Map<string, RegExp[]>,
  words: string[],
  build: (w: string) => RegExp,
): RegExp[] {
  const key = words.join('\n');
  let regs = cache.get(key);
  if (!regs) {
    regs = words.map(build);
    if (cache.size >= CACHE_CAP) cache.clear();
    cache.set(key, regs);
  }
  return regs;
}

export function isBlocked(text: string, blocklist: string[]): boolean {
  const words = blocklist.map((w) => w.trim().toLowerCase()).filter((w) => w !== '');
  if (words.length === 0) return false;
  const haystack = text.toLowerCase();
  // match por palavra completa: limites em fronteiras nao-alfanumericas.
  // \b nao chega para acentos/unicode, por isso usamos lookarounds manuais.
  const regs = compiled(
    blockedTestCache,
    words,
    (w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(w)}([^\\p{L}\\p{N}]|$)`, 'u'),
  );
  return regs.some((re) => re.test(haystack));
}

/**
 * REDIGE (remove) as palavras da blocklist do texto, mantendo o resto legível — para o
 * Vozen NÃO FALAR essas palavras mas continuar a ler a mensagem (em vez de saltar a
 * mensagem inteira). Match por PALAVRA COMPLETA (mesmas fronteiras unicode do
 * isBlocked), case-insensitive. Usa lookbehind/lookahead ZERO-WIDTH (não consome as
 * fronteiras) para o replace GLOBAL funcionar mesmo em palavras bloqueadas consecutivas.
 * Colapsa os espaços que sobram da remoção. Sem palavra bloqueada presente -> texto
 * inalterado (não normaliza espaços à toa). PURA.
 */
export function redactBlocked(text: string, blocklist: string[]): string {
  const words = blocklist.map((w) => w.trim()).filter((w) => w !== '');
  if (words.length === 0) return text;
  const regs = compiled(
    redactCache,
    words,
    (w) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(w)}(?![\\p{L}\\p{N}])`, 'giu'),
  );
  let out = text;
  let changed = false;
  for (const re of regs) {
    const next = out.replace(re, ' ');
    if (next !== out) {
      out = next;
      changed = true;
    }
  }
  return changed ? out.replace(/\s+/g, ' ').trim() : out;
}
