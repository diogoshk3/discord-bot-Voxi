import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import type { SynthRequest, TTSEngine } from './engine';
import { AudioCache, cacheKey } from './cache';
import { rmDirSafe } from './cleanupDir';
import { log } from '../logging/logger';

// Efeitos de voz (feature premium, com 2 amostras grátis): transformam o WAV já
// sintetizado com um filtro ffmpeg, DEPOIS de toda a cadeia (cache incluída). Aplicados
// por um EffectEngine que envolve o motor por FORA — com a sua PRÓPRIA cache (o áudio com
// efeito nunca colide com o limpo). QUALQUER falha do ffmpeg cai na voz limpa, nunca em
// silêncio (crítico: uma síntese que lança faz o player SALTAR o item).

export type VoiceEffect =
  | 'none'
  | 'robot'
  | 'echo'
  | 'deep'
  | 'chipmunk'
  | 'radio'
  | 'phone'
  | 'underwater'
  | 'demon';

// Ambos os motores (Piper nativo, gTTS via mp3ToWav) produzem WAV 22050Hz mono, por isso
// os filtros de pitch (asetrate) usam 22050 com segurança. Só filtros CORE do ffmpeg
// (aecho/asetrate/aresample/atempo/highpass/lowpass/tremolo/volume) — nada de afftfilt/
// acrusher/rubberband, que podem não estar compilados no ffmpeg-static.
const FILTERS: Record<Exclude<VoiceEffect, 'none'>, string> = {
  robot: 'tremolo=f=30:d=0.7,aecho=0.8:0.88:6:0.5',
  echo: 'aecho=0.8:0.9:500:0.4',
  deep: 'asetrate=22050*0.82,aresample=22050,atempo=1.22',
  chipmunk: 'asetrate=22050*1.5,aresample=22050,atempo=0.667',
  radio: 'highpass=f=400,lowpass=f=3000,volume=1.4',
  phone: 'highpass=f=500,lowpass=f=3400',
  underwater: 'lowpass=f=500,aecho=0.8:0.9:120:0.4',
  demon: 'asetrate=22050*0.75,aresample=22050,atempo=1.1,aecho=0.8:0.9:70:0.4',
};

/** Efeitos GRÁTIS (amostra). Os restantes são premium. */
export const FREE_EFFECTS: readonly VoiceEffect[] = ['none', 'robot', 'echo'];

/** Todos os efeitos (ordem das choices do /voice effect). */
export const VOICE_EFFECTS: readonly VoiceEffect[] = [
  'none', 'robot', 'echo', 'deep', 'chipmunk', 'radio', 'phone', 'underwater', 'demon',
];

export function isVoiceEffect(s: string): s is VoiceEffect {
  return (VOICE_EFFECTS as readonly string[]).includes(s);
}

/** É um efeito só-premium (i.e. não está na lista grátis)? */
export function isPremiumEffect(effect: VoiceEffect): boolean {
  return !FREE_EFFECTS.includes(effect);
}

/** Filtro ffmpeg do efeito, ou null para 'none'/desconhecido (=> voz limpa). */
export function ffmpegFilterFor(effect: string): string | null {
  if (!isVoiceEffect(effect) || effect === 'none') return null;
  return FILTERS[effect as Exclude<VoiceEffect, 'none'>];
}

const LABELS: Record<VoiceEffect, string> = {
  none: 'None (normal)',
  robot: '🤖 Robot',
  echo: '🔊 Echo',
  deep: '🕳️ Deep',
  chipmunk: '🐿️ Chipmunk',
  radio: '📻 Radio',
  phone: '📞 Phone',
  underwater: '🌊 Underwater',
  demon: '😈 Demon',
};

/** Label legível de um efeito (para as respostas). */
export function effectLabel(effect: VoiceEffect): string {
  return LABELS[effect] ?? effect;
}

