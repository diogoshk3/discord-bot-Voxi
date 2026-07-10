// tools/build-i18n.mjs — gera site/js/i18n.js a partir de tools/i18n-src/<lang>.json.
//
// Cada <lang>.json tem { ui:{chave:texto}, commands:{cat:[[id,desc],...]}, faq:[[Q,A],...] }.
// O EN é o CANÓNICO (define as chaves/ids/ordem); as outras línguas têm de bater certo.
// Saída: window.VOZEN_I18N / VOZEN_COMMANDS / VOZEN_FAQ (formato que o main-v*.js lê).
//
// Correr: node tools/build-i18n.mjs   (depois npm run build:site minifica.)

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'tools', 'i18n-src');
// Ordem = ordem no seletor do site.
const LANGS = ['en', 'pt', 'fr', 'es', 'de', 'tr', 'ar', 'zh', 'ru', 'ko'];

const data = {};
for (const l of LANGS) data[l] = JSON.parse(readFileSync(join(SRC, `${l}.json`), 'utf8'));

const en = data.en;
const uiKeys = Object.keys(en.ui);
const cats = Object.keys(en.commands);

// Validação: cada língua tem de ter as MESMAS chaves ui, ids de comando e nº de FAQ.
for (const l of LANGS) {
  const d = data[l];
  const missing = uiKeys.filter((k) => d.ui[k] == null);
  if (missing.length) throw new Error(`${l}: faltam chaves ui: ${missing.slice(0, 5).join(', ')}`);
  for (const c of cats) {
    if ((d.commands[c] || []).length !== en.commands[c].length)
      throw new Error(`${l}: comandos '${c}' com contagem diferente`);
  }
  if (d.faq.length !== en.faq.length) throw new Error(`${l}: nº de FAQ diferente`);
}

// VOZEN_I18N = { lang: ui }
const I18N = {};
for (const l of LANGS) I18N[l] = data[l].ui;

// VOZEN_COMMANDS = { cat: [[id, {lang:desc}], ...] } — ids/ordem do EN.
const COMMANDS = {};
for (const c of cats) {
  COMMANDS[c] = en.commands[c].map(([id], i) => {
    const descs = {};
    for (const l of LANGS) descs[l] = data[l].commands[c][i][1];
    return [id, descs];
  });
}

// VOZEN_FAQ = [[{lang:Q}, {lang:A}], ...] — ordem do EN.
const FAQ = en.faq.map((_, i) => {
  const q = {};
  const a = {};
  for (const l of LANGS) {
    q[l] = data[l].faq[i][0];
    a[l] = data[l].faq[i][1];
  }
  return [q, a];
});

const out =
  `/* Vozen site — i18n dictionary. GERADO por tools/build-i18n.mjs a partir de\n` +
  `   tools/i18n-src/<lang>.json. NÃO editar à mão — editar os JSON e regenerar.\n` +
  `   Línguas: ${LANGS.join(', ')}. */\n` +
  `window.VOZEN_I18N = ${JSON.stringify(I18N)};\n` +
  `window.VOZEN_COMMANDS = ${JSON.stringify(COMMANDS)};\n` +
  `window.VOZEN_FAQ = ${JSON.stringify(FAQ)};\n`;

writeFileSync(join(ROOT, 'site', 'js', 'i18n-v15.js'), out);
console.log(
  `[build-i18n] ${LANGS.length} línguas · ${uiKeys.length} chaves ui · ${FAQ.length} FAQ -> site/js/i18n-v15.js`,
);
