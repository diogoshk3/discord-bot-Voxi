// src/tts/piper.ts
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, statSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SynthRequest, TTSEngine } from './engine';
import { AudioCache, cacheKey } from './cache';
import { concatWavs, silenceWav } from './wavConcat';
import {
  lengthScaleFor,
  synthParamsFor,
  PIPER_DEFAULT_SYNTH_PARAMS,
  type SynthParams,
} from './calibration';

const PIPER_TIMEOUT_MS = 15000;

/**
 * Valida que `model` e um nome de modelo seguro para compor o caminho do .onnx.
 * Rejeita separadores de caminho (`/` ou `\`), componentes `.`/`..` e strings
 * vazias — cross-platform (nao depende de path.basename, que trata `\` como
 * caractere normal em POSIX). Nomes reais (ex. `en_US-amy-medium`,
 * `pt_PT-tugao-medium`) passam. Defense-in-depth no boundary do Piper: impede
 * que um nome nao-validado leia um .onnx fora do modelsDir.
 */
export function isSafeModelName(model: string): boolean {
  if (typeof model !== 'string' || model.length === 0) return false;
  if (model.includes('/') || model.includes('\\')) return false;
  if (model === '.' || model === '..') return false;
  return true;
}

export class PiperEngine implements TTSEngine {
  private readonly piperPath: string;
  private readonly modelsDir: string;
  private readonly cache: AudioCache;
  // Defaults GLOBAIS de qualidade (noise_scale/noise_w/sentence_silence). Param
  // opcional: ausente => defaults do proprio Piper => output inalterado. A config
  // (factory) injeta aqui os valores globais vindos das envs NOISE_*.
  private readonly synthDefaults: SynthParams;

  constructor(
    piperPath: string,
    modelsDir: string,
    cache: AudioCache,
    synthDefaults: SynthParams = PIPER_DEFAULT_SYNTH_PARAMS,
  ) {
    this.piperPath = piperPath;
    this.modelsDir = modelsDir;
    this.cache = cache;
    this.synthDefaults = synthDefaults;
  }

  async synth(req: SynthRequest): Promise<string> {
    if (!isSafeModelName(req.model)) {
      throw new Error(`Nome de modelo invalido: ${req.model}`);
    }

    const key = cacheKey(req);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const modelPath = join(this.modelsDir, `${req.model}.onnx`);
    if (!existsSync(modelPath)) {
      throw new Error(`Modelo Piper nao encontrado: ${modelPath}`);
    }

    const lengthScale = lengthScaleFor(req.model, req.speed);
    // Params de qualidade: defaults globais + override por-voz (VAZIO hoje). O
    // length_scale NAO passa por aqui — continua a vir so de lengthScaleFor.
    const params = synthParamsFor(req.model, this.synthDefaults);

    const workDir = mkdtempSync(join(tmpdir(), 'piper-'));
    const outPath = join(workDir, 'out.wav');

    try {
      await this.runPiper(modelPath, outPath, lengthScale, params, req.text);

      if (!existsSync(outPath) || statSync(outPath).size === 0) {
        throw new Error('Piper nao gerou WAV (ficheiro vazio ou inexistente)');
      }

      // Pausa opcional: PREPENDER `leadSilenceMs` de silencio ao WAV base. Escreve
      // o ficheiro com silencio DENTRO do workDir (o `finally` limpa; cache.put
      // copia antes disso). A chave da cache ja inclui leadSilenceMs (ver cacheKey),
      // por isso a versao com/sem silencio nao colidem.
      if (req.leadSilenceMs && req.leadSilenceMs > 0) {
        const withSilence = concatWavs([silenceWav(req.leadSilenceMs), readFileSync(outPath)], {
          silenceMs: 0,
        });
        const silPath = join(workDir, 'out-silence.wav');
        writeFileSync(silPath, withSilence);
        return this.cache.put(key, silPath);
      }

      return this.cache.put(key, outPath);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  private runPiper(
    modelPath: string,
    outPath: string,
    lengthScale: number,
    params: SynthParams,
    text: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Flags de qualidade em underscore, a espelhar o estilo de --length_scale.
      // Todos os valores sao NUMEROS de config/calibracao (nunca strings de
      // utilizador) — formatados com String(); nada nao-confiavel entra nos args.
      const args = [
        '--model',
        modelPath,
        '--output_file',
        outPath,
        '--length_scale',
        String(lengthScale),
        '--noise_scale',
        String(params.noiseScale),
        '--noise_w',
        String(params.noiseW),
        '--sentence_silence',
        String(params.sentenceSilence),
      ];

      const child = spawn(this.piperPath, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
      });

      let settled = false;
      let stderr = '';

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Piper timeout (${PIPER_TIMEOUT_MS}ms)`));
      }, PIPER_TIMEOUT_MS);

      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Falha ao iniciar Piper: ${err.message}`));
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Piper saiu com codigo ${code}: ${stderr.trim()}`));
        }
      });

      // Se o Piper morre instantaneamente, escrever no stdin emite 'error' (EPIPE).
      // Sem listener, isso seria uma excecao nao tratada que crasha o processo.
      // O 'close'/'error' do child ja resolvem/rejeitam a sintese; aqui apenas
      // engolimos o erro do pipe (e rejeitamos defensivamente se ainda nao settled
      // e nao for EPIPE — EPIPE significa que o child ja fechou e o 'close' trata).
      child.stdin?.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return;
        if (err.code === 'EPIPE') return; // child morreu -> 'close' vai tratar
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Falha ao escrever no stdin do Piper: ${err.message}`));
      });

      // Texto a sintetizar vai pelo stdin (uma linha).
      try {
        child.stdin?.write(text.endsWith('\n') ? text : `${text}\n`);
        child.stdin?.end();
      } catch (err) {
        // write/end sincronos podem lancar se o stream ja estiver destruido.
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Falha ao escrever no stdin do Piper: ${(err as Error).message}`));
        }
      }
    });
  }
}
