/**
 * tools/premium-codes.ts — gera códigos de resgate do Vozen Premium/Plus (offline).
 *
 * Corre com tsx (dev dep): abre a MESMA BD do bot (DB_PATH ou ./tts.db), garante as
 * tabelas (initDb) e insere N códigos, imprimindo-os para colares no Ko-fi/Patreon.
 * Os utilizadores resgatam-nos com /redeem no Discord.
 *
 * Uso:
 *   npx tsx tools/premium-codes.ts <guild|user> <dias> <quantidade>
 * Exemplos:
 *   npx tsx tools/premium-codes.ts guild 30 10   # 10 códigos de 30 dias de Premium (server)
 *   npx tsx tools/premium-codes.ts user 30 5      # 5 códigos de 30 dias de Plus (user)
 */
import { randomInt } from 'node:crypto';
import { initDb } from '../src/store/db';
import { createRedeemCode, type PremiumKind } from '../src/store/premium';

// Alfabeto sem caracteres ambíguos (0/O, 1/I/L) para códigos legíveis ao telefone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function group(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Código no formato VOZEN-XXXX-XXXX-XXXX (fácil de ler/escrever). */
function makeCode(): string {
  return `VOZEN-${group(4)}-${group(4)}-${group(4)}`;
}

function main(): void {
  const [kindArg, daysArg, countArg] = process.argv.slice(2);
  const kind = kindArg as PremiumKind;
  const days = Number(daysArg);
  const count = Number(countArg);

  if ((kind !== 'guild' && kind !== 'user') || !Number.isInteger(days) || days <= 0 || !Number.isInteger(count) || count <= 0) {
    console.error('Uso: npx tsx tools/premium-codes.ts <guild|user> <dias> <quantidade>');
    process.exit(1);
  }

  const dbPath = process.env.DB_PATH || './tts.db';
  const db = initDb(dbPath);
  const now = Date.now();
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    // Retenta em caso de colisão (praticamente impossível, mas o PK garante unicidade).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      try {
        createRedeemCode(db, code, kind, days, now);
        codes.push(code);
        break;
      } catch {
        if (attempt === 4) throw new Error('não consegui gerar um código único');
      }
    }
  }
  db.close();

  console.log(`\n${count} código(s) de ${days} dias (${kind === 'guild' ? 'Premium/servidor' : 'Plus/utilizador'}) em ${dbPath}:\n`);
  for (const c of codes) console.log('  ' + c);
  console.log('');
}

main();
