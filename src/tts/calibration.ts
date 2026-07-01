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
 * Fator de length_scale GLOBAL do preset ORGÂNICO (escolhido em A/B pelo
 * operador: "organic forte"). Multiplica POR CIMA da calibração por-voz para
 * abrandar ligeiramente TODAS as vozes — fala menos apressada, som mais natural.
 * 1.10 = +10% de duração. Compõe-se com VOICE_CALIBRATION (que NÃO muda): p.ex.
 * uma voz sem calibração (1) resolve a 1.10; o tugão (1.5) resolve a 1.65.
 */
export const ORGANIC_LENGTH_SCALE = 1.1;

/**
 * length_scale efetivo para um pedido: aplica a calibração da voz (default 1),
 * multiplica pelo fator ORGÂNICO global (ORGANIC_LENGTH_SCALE) e divide pela
 * velocidade do utilizador (speed>0; valores inválidos => 1). Piper: length_scale
 * baixo = mais rápido; alto = mais lento. Esta é a ÚNICA fonte do --length_scale.
 */
export function lengthScaleFor(model: string, speed: number): number {
  const safeSpeed = speed > 0 ? speed : 1;
  const calibration = VOICE_CALIBRATION[model] ?? 1;
  return (calibration * ORGANIC_LENGTH_SCALE) / safeSpeed;
}

/**
 * Parâmetros de QUALIDADE de síntese do Piper (independentes da velocidade).
 * Correspondem a flags do binário. Os defaults globais são o preset ORGÂNICO
 * (escolhido em A/B pelo operador: som mais natural), NÃO os defaults do Piper:
 *   noiseScale (--noise_scale)      0.75 (Piper: 0.667) — mais variação tímbrica
 *   noiseW     (--noise_w)          0.95 (Piper: 0.8)   — mais variação de duração
 *   sentenceSilence (--sentence_silence) 0.4 (Piper: 0.2) segundos — respira mais
 *
 * NB: o length_scale NÃO vive aqui — continua a ser a única fonte a função
 * lengthScaleFor (calibração da voz × ORGANIC_LENGTH_SCALE / velocidade). Ver acima.
 */
export interface SynthParams {
  noiseScale: number;
  noiseW: number;
  sentenceSilence: number;
}

/**
 * Defaults GLOBAIS de síntese = preset ORGÂNICO "forte" (escolhido em A/B pelo
 * operador). Fonte ÚNICA — referenciados pela config (fallback das envs
 * NOISE_SCALE/NOISE_W/SENTENCE_SILENCE) E pelo fallback do construtor do
 * PiperEngine, para que os dois nunca divirjam. Continuam env-overridable; estes
 * são apenas o novo default de fábrica (mais natural que os defaults do Piper).
 */
export const PIPER_DEFAULT_SYNTH_PARAMS: SynthParams = {
  noiseScale: 0.75,
  noiseW: 0.95,
  sentenceSilence: 0.4,
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
