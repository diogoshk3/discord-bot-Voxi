// tools/upload-chess-emojis.mjs
//
// Faz upload dos 26 PNGs do tabuleiro de xadrez (assets/chess/*.png) como APPLICATION
// EMOJIS do bot. App emojis funcionam em QUALQUER servidor sem gastar slots de guild
// nem exigir Nitro — é o que os bots de xadrez usam. IDEMPOTENTE: lista os que já
// existem e cria só os que faltam. Corre uma vez (ou quando trocares os assets):
//   node tools/upload-chess-emojis.mjs
//
// Precisa de DISCORD_TOKEN + CLIENT_ID no ambiente (o mesmo .env do bot).

import { REST, Routes } from 'discord.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../dist/config/index.js';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'chess');

async function main() {
  const cfg = loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.token);

  // App emojis já existentes (o GET devolve { items: [...] }).
  const existing = await rest.get(Routes.applicationEmojis(cfg.clientId));
  const have = new Map((existing.items ?? []).map((e) => [e.name, e.id]));

  const files = readdirSync(ASSETS).filter((f) => f.endsWith('.png'));
  let created = 0;
  let skipped = 0;
  for (const file of files) {
    const name = basename(file, '.png');
    if (have.has(name)) {
      skipped++;
      continue;
    }
    const b64 = readFileSync(join(ASSETS, file)).toString('base64');
    const res = await rest.post(Routes.applicationEmojis(cfg.clientId), {
      body: { name, image: `data:image/png;base64,${b64}` },
    });
    have.set(name, res.id);
    created++;
    console.log(`+ ${name} -> ${res.id}`);
  }

  console.log(`\nfeito: ${created} criados, ${skipped} já existiam, ${have.size} no total.`);
  // Imprime o mapa nome->id (útil para verificação; o bot lê isto em runtime na mesma).
  const map = Object.fromEntries([...have.entries()].sort());
  console.log('mapa nome->id:', JSON.stringify(map));
}

main().catch((err) => {
  console.error('[upload-chess-emojis] falhou:', err);
  process.exit(1);
});
