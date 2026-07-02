// scripts/start-prod.mjs — supervisor de PRODUÇÃO do Voxi (spec T1.2).
//
// Corre com:  npm run start:prod   (faz build primeiro; ver package.json)
//
// Faz três coisas que o `tsx watch` (dev) não faz e que morderam em produção:
//   1. PRÉ-AQUECE o módulo nativo de voz (@snazzah/davey). No Windows, o Smart App
//      Control pode BLOQUEAR o binário no 1.º load (reputação cloud ainda pendente);
//      tentamos até 5×, o que resolve o bloqueio transitório antes de arrancar o bot.
//   2. Arranca `node dist/index.js` (build de produção — sem watch, sem recarregar
//      em edições, sem crashar em estados intermédios).
//   3. AUTO-RESTART: se o bot morrer por crash (código != 0), reinicia com backoff
//      exponencial (2s→4s→…→60s). Saída limpa (código 0) ou Ctrl-C → pára de vez.
//
// Puro Node ESM; NÃO faz parte do build TypeScript.

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const log = (m) => console.log(`[start-prod] ${m}`);

/** Pré-aquece o davey até carregar OK (anti-Smart App Control). */
function prewarmDavey() {
  for (let i = 1; i <= 5; i++) {
    const r = spawnSync(process.execPath, ['-e', "require('@snazzah/davey')"], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    if (r.status === 0) {
      log(`voz (davey) pronta (tentativa ${i}).`);
      return true;
    }
    log(`davey bloqueado/indisponível (tentativa ${i}/5) — a repetir…`);
  }
  log('AVISO: davey não carregou em 5 tentativas. Pode ser bloqueio persistente do');
  log('Smart App Control. Arranco na mesma; se o bot crashar no arranque com');
  log('ERR_DLOPEN_FAILED, vê docs/HOSPEDAR.md (secção Smart App Control).');
  return false;
}

let stopping = false;
let attempt = 0;

function startOnce() {
  const child = spawn(process.execPath, [join(ROOT, 'dist', 'index.js')], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (stopping) return;
    if (code === 0) {
      log('bot terminou de forma limpa (código 0) — não reinicio.');
      return;
    }
    // Backoff exponencial limitado a 60s.
    const delayMs = Math.min(60000, 2000 * 2 ** attempt);
    attempt++;
    log(`bot caiu (código ${code ?? 'null'}, sinal ${signal ?? 'null'}) — reinício #${attempt} em ${delayMs / 1000}s.`);
    setTimeout(startOnce, delayMs);
  });

  // Um arranque que dure >60s conta como saudável → limpa o backoff.
  setTimeout(() => {
    if (!stopping) attempt = 0;
  }, 60000);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    log(`${sig} recebido — a parar.`);
    process.exit(0);
  });
}

prewarmDavey();
log('a arrancar dist/index.js (produção, com auto-restart)…');
startOnce();
