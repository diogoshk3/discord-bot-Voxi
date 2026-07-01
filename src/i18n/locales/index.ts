/**
 * Registry de ficheiros de traducao POR-LOCALE (arquitetura para 34 linguas).
 *
 * Porque nao inline no catalog.ts? Com 34 linguas × 137 chaves seriam milhares de
 * linhas num so ficheiro. Em vez disso:
 *  - `catalog.ts` continua a ser a BASE: `en` (fonte de verdade) + `pt` inline.
 *  - Cada OUTRA lingua (Fase B) vive em `src/i18n/locales/<code>.ts`, exportando
 *    um `Record<string, string>` (chave -> traducao para essa lingua). Fica assim
 *    isolada, revisavel e traduzivel ficheiro-a-ficheiro.
 *
 * Este `locales` e o LOADER: um mapa ESTATICO `locale -> traducoes`. Nao usamos
 * `fs.readdir`/`import()` dinamico de proposito — isso parte-se sob vitest/tsc e
 * nao traz nada. O `t()` (em ../index) consulta este mapa PRIMEIRO na sua cadeia
 * de resolucao.
 *
 * FASE A: o registry esta VAZIO — so existem `en`/`pt` (inline no catalogo), por
 * isso todos os outros 32 locales caem corretamente no fallback `en` via t().
 *
 * FASE B (adicionar uma lingua): 2 passos, so aqui —
 *   1. criar `src/i18n/locales/es.ts` -> `export default { 'help.title': '…', … }`
 *   2. `import es from './es'` e adicionar `es,` ao objeto `locales` abaixo.
 * Nada mais muda: `t()` passa a servir essa lingua automaticamente.
 */
export const locales: Record<string, Record<string, string>> = {
  // Fase B: registar aqui cada `locales/<code>.ts`. Ex.: `es,` `fr,` `de,` …
};