/**
 * Choices do /voice effect: os premium levam 💎 no nome para se perceber que precisam de
 * Premium (o gate real é validado no handler). ≤25 choices, ok.
 */
export const EFFECT_CHOICES: { name: string; value: VoiceEffect }[] = VOICE_EFFECTS.map((e) => ({
  name: isPremiumEffect(e) ? `💎 ${LABELS[e]}` : LABELS[e],
  value: e,
}));

/** Tempo máximo do passo ffmpeg de efeito (mesmo teto do resto do pipeline). */
const FX_TIMEOUT_MS = 15_000;

export interface ApplyEffectDeps {
  ffmpegPath?: string | null;
  spawnImpl?: typeof spawn;
}

/**
 * Aplica um filtro ffmpeg a um WAV, devolvendo o caminho de um NOVO WAV temporário. Mirror
 * do runner do gtts: timeout+kill, cleanup best-effort, latch `settled` para nunca deixar a
 * Promise pendente. Rejeita em erro (o chamador — EffectEngine — apanha e cai na voz limpa).
 */
export function applyEffect(inputWav: string, filter: string, deps: ApplyEffectDeps = {}): Promise<string> {
  const ff = (deps.ffmpegPath ?? (ffmpegStatic as unknown as string | null)) as string | null;
  const spawnImpl = deps.spawnImpl ?? spawn;
  if (!ff) return Promise.reject(new Error('fx: ffmpeg-static não encontrado'));

  const workDir = mkdtempSync(join(tmpdir(), 'voxi-fx-'));
  const outPath = join(workDir, 'out.wav');
  const args = [
    '-hide_banner', '-loglevel', 'error', '-i', inputWav,
    '-af', filter, '-ar', '22050', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', outPath, '-y',
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawnImpl(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        // já morto
      }
      reject(new Error(`fx: ffmpeg excedeu ${FX_TIMEOUT_MS}ms`));
      rmDirSafe(workDir);
    }, FX_TIMEOUT_MS);
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`fx: falha ao iniciar ffmpeg: ${err.message}`));
      rmDirSafe(workDir);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(outPath);
        // NB: NÃO limpamos workDir aqui — o chamador copia o outPath (cache.put) e só
        // depois limpa (a limpeza fica a cargo do EffectEngine).
      } else {
        reject(new Error(`fx: ffmpeg saiu com ${code}: ${stderr.trim()}`));
        rmDirSafe(workDir);
      }
    });
  });
}

/**
 * Motor decorador que aplica o efeito de voz (req.effect) DEPOIS da síntese, com cache
 * própria (namespace 'fx') keyed por cacheKey(req)+efeito — o áudio com efeito é
 * partilhado por reqs idênticas e a LRU limpa-o (sem leak de temporários). 'none'/sem
 * efeito -> devolve o WAV base tal e qual. Qualquer erro do ffmpeg -> voz LIMPA (nunca
 * lança: senão o player saltava a fala e o user premium ouvia silêncio).
 */
export class EffectEngine implements TTSEngine {
  constructor(
    private readonly inner: TTSEngine,
    private readonly cache: AudioCache,
    private readonly deps: ApplyEffectDeps = {},
  ) {}

  async synth(req: SynthRequest): Promise<string> {
    const base = await this.inner.synth(req);
    const effect = req.effect ?? 'none';
    const filter = ffmpegFilterFor(effect);
    if (!filter) return base; // 'none' ou desconhecido -> voz limpa

    const key = `${cacheKey(req)}_${effect}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    let tmp: string | null = null;
    try {
      tmp = await applyEffect(base, filter, this.deps);
      return this.cache.put(key, tmp);
    } catch (err) {
      log.warn('[fx] efeito falhou, a servir voz limpa:', err);
      return base;
    } finally {
      // Limpa o DIR temporário do applyEffect (a cache já tem a sua própria cópia do WAV).
      if (tmp) rmDirSafe(dirname(tmp));
    }
  }
}
