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
