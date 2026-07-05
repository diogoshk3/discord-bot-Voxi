/**
 * Desafios da Roleta (Verdade ou Consequência / o que preferes): o Voxi le UM em voz
 * alta. Conteudo leve e amigavel. Por locale de INTERFACE da guild (ctx.locale); cai
 * em ingles se a lingua nao tiver banco.
 */
export const ROULETTE_PROMPTS: Record<string, string[]> = {
  en: [
    'Truth: what is the most embarrassing song on your playlist?',
    'Dare: send the last emoji you used, ten times in a row.',
    'Would you rather always be ten minutes late or twenty minutes early?',
    'Truth: what is a small thing that makes you irrationally happy?',
    'Dare: type your next message using only your nose.',
    'Would you rather have unlimited pizza or unlimited tacos for life?',
    'Truth: what is the weirdest food combination you secretly love?',
    'Dare: describe your day using only three emojis.',
    'Would you rather be able to fly or be invisible?',
    'Truth: what is the last lie you told (a small one)?',
    'Dare: give the person above you a genuine compliment.',
    'Would you rather never use social media again or never watch another movie?',
  ],
  pt: [
    'Verdade: qual é a música mais embaraçosa da tua playlist?',
    'Consequência: manda o último emoji que usaste, dez vezes seguidas.',
    'O que preferes: chegar sempre dez minutos atrasado ou vinte minutos adiantado?',
    'Verdade: que pequena coisa te deixa irracionalmente feliz?',
    'Consequência: escreve a próxima mensagem só com o nariz.',
    'O que preferes: pizza ilimitada ou tacos ilimitados para a vida toda?',
    'Verdade: qual é a combinação de comida mais estranha que adoras em segredo?',
    'Consequência: descreve o teu dia usando só três emojis.',
    'O que preferes: conseguir voar ou ser invisível?',
    'Verdade: qual foi a última mentira (pequenina) que contaste?',
    'Consequência: faz um elogio sincero à pessoa acima de ti.',
    'O que preferes: nunca mais usar redes sociais ou nunca mais ver um filme?',
  ],
};

/** Banco de desafios para o locale (base) da guild; fallback a ingles. PURA. */
export function pickPrompts(locale: string): string[] {
  const base = locale.split('-')[0].toLowerCase();
  return ROULETTE_PROMPTS[base] ?? ROULETTE_PROMPTS.en;
}
