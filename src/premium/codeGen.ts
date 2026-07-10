// Geração e normalização de códigos de presente (gift codes) do Vozen. PURO/testável:
// a aleatoriedade é injetada (produção usa node:crypto.randomInt; testes injetam algo
// determinístico). Formato: VOZEN-XXXX-XXXX com um alfabeto SEM caracteres ambíguos
// (nada de 0/O, 1/I/L) — para ninguém confundir ao copiar/escrever à mão.

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Gera um código "VOZEN-XXXX-XXXX". `randInt(max)` devolve um inteiro em [0, max). */
export function generateCodeString(randInt: (max: number) => number): string {
  const block = (): string =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[randInt(CODE_ALPHABET.length)]).join('');
  return `VOZEN-${block()}-${block()}`;
}

/** Normaliza o input do utilizador para bater com o formato guardado (uppercase, sem espaços). */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}
