/**
 * tools/loadbench.ts — bench de CARGA + soak (spec T4.1/T4.2).
 *
 * Corre com:  npx tsx tools/loadbench.ts   (usa o Piper real; pool persistente ON)
 *
 * T4.1 — carga: N sínteses CONCORRENTES (5/10/20) através de 2 vozes; mede wall-time,
 *   sucesso e throughput. Valida o cap global (T1.3) + o pool persistente (T2.1).
 * T4.2 — soak: uma rajada grande de sínteses; confirma RAM estável e que o nº de
 *   processos piper.exe vivos fica ≤ PIPER_WARM_VOICES (sem fuga de processos).
 * Escreve um resumo em BENCHMARKS-load.md. Não faz parte do build de produção.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { loadConfig } from '../src/config/index';
import { AudioCache } from '../src/tts/cache';
import { PiperEngine, resolvePiperConcurrency, shutdownPiperPool } from '../src/tts/piper';
import type { SynthRequest } from '../src/tts/engine';

function discoverModels(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.onnx')).map((f) => basename(f, '.onnx')).sort();
}
function countPiperProcs(): number {
  // Windows: tasklist. Conta instâncias vivas de piper.exe.
  try {
    const out = spawnSync('tasklist', ['/FI', 'IMAGENAME eq piper.exe', '/NH'], {
      encoding: 'utf8',
      timeout: 5000,
    }).stdout || '';
    return (out.match(/piper\.exe/gi) || []).length;
  } catch {
    return -1; // desconhecido (não-Windows)
  }
}
const wordsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ['a', 'nossa', 'cidade', 'tem', 'tempo', 'agradavel'][i % 6]).join(' ');

async function main(): Promise<void> {
  const config = loadConfig();
  const models = discoverModels(config.modelsDir);
  const lines: string[] = [];
  const log = (s = '') => { lines.push(s); console.log(s); };

  log('# BENCHMARKS — carga + soak (T4.1/T4.2)');
  log('');
  log(`- Cap concorrência: **${resolvePiperConcurrency()}** · WARM_VOICES: ${process.env.PIPER_WARM_VOICES ?? '3 (default)'} · persistente: ${process.env.PIPER_PERSISTENT === '0' ? 'OFF' : 'ON'}`);
  log('');
  if (models.length === 0) { log('> ⚠️ Sem modelos — abortado.'); writeFileSync('BENCHMARKS-load.md', lines.join('\n')); return; }

  const pick = (...p: string[]) => p.find((x) => models.includes(x)) ?? models[0];
  const voices = [pick('en_US-amy-medium'), pick('pt_PT-tugao-medium', 'pt_PT-tugão-medium')];
  const cacheDir = mkdtempSync(join(tmpdir(), 'voxi-load-'));
  const engine = new PiperEngine(config.piperPath, config.modelsDir, new AudioCache(cacheDir, 0), {
    noiseScale: config.noiseScale, noiseW: config.noiseW, sentenceSilence: config.sentenceSilence,
  });

  let counter = 0;
  const oneSynth = (): Promise<string> => {
    const i = counter++;
    const req: SynthRequest = { text: `carga ${i} ${wordsOf(8)}`, model: voices[i % 2], speed: 1 };
    return engine.synth(req);
  };

  try {
    // ── T4.1 carga: N concorrentes ──────────────────────────────────────────
    log('## T4.1 — carga concorrente');
    log('');
    log('| N concorrentes | wall-time (ms) | ok/N | throughput (síntese/s) |');
    log('|---:|---:|---:|---:|');
    for (const N of [5, 10, 20]) {
      const t0 = process.hrtime.bigint();
      const res = await Promise.allSettled(Array.from({ length: N }, () => oneSynth()));
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const ok = res.filter((r) => r.status === 'fulfilled').length;
      log(`| ${N} | ${ms.toFixed(0)} | ${ok}/${N} | ${(N / (ms / 1000)).toFixed(1)} |`);
    }
    log('');

    // ── T4.2 soak: rajada grande + RAM + processos vivos ────────────────────
    log('## T4.2 — soak (leak-check)');
    log('');
    const SOAK = 200;
    const BATCH = 10;
    const rssBefore = process.memoryUsage().rss;
    let soakOk = 0;
    for (let done = 0; done < SOAK; done += BATCH) {
      const res = await Promise.allSettled(Array.from({ length: BATCH }, () => oneSynth()));
      soakOk += res.filter((r) => r.status === 'fulfilled').length;
    }
    const rssAfter = process.memoryUsage().rss;
    const livePiper = countPiperProcs();
    const warm = process.env.PIPER_WARM_VOICES ? Number(process.env.PIPER_WARM_VOICES) : 3;
    log(`- ${soakOk}/${SOAK} sínteses ok.`);
    log(`- RSS: ${(rssBefore / 2 ** 20).toFixed(0)}MB → ${(rssAfter / 2 ** 20).toFixed(0)}MB (Δ ${((rssAfter - rssBefore) / 2 ** 20).toFixed(1)}MB).`);
    log(`- piper.exe vivos no fim: **${livePiper}** (esperado ≤ WARM_VOICES=${warm}; -1 = não-Windows).`);
    const leak = livePiper > warm + 1;
    log(`- Fuga de processos: ${leak ? '⚠️ POSSÍVEL' : '✅ não'} .`);
    log('');
    log('---');
    log('_Após shutdownPiperPool() os processos quentes são fechados (o supervisor de produção fá-lo no shutdown central)._');

    writeFileSync(join(process.cwd(), 'BENCHMARKS-load.md'), lines.join('\n') + '\n');
    console.log('\n✅ BENCHMARKS-load.md escrito.');
  } finally {
    shutdownPiperPool();
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error('loadbench falhou:', e); shutdownPiperPool(); process.exit(1); });
