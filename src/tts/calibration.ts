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
