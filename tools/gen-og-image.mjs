// tools/gen-og-image.mjs
//
// Rasteriza site/assets/og-image.svg -> site/assets/og-image.png (1200x630), o
// og:image que aparece quando um link do Vozen e' partilhado no Discord/Twitter.
// SVG nao e' aceite de forma fiavel como og:image, por isso comitamos o PNG.
//
// Regenerar (o rasterizador NAO esta em package.json, e' so uma ferramenta de build):
//   npm i --no-save @resvg/resvg-js
//   node tools/gen-og-image.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = join(root, 'site', 'assets', 'og-image.svg');
const outPath = join(root, 'site', 'assets', 'og-image.png');

const svg = readFileSync(svgPath, 'utf8');
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 }, // viewBox 1200x630 -> PNG 1200x630
  background: '#05060f', // fundo solido (og:image nao suporta transparencia)
  font: { loadSystemFonts: true }, // usa fontes do sistema para o texto
});
const png = resvg.render().asPng();
writeFileSync(outPath, png);
console.log(`og-image.png escrito: ${outPath} (${png.length} bytes)`);
