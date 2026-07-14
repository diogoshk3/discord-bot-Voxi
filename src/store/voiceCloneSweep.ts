// src/store/voiceCloneSweep.ts
//
// DATA-06: sweep de reconciliação para .wav ÓRFÃOS em voice-clones/. `eraseUser`
// (dataLifecycle.ts) e `/voice clone delete` (voice.ts) apagam a linha `user_clone` e SÓ
// DEPOIS tentam apagar o ficheiro do disco, em best-effort (`.catch(()=>{})`/try-catch
// engolido). Se o processo morrer entre as duas operações, ou o `unlink` rebentar (ex.:
// ficheiro bloqueado no Windows), a amostra biométrica fica ÓRFÃ — sem NENHUMA linha na
// BD a referi-la — e nenhum `/privacy erase` futuro a encontra.
//
// Este módulo corre no ClientReady (ver index.ts): lista voice-clones/*.wav e apaga os
// que NÃO têm nenhum `sample_path` vivo em `user_clone` a apontar para eles.
//
// MED-risco (plano 032, STOP condition): o match é feito contra os VALORES REAIS de
// `sample_path` — NUNCA por heurística de nome de ficheiro. Um match errado apagaria uma
// amostra biométrica ainda em uso. Por isso `findOrphanSamplePaths` é uma função PURA e
// testável em isolamento (sem tocar no disco/BD), e é chamada só depois de normalizar AMBOS
// os lados (ver `normalizePath`).

import { readdirSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

/**
 * Normaliza um caminho para comparação: resolve (absolutiza contra o cwd atual, resolve
 * `..`/`.`) e, no Windows (sistema de ficheiros case-insensitive), baixa a caixa — para uma
 * diferença de maiúsculas/minúsculas nunca ser lida como "ficheiros diferentes" e gerar um
 * falso órfão. O processo que ESCREVE (voice.ts) e o que VARRE (este módulo) correm sempre
 * no MESMO SO, por isso esta normalização é suficiente (não há caminhos cross-OS a casar).
 */
function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Lógica PURA do diff (testável sem fs/BD): dados os caminhos ABSOLUTOS dos .wav
 * encontrados no disco e os `sample_path` REAIS e atuais da tabela `user_clone`, devolve
 * os caminhos ÓRFÃOS — os que não têm NENHUMA linha viva a apontar para eles, depois de
 * normalizar os dois lados. Nunca compara por nome de ficheiro/heurística.
 */
export function findOrphanSamplePaths(filesOnDisk: string[], livePaths: string[]): string[] {
  const live = new Set(livePaths.map(normalizePath));
  return filesOnDisk.filter((f) => !live.has(normalizePath(f)));
}

export interface SweepResult {
  /** Nº de ficheiros .wav encontrados em voice-clones/. */
  scanned: number;
  /** Caminhos dos órfãos efetivamente apagados. */
  removed: string[];
  /** Órfãos identificados mas cujo unlink falhou (ex.: ficheiro bloqueado) — best-effort. */
  failed: { path: string; error: unknown }[];
}

/**
 * Varre `voiceClonesDir`, casa cada `.wav` contra os `sample_path` reais em `user_clone` e
 * apaga do disco os que ficaram sem correspondência. A leitura da BD NÃO é protegida por
 * try/catch aqui de propósito: uma falha na query (ex.: BD bloqueada) tem de abortar o
 * sweep inteiro (propaga para o chamador) — nunca cair silenciosamente para "sem linhas
 * vivas", o que apagaria TODAS as amostras. O chamador (ClientReady) é que decide o
 * best-effort do arranque. Diretório inexistente => no-op (bot ainda sem nenhuma gravação).
 */
export function sweepOrphanClones(db: Database.Database, voiceClonesDir: string): SweepResult {
  if (!existsSync(voiceClonesDir)) return { scanned: 0, removed: [], failed: [] };

  const filesOnDisk = readdirSync(voiceClonesDir)
    .filter((f) => f.toLowerCase().endsWith('.wav'))
    .map((f) => path.join(voiceClonesDir, f));

  const livePaths = (
    db.prepare('SELECT sample_path FROM user_clone').all() as { sample_path: string }[]
  ).map((r) => r.sample_path);

  const orphans = findOrphanSamplePaths(filesOnDisk, livePaths);

  const removed: string[] = [];
  const failed: { path: string; error: unknown }[] = [];
  for (const f of orphans) {
    try {
      unlinkSync(f);
      removed.push(f);
    } catch (err) {
      // best-effort por ficheiro: um falhar (lock) não deve travar os restantes.
      failed.push({ path: f, error: err });
    }
  }

  return { scanned: filesOnDisk.length, removed, failed };
}
