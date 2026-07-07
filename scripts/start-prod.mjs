// scripts/start-prod.mjs — supervisor de PRODUÇÃO do Vozen (spec T1.2).
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
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const log = (m) => console.log(`[start-prod] ${m}`);

// GUARD de instância única. Um bot do Discord só pode ter UMA ligação de voz por
// guild; correr vários processos com o MESMO token fá-los expulsar-se uns aos outros
// do canal de voz → o bot fica MUDO na call (foi exatamente o incidente das 5
// instâncias acumuladas por reinícios). Aqui prendemos uma porta de loopback: se já
// estiver ocupada, OUTRO supervisor Vozen está vivo → recusamos arrancar. O SO liberta
// a porta quando o processo morre, por isso não há lock preso (ao contrário de um
// PID-file). Porta configurável (SINGLE_INSTANCE_PORT); 0/"off" desliga o guard (para
// quem corre vários bots diferentes na mesma máquina, cada um com o seu token).
function acquireSingleInstanceLock() {
  const raw = process.env.SINGLE_INSTANCE_PORT;
  if (raw === '0' || raw === 'off') {
    log('guard de instância única DESLIGADO (SINGLE_INSTANCE_PORT=' + raw + ').');
    return Promise.resolve(null);
  }
  const port = Number(raw) || 59595;
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        log('ABORTADO: já há um Vozen a correr (porta de lock ' + port + ' ocupada).');
        log('Mata a instância existente antes de arrancar outra — vários bots com o');
        log('mesmo token lutam pela ligação de voz e o bot fica mudo. (Desliga este');
        log('guard com SINGLE_INSTANCE_PORT=off se corres bots diferentes na máquina.)');
        process.exit(1);
      }
      // Qualquer outro erro (ex.: sem permissão para o socket): não bloquear o
      // arranque por causa do guard — avisar e seguir.
      log('AVISO: guard de instância única indisponível (' + err.code + ') — sigo na mesma.');
      resolve(null);
    });
    // Só loopback: o lock é local à máquina, não expõe nada à rede.
    server.listen(port, '127.0.0.1', () => {
      log('lock de instância única adquirido (porta ' + port + ').');
      // Manter o handle vivo toda a vida do processo (não fechar): é ele que mantém
      // a porta ocupada. unref() para não impedir a saída limpa se o event-loop
      // esvaziar por outra razão.
      server.unref();
      resolve(server);
    });
  });
}

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
let currentChild = null; // handle do bot em execução (para o sinal o poder matar)
let resetTimer = null; // timer que zera o backoff após 60s saudáveis

function startOnce() {
  const child = spawn(process.execPath, [join(ROOT, 'dist', 'index.js')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  currentChild = child;

  child.on('exit', (code, signal) => {
    if (currentChild === child) currentChild = null;
    // Limpa o timer de reset DESTE arranque. Sem isto, um reset atrasado de um
    // arranque anterior zerava `attempt` a meio de um crash-loop, e a backoff
    // exponencial nunca subia — degradava para um delay quase fixo que martelava
    // o restart em vez de recuar até aos 60s.
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
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

  // Um arranque que dure >60s conta como saudável → limpa o backoff. Guardamos o
  // handle para o cancelar no exit (senão zera `attempt` fora de tempo — ver acima).
  resetTimer = setTimeout(() => {
    resetTimer = null;
    if (!stopping) attempt = 0;
  }, 60000);
}

// Encaminha o sinal para o FILHO e só sai depois de ele morrer. Sem isto, o
// supervisor saía sozinho e deixava o bot ÓRFÃO — que continuava ligado ao Discord
// com o token, libertava o lock de instância única, e um restart do init (docker
// stop / pm2 / kill do PID do supervisor) spawnava um SEGUNDO bot: exatamente o
// incidente das instâncias duplicadas. Timeout de segurança (SIGKILL) para não ficar
// preso se o filho não terminar a tempo.
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopping = true;
    const child = currentChild;
    if (!child) {
      log(`${sig} recebido — nada a parar.`);
      process.exit(0);
      return;
    }
    log(`${sig} recebido — a parar o bot e a aguardar que feche…`);
    const done = () => process.exit(0);
    child.once('exit', done);
    try {
      child.kill(sig);
    } catch {
      done();
      return;
    }
    const t = setTimeout(() => {
      log('bot não fechou em 8s — SIGKILL.');
      try {
        child.kill('SIGKILL');
      } catch {
        // já morto
      }
      done();
    }, 8000);
    t.unref?.();
  });
}

// Recusa arrancar se já houver outro Vozen vivo (evita o incidente das instâncias
// duplicadas). Corre ANTES do prewarm/arranque para falhar cedo e barato.
await acquireSingleInstanceLock();
prewarmDavey();
log('a arrancar dist/index.js (produção, com auto-restart)…');
startOnce();
