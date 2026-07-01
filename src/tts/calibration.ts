// src/tts/calibration.ts
/**
 * Calibração de length_scale por modelo Piper.
 *
 * Alguns modelos da comunidade foram treinados com prosódia anormalmente
 * rápida ou lenta. Este fator corrige a BASE do length_scale do modelo:
 *   1   = sem correção (a esmagadora maioria dos modelos);
 *   >1  = abranda (o modelo falava rápido demais);
 *   <1  = acelera (o modelo falava devagar demais).
 *
 * Compõe-se MULTIPLICATIVAMENTE com a velocidade do utilizador, por isso o
 * utilizador mantém o controlo relativo: lengthScale = calibração / speed.
 */
export const VOICE_CALIBRATION: Record<string, number> = {
  // pt_PT-tugão é a única voz de Português europeu do catálogo Piper e fala
  // ~30% depressa demais a length_scale=1 (medido: ~53 ms/fonema vs ~75 ms nas
  // vozes de referência amy/cadu). 1.5 aproxima do natural — é MITIGAÇÃO, não
  // paridade (o ritmo satura ~5.5s vs 6.4s do cadu; para PT natural usar cadu).
  'pt_PT-tugao-medium': 1.5,
};

/**
 * length_scale efetivo para um pedido: aplica a calibração da voz (default 1)
 * e divide pela velocidade do utilizador (speed>0; valores inválidos => 1).
 * Piper: length_scale baixo = mais rápido; alto = mais lento.
 */
export function lengthScaleFor(model: string, speed: number): number {
  const safeSpeed = speed > 0 ? speed : 1;
  const calibration = VOICE_CALIBRATION[model] ?? 1;
  return calibration / safeSpeed;
}

/**
 * Parâmetros de QUALIDADE de síntese do Piper (independentes da velocidade).
 * Correspondem a flags do binário; os defaults globais devem ser IGUAIS aos
 * defaults do próprio Piper para não haver mudança audível:
 *   noiseScale (--noise_scale)      default 0.667
 *   noiseW     (--noise_w)          default 0.8
 *   sentenceSilence (--sentence_silence) default 0.2 (segundos)
 *
 * NB: o length_scale NÃO vive aqui — continua a ser a única fonte a função
 * lengthScaleFor (calibração da voz × velocidade do utilizador). Ver abaixo.
 */
export interface SynthParams {
  noiseScale: number;
  noiseW: number;
  sentenceSilence: number;
}

/**
 * Defaults do PRÓPRIO Piper. Fonte ÚNICA — referenciados pela config (fallback
 * das envs NOISE_SCALE/NOISE_W/SENTENCE_SILENCE) E pelo fallback do construtor
 * do PiperEngine, para que os dois nunca divirjam. Mantê-los aqui garante que,
 * sem qualquer env nem override, o output é byte-a-byte o de hoje.
 */
export const PIPER_DEFAULT_SYNTH_PARAMS: SynthParams = {
  noiseScale: 0.667,
  noiseW: 0.8,
  sentenceSilence: 0.2,
};

/**
 * Overrides de params de síntese POR-VOZ — a SUPERFÍCIE de afinação para futura
 * calibração "de ouvido". VAZIO por defeito de propósito: enquanto não houver
 * entradas aqui, NENHUMA voz muda em relação aos defaults globais (zero
 * regressão audível). Cada entrada é PARCIAL — só os campos presentes fazem
 * override; os restantes caem nos defaults globais.
 *
 * A chave `lengthScale` é RESERVADA/documentada mas INERTE hoje: a composição
 * de um override de length_scale com o multiplicador de VOICE_CALIBRATION e a
 * velocidade do utilizador está por definir, por isso synthParamsFor NÃO a
 * resolve (o --length_scale continua a vir exclusivamente de lengthScaleFor).
 *
 * NÃO popular nenhum override agora — escolher valores melhores que o default
 * (e que vozes precisam de afinação) é decisão de ouvido do operador.
 */
export const VOICE_PARAM_OVERRIDES: Record<
  string,
  Partial<SynthParams & { lengthScale: number }>
> = {};

/**
 * Resolve os params de qualidade efetivos para uma voz: parte dos defaults
 * globais e aplica por cima o override por-voz (se existir), campo a campo.
 * Devolve sempre uma CÓPIA nova (não muta os defaults passados). Só resolve
 * noiseScale/noiseW/sentenceSilence — o length_scale é tratado à parte por
 * lengthScaleFor (ver VOICE_PARAM_OVERRIDES sobre a chave lengthScale inerte).
 */
export function synthParamsFor(model: string, globalDefaults: SynthParams): SynthParams {
  const override = VOICE_PARAM_OVERRIDES[model];
  return {
    noiseScale: override?.noiseScale ?? globalDefaults.noiseScale,
    noiseW: override?.noiseW ?? globalDefaults.noiseW,
    sentenceSilence: override?.sentenceSilence ?? globalDefaults.sentenceSilence,
  };
}
