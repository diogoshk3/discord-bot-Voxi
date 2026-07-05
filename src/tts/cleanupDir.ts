import { rmSync } from 'node:fs';
import { log } from '../logging/logger';

/**
 * Remove um diretório temporário de forma recursiva que NUNCA lança. O `rmSync` com
 * `force:true` só engole ENOENT — NÃO um ficheiro em uso (EPERM/EBUSY no Windows,
 * quando um processo piper/ffmpeg acabou de ser morto e o SO ainda não libertou o
 * handle). Se isso acontecer num `finally`, o erro de limpeza:
 *   1. MASCARA a rejeição original (ex. "Piper timeout" vira "EPERM"), e
 *   2. pode transformar uma síntese BEM-SUCEDIDA (o WAV já foi copiado para a cache)
 *      numa rejeição, deixando a mensagem muda por um erro de limpeza.
 * Por isso a limpeza vive aqui, embrulhada em try/catch — o mesmo padrão que o
 * `cleanup()` do `mp3ToWav` (gtts) já usa. Um temp dir vazado é logado e esquecido,
 * nunca propaga.
 */
export function rmDirSafe(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    log.warn(`[tts] falha ao limpar o diretório temporário ${dir} (ignorado)`, err);
  }
}
