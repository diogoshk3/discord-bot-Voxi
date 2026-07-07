// src/games/wordchain/dict.ts
//
// Carregamento (I/O) das wordlists por-língua para o word-chain. Separado do core.ts
// (puro) de propósito: o motor testa-se com um Set à mão; isto lê os ficheiros reais.
// Lazy + cache: só a língua de uma partida é carregada, e só uma vez por processo.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WordSetDictionary, type Dictionary, type WordChainLang } from './core';
import { log } from '../../logging/logger';

// As wordlists vivem em assets/wordlists/ (raiz do repo). Em runtime este módulo vive
// em dist/games/wordchain/, logo a raiz está 3 níveis acima (padrão de shard.ts, que
// resolve a partir de __dirname para ser robusto ao cwd).
const WORDLISTS_DIR = join(__dirname, '..', '..', '..', 'assets', 'wordlists');

const cache = new Map<WordChainLang, Dictionary>();

/**
 * Devolve o dicionário de uma língua (cacheado). Se o ficheiro faltar/estiver vazio,
 * loga e devolve `null` — o jogo trata isso como "língua indisponível" em vez de crashar.
 */
export function loadDictionary(lang: WordChainLang): Dictionary | null {
  const cached = cache.get(lang);
  if (cached) return cached;
  const file = join(WORDLISTS_DIR, `${lang}.txt`);
  if (!existsSync(file)) {
    log.error(`[wordchain] wordlist em falta: ${file}`);
    return null;
  }
  try {
    const words = readFileSync(file, 'utf8').split('\n');
    const dict = new WordSetDictionary(words.filter(Boolean));
    cache.set(lang, dict);
    return dict;
  } catch (err) {
    log.error(`[wordchain] falha a ler a wordlist ${file}`, err);
    return null;
  }
}
