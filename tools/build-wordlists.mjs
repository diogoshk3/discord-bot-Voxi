// tools/build-wordlists.mjs
//
// Gera as wordlists do minijogo "cadeia de palavras" (word-chain) a partir das
// listas de frequência do hermitdave/FrequencyWords (OpenSubtitles, CC-BY-SA-4.0).
// Uma língua por ficheiro: assets/wordlists/{lang}.txt (uma palavra por linha, já
// NORMALIZADA, só a-z, >=3 letras, sem duplicados, ordenada, sem profanidade óbvia).
//
// O runtime só carrega o Set — zero processamento no arranque. NÃO está no
// package.json (ferramenta de build); corre à mão quando se quer regenerar:
//   node tools/build-wordlists.mjs
//
// Atribuição (CC-BY-SA-4.0): dados derivados de hermitdave/FrequencyWords.
// Ver assets/wordlists/NOTICE.txt.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'assets', 'wordlists');
const CACHE = join(root, 'scratchpad', 'dict-spike'); // reutiliza o download do spike se existir

const LANGS = ['pt', 'en', 'es', 'fr'];

// IMPORTANTE: esta normalização TEM de ser byte-a-byte igual à normalize() de
// src/games/wordchain/core.ts — senão o runtime normaliza o input do utilizador de
// forma diferente da lista e palavras válidas são rejeitadas. Há um teste em core que
// fixa os outputs canónicos (Cães->caes, éléphant->elephant).
const RE_PLAYABLE = /^[a-z]+$/;
function normalize(w) {
  return w
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos combinados
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/đ/g, 'd')
    .replace(/ł/g, 'l')
    .toLowerCase();
}

// Profanidade/insultos a NUNCA aceitar (o bot lê as palavras em voz alta, por isso
// uma "palavra válida" ofensiva sairia pelos altifalantes). Lista compacta e
// deliberadamente conservadora — foco em insultos e asneira forte. Extensível.
const PROFANITY = {
  pt: ['caralho', 'foda', 'foder', 'fodido', 'fodida', 'puta', 'putas', 'puto', 'cona', 'cabrao', 'cabroes', 'merda', 'merdas', 'piroca', 'crlh', 'fdp', 'paneleiro', 'preto', 'pretos', 'corno', 'cornos', 'buceta', 'xoxota', 'caralhos', 'putaria'],
  en: ['fuck', 'fucks', 'fucked', 'fucking', 'fucker', 'shit', 'shits', 'shitty', 'bitch', 'bitches', 'cunt', 'cunts', 'nigger', 'niggers', 'nigga', 'faggot', 'faggots', 'whore', 'whores', 'slut', 'sluts', 'dick', 'dicks', 'cock', 'cocks', 'pussy', 'pussies', 'bastard', 'retard', 'retards'],
  es: ['joder', 'jode', 'jodido', 'jodida', 'puta', 'putas', 'puto', 'putos', 'mierda', 'mierdas', 'coño', 'conos', 'cono', 'polla', 'pollas', 'cabron', 'cabrones', 'gilipollas', 'zorra', 'zorras', 'maricon', 'maricones', 'pendejo', 'pendejos', 'verga', 'chinga', 'chingar'],
  fr: ['merde', 'merdes', 'putain', 'putains', 'pute', 'putes', 'salope', 'salopes', 'connard', 'connards', 'connasse', 'enculer', 'encule', 'encules', 'bite', 'bites', 'chatte', 'chattes', 'couille', 'couilles', 'salaud', 'salauds', 'pd', 'nique', 'niquer', 'batard', 'batards'],
};

function loadRaw(lang) {
  const cached = join(CACHE, `${lang}_50k.txt`);
  if (existsSync(cached)) {
    console.log(`  ${lang}: cache local (${cached})`);
    return readFileSync(cached, 'utf8');
  }
  throw new Error(
    `Falta ${cached}. Descarrega primeiro:\n` +
      `  curl -s https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/${lang}/${lang}_50k.txt -o ${cached}`,
  );
}

// As listas de legendas contaminam-se entre línguas (aparece "fuck" na lista PT,
// "mierda" na lista FR, etc.). Por isso banimos a UNIÃO de toda a profanidade de
// todas as línguas em TODAS as listas, não só a da própria língua.
const BANNED_ALL = new Set(Object.values(PROFANITY).flat());

mkdirSync(OUT, { recursive: true });
for (const lang of LANGS) {
  const raw = loadRaw(lang);
  const banned = BANNED_ALL;
  const seen = new Set();
  for (const line of raw.split('\n')) {
    const word = line.split(' ')[0];
    if (!word) continue;
    const n = normalize(word);
    if (!RE_PLAYABLE.test(n) || n.length < 3) continue;
    if (banned.has(n)) continue;
    seen.add(n);
  }
  const sorted = [...seen].sort();
  writeFileSync(join(OUT, `${lang}.txt`), sorted.join('\n') + '\n', 'utf8');
  console.log(`  ${lang}: ${sorted.length} palavras -> assets/wordlists/${lang}.txt`);
}
console.log('feito.');
