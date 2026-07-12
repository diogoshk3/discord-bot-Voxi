// src/tts/engine.ts
export interface SynthRequest {
  text: string;
  model: string;
  speed: number;
  // Texto de onde se calcula a ÊNFASE (grito por `!`/MAIÚSCULAS e a entoação de `?`) —
  // deve ser SÓ o que o UTILIZADOR escreveu, sem o que o bot injeta (prefixo xsaid
  // "{nome} disse", sufixo de media "um link"). Sem isto, um nome/apelido em MAIÚSCULAS
  // fazia TODAS as mensagens saírem mais alto (falso grito). Ausente => cai no `text`.
  // NÃO entra na cacheKey (é decidido na reprodução/pós-síntese, não muda o áudio base).
  emphasisSource?: string;
  // Milissegundos de silencio a PREPENDER ao audio sintetizado (default: nenhum).
  // Usado p.ex. pelo /joke para criar uma pausa real ANTES do riso (o riso e uma
  // fala separada com leadSilenceMs). Opcional: ausente => output inalterado.
  leadSilenceMs?: number;
  // Quando true, DESLIGA a sintese multi-lingua por-segmento para ESTE pedido: o
  // texto e lido verbatim com `model`, sem ser partido por lingua. Usado quando a
  // voz foi DELIBERADAMENTE escolhida (ex. /voice preview, /joke, /laugh, ou o
  // toggle de deteccao por-user desligado) e a deteccao NAO deve sobrepor-se.
  // Ausente/false => comportamento normal (parte por segmento quando ha >1 lingua).
  singleVoice?: boolean;
  // Partes (texto, voz) JA RESOLVIDAS por-segmento para a sintese MISTURADA de
  // linguas (ex. base numa lingua + girias EN numa voz inglesa). Quando presente e
  // o MultiSegmentEngine esta ativo, cada parte e sintetizada com o seu proprio
  // `model` e os WAVs sao concatenados. O `text`/`model` de topo continuam a ser o
  // fallback single-voice (flag do motor OFF) e a base da chave de cache.
  segments?: { text: string; model: string }[];
  // MOTOR escolhido PELO UTILIZADOR para esta fala: 'google' (gTTS, default),
  // 'piper' (self-host), 'kokoro' (neural opt-in — cai no gTTS nas línguas que não
  // suporta / em falha) ou 'gcloud' (Google Cloud TTS Standard, perk Premium — cai no
  // gTTS sem key / por falha / por orçamento). Ausente/undefined = 'google'. O
  // PerUserEngineRouter despacha por este campo; entra na chave de cache (quando
  // 'piper'/'kokoro'/'gcloud') para não cruzar áudio entre users de motores diferentes.
  engine?: 'google' | 'piper' | 'kokoro' | 'gcloud';
  // ORÇAMENTO gcloud (Premium): descritor pré-resolvido no build-time (onde há
  // identidade+db) que viaja com o pedido até ao chokepoint (GCloudEngine), que conta os
  // chars SÓ na chamada real à Google (cache-miss). `scope`/`key` identificam o pool a
  // debitar; `seats` (só p/ scope 'pass') define o tier de allowance (3->400k, senão 1M).
  // O TETO concreto é calculado no motor a partir da config (o resolver fica sem config).
  // Ausente num pedido engine:'gcloud' => fail-SAFE (o GCloudEngine recusa e cai no gTTS):
  // um caminho não-gated nunca gasta $ silencioso. Fora da cacheKey (não altera o áudio).
  // Ver tts/gcloudUsage.ts + resolveUserEngine.
  gcloudBudget?: { scope: 'user' | 'pass' | 'guild'; key: string; seats?: number };
  // EFEITO de voz (premium) a aplicar ao WAV DEPOIS da síntese (robot/echo/deep...).
  // Ausente/'none' => voz limpa. NÃO entra na cacheKey (o EffectEngine tem cache própria
  // keyed por cacheKey+efeito), por isso o áudio limpo continua partilhado entre users.
  effect?: string;
  // CLONE de voz (premium): caminho do WAV de referência da PRÓPRIA voz do autor. Quando
  // presente, o CloneEngine sintetiza `text` nessa voz (sidecar Python) em vez do motor
  // normal; qualquer falha cai na voz normal. Fora da cacheKey (cache própria 'clone').
  cloneRef?: string;
  // ASSET de áudio fixo: caminho de um WAV JÁ pronto em disco (ex. o efeito sonoro do
  // /rizz). Quando presente, o player toca-o DIRETO — sem motor, sem cache, sem efeitos
  // (nada disso se aplica a um clip fixo). `text` é ignorado para a síntese (mas o ganho
  // de ênfase usa emphasisSource/text, por isso passa-se '' para não gritar). O silêncio
  // de arranque deve estar EMBUTIDO no ficheiro (o leadSilenceMs vive nos motores).
  assetPath?: string;
}

export interface TTSEngine {
  synth(req: SynthRequest): Promise<string>; // devolve caminho absoluto de um .wav
}
