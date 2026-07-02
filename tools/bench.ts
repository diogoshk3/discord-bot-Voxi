/**
 * tools/bench.ts — Régua de performance do Voxi (spec Fase 0 / T0.1).
 *
 * Corre com:  npx tsx tools/bench.ts
 *
 * Mede, com o Piper REAL (usa PIPER_PATH/MODELS_DIR do .env):
 *  - latência de síntese FRIO (cache miss) por tamanho de texto (curto/médio/longo);
 *  - latência QUENTE (cache hit);
 *  - overhead aproximado do spawn (síntese de texto mínimo);
 *  - hit-rate da cache num replay sintético;
 *  - RAM (rss) e o cap de concorrência resolvido.
 * Escreve/atualiza BENCHMARKS.md com a baseline. PURO em relação ao bot (não liga ao
 * Discord; usa uma cache temporária isolada). NÃO faz parte do build de produção.
 *
 * NOTA (motiva o T2.2): hoje NÃO há streaming — o áudio só toca quando o WAV inteiro
 * está pronto, por isso "tempo até à 1.ª palavra" == tempo total de síntese medido aqui.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { loadConfig } from '../src/config/index';
import { AudioCache } from '../src/tts/cache';
import { PiperEngine, resolvePiperConcurrency } from '../src/tts/piper';
import type { SynthRequest } from '../src/tts/engine';

function discoverModels(modelsDir: string): string[] {
  if (!existsSync(modelsDir)) return [];
  return readdirSync(modelsDir)
    .filter((f) => f.endsWith('.onnx'))
    .map((f) => basename(f, '.onnx'))
    .sort();
}

function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return NaN;
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx];
}

function stats(ms: number[]): { p50: number; p95: number; min: number; max: number } {
  const s = [...ms].sort((a, b) => a - b);
  return { p50: percentile(s, 50), p95: percentile(s, 95), min: s[0], max: s[s.length - 1] };
}

const WORD = 'a nossa cidade tem um tempo muito agradavel durante toda a semana inteira ';
function words(n: number): string {
  const base = WORD.trim().split(' ');
  const out: string[] = [];
  while (out.length < n) out.push(base[out.length % base.length]);
  return out.join(' ');
}

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const t0 = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - t0) / 1e6; // ms
}

async function main(): Promise<void> {
  const config = loadConfig();
  const models = discoverModels(config.modelsDir);
  const cap = resolvePiperConcurrency();

  const lines: string[] = [];
  const log = (s = '') => {
    lines.push(s);
    console.log(s);
  };

  log('# BENCHMARKS — Voxi (baseline)');
  log('');
  log('Gerado por `npx tsx tools/bench.ts`. Piper real; cache temporária isolada.');
  log('Hoje NÃO há streaming: tempo-até-1.ª-palavra == tempo total de síntese abaixo.');
  log('');
  log(`- Piper: \`${config.piperPath}\``);
  log(`- Modelos: ${models.length} em \`${config.modelsDir}\``);
  log(`- Cap de concorrência (PIPER_MAX_CONCURRENCY / max(1,núcleos-1)): **${cap}**`);
  log('');

  if (!existsSync(config.piperPath) && !config.piperPath.includes('/')) {
    // piperPath pode ser um comando no PATH; testamos com --help.
    const probe = spawnSync(config.piperPath, ['--help'], { timeout: 5000 });
    if (probe.error) {
      log('> ⚠️ Piper não encontrado/executável — bench abortado (secções de síntese vazias).');
      writeFileSync(join(process.cwd(), 'BENCHMARKS.md'), lines.join('\n'));
      return;
    }
  }
  if (models.length === 0) {
    log('> ⚠️ Nenhum modelo .onnx — bench abortado.');
    writeFileSync(join(process.cwd(), 'BENCHMARKS.md'), lines.join('\n'));
    return;
  }

  const pickModel = (...prefs: string[]): string =>
    prefs.find((p) => models.includes(p)) ?? models[0];
  const voicePt = pickModel('pt_PT-tugao-medium', 'pt_PT-tugão-medium', 'pt_BR-faber-medium');
  const voiceEn = pickModel('en_US-amy-medium', 'en_GB-alan-medium');
  log(`- Voz PT: \`${voicePt}\` · Voz EN: \`${voiceEn}\``);
  log('');

  const cacheDir = mkdtempSync(join(tmpdir(), 'voxi-bench-'));
  const engine = new PiperEngine(config.piperPath, config.modelsDir, new AudioCache(cacheDir, 0), {
    noiseScale: config.noiseScale,
    noiseW: config.noiseW,
    sentenceSilence: config.sentenceSilence,
  });

  try {
    const rssBefore = process.memoryUsage().rss;

    // ── Latência FRIO por tamanho (cache miss garantido: texto único por corrida) ──
    const sizes: Array<{ name: string; n: number; runs: number }> = [
      { name: 'curto (~6 palavras)', n: 6, runs: 8 },
      { name: 'médio (~30 palavras)', n: 30, runs: 8 },
      { name: 'longo (~90 palavras)', n: 90, runs: 5 },
    ];

    log('## Latência de síntese FRIO (cache miss)');
    log('');
    log('| Tamanho | Voz | corridas | p50 (ms) | p95 (ms) | min | max |');
    log('|---|---|---:|---:|---:|---:|---:|');

    const warmSamples: Array<{ label: string; req: SynthRequest }> = [];

    for (const size of sizes) {
      for (const [vlabel, model] of [
        ['PT', voicePt],
        ['EN', voiceEn],
      ] as const) {
        const durs: number[] = [];
        let firstReq: SynthRequest | null = null;
        for (let i = 0; i < size.runs; i++) {
          const req: SynthRequest = { text: `${i} ${words(size.n)}`, model, speed: 1 };
          if (!firstReq) firstReq = req;
          durs.push(await timed(() => engine.synth(req)));
        }
        const s = stats(durs);
        log(
          `| ${size.name} | ${vlabel} | ${size.runs} | ${s.p50.toFixed(0)} | ${s.p95.toFixed(0)} | ${s.min.toFixed(0)} | ${s.max.toFixed(0)} |`,
        );
        if (firstReq) warmSamples.push({ label: `${size.name} ${vlabel}`, req: firstReq });
      }
    }
    log('');

    // ── Latência QUENTE (cache hit): re-sintetiza os mesmos pedidos já em cache ──
    log('## Latência QUENTE (cache hit)');
    log('');
    log('| Amostra | ms |');
    log('|---|---:|');
    for (const { label, req } of warmSamples) {
      const ms = await timed(() => engine.synth(req));
      log(`| ${label} | ${ms.toFixed(2)} |`);
    }
    log('');

    // ── Overhead aproximado do spawn: síntese de 1 palavra, cache miss × N ──
    log('## Overhead do spawn (síntese de 1 palavra)');
    log('');
    const spawnDurs: number[] = [];
    for (let i = 0; i < 10; i++) {
      spawnDurs.push(await timed(() => engine.synth({ text: `${i} ola`, model: voiceEn, speed: 1 })));
    }
    const ss = stats(spawnDurs);
    log(`- p50 **${ss.p50.toFixed(0)} ms**, p95 ${ss.p95.toFixed(0)} ms (piso ≈ spawn + síntese mínima).`);
    log('');

    // ── Hit-rate da cache num replay sintético (chat: mistura de repetições) ──
    log('## Hit-rate da cache (replay sintético)');
    log('');
    const phrases = ['bom dia', 'ola pessoal', 'tudo bem', 'ok', 'obrigado'];
    // 30 mensagens: 60% repetições das frases acima, 40% únicas.
    let hits = 0;
    let total = 0;
    for (let i = 0; i < 30; i++) {
      const unique = i % 5 === 0;
      const text = unique ? `mensagem unica numero ${i}` : phrases[i % phrases.length];
      const req: SynthRequest = { text, model: voiceEn, speed: 1 };
      const key = (await import('../src/tts/cache')).cacheKey(req);
      const wasCached = new AudioCache(cacheDir, 0).get(key) !== null;
      if (wasCached) hits++;
      total++;
      await engine.synth(req);
    }
    log(`- ${hits}/${total} hits = **${((hits / total) * 100).toFixed(0)}%** neste replay (repetições típicas de chat).`);
    log('> Se baixo em produção real (mensagens quase sempre únicas), a cache dá pouco — T2.3 decide com números.');
    log('');

    const rssAfter = process.memoryUsage().rss;
    log('## Recursos');
    log('');
    log(`- RSS antes: ${(rssBefore / 1024 / 1024).toFixed(0)} MB · depois: ${(rssAfter / 1024 / 1024).toFixed(0)} MB`);
    log('');
    log('---');
    log('_Baseline ANTES das otimizações da Fase 2 (pool/streaming). Re-correr no fecho (T5.1) para a tabela ANTES/DEPOIS._');

    writeFileSync(join(process.cwd(), 'BENCHMARKS.md'), lines.join('\n') + '\n');
    console.log(`\n✅ BENCHMARKS.md escrito (${models.length} modelos, cap ${cap}).`);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('bench falhou:', err);
  process.exit(1);
});
