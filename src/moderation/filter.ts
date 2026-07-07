function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isBlocked(text: string, blocklist: string[]): boolean {
  const haystack = text.toLowerCase();

  for (const raw of blocklist) {
    const word = raw.trim().toLowerCase();
    if (word === '') {
      continue;
    }
    // match por palavra completa: limites em fronteiras nao-alfanumericas.
    // \b nao chega para acentos/unicode, por isso usamos lookarounds manuais.
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}([^\\p{L}\\p{N}]|$)`, 'u');
    if (pattern.test(haystack)) {
      return true;
    }
  }

  return false;
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
  let out = text;
  let changed = false;
  for (const raw of blocklist) {
    const word = raw.trim();
    if (word === '') {
      continue;
    }
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'giu');
    const next = out.replace(pattern, ' ');
    if (next !== out) {
      out = next;
      changed = true;
    }
  }
  return changed ? out.replace(/\s+/g, ' ').trim() : out;
}
