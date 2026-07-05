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
  es: [
    'Verdad: ¿cuál es la canción más vergonzosa de tu lista de reproducción?',
    'Reto: envía el último emoji que usaste, diez veces seguidas.',
    '¿Qué prefieres: llegar siempre diez minutos tarde o veinte minutos antes?',
    'Verdad: ¿qué pequeña cosa te hace irracionalmente feliz?',
    'Reto: escribe tu próximo mensaje usando solo la nariz.',
    '¿Qué prefieres: pizza ilimitada o tacos ilimitados de por vida?',
    'Verdad: ¿cuál es la combinación de comida más rara que te encanta en secreto?',
    'Reto: describe tu día usando solo tres emojis.',
    '¿Qué prefieres: poder volar o ser invisible?',
    'Verdad: ¿cuál fue la última mentira (pequeña) que dijiste?',
    'Reto: hazle un cumplido sincero a la persona de arriba.',
    '¿Qué prefieres: no volver a usar redes sociales o no ver otra película?',
  ],
  fr: [
    'Vérité : quelle est la chanson la plus gênante de ta playlist ?',
    'Action : envoie le dernier emoji que tu as utilisé, dix fois de suite.',
    'Tu préfères arriver toujours dix minutes en retard ou vingt minutes en avance ?',
    'Vérité : quelle petite chose te rend irrationnellement heureux ?',
    'Action : écris ton prochain message uniquement avec le nez.',
    'Tu préfères pizza illimitée ou tacos illimités à vie ?',
    'Vérité : quelle est la combinaison de nourriture la plus bizarre que tu adores en secret ?',
    'Action : décris ta journée avec seulement trois emojis.',
    'Tu préfères pouvoir voler ou être invisible ?',
    'Vérité : quel est le dernier petit mensonge que tu as dit ?',
    'Action : fais un compliment sincère à la personne au-dessus de toi.',
    'Tu préfères ne plus jamais utiliser les réseaux sociaux ou ne plus jamais voir un film ?',
  ],
  de: [
    'Wahrheit: Was ist das peinlichste Lied in deiner Playlist?',
    'Pflicht: Schick das letzte Emoji, das du benutzt hast, zehnmal hintereinander.',
    'Was ist dir lieber: immer zehn Minuten zu spät oder zwanzig Minuten zu früh?',
    'Wahrheit: Welche kleine Sache macht dich unvernünftig glücklich?',
    'Pflicht: Schreib deine nächste Nachricht nur mit der Nase.',
    'Was ist dir lieber: unbegrenzt Pizza oder unbegrenzt Tacos fürs Leben?',
    'Wahrheit: Was ist die seltsamste Essenskombination, die du heimlich liebst?',
    'Pflicht: Beschreib deinen Tag mit nur drei Emojis.',
    'Was ist dir lieber: fliegen können oder unsichtbar sein?',
    'Wahrheit: Was war die letzte (kleine) Lüge, die du erzählt hast?',
    'Pflicht: Mach der Person über dir ein ehrliches Kompliment.',
    'Was ist dir lieber: nie wieder soziale Medien oder nie wieder einen Film sehen?',
  ],
  it: [
    'Verità: qual è la canzone più imbarazzante della tua playlist?',
    'Obbligo: manda l’ultima emoji che hai usato, dieci volte di fila.',
    'Preferisci arrivare sempre dieci minuti in ritardo o venti minuti in anticipo?',
    'Verità: quale piccola cosa ti rende irrazionalmente felice?',
    'Obbligo: scrivi il prossimo messaggio usando solo il naso.',
    'Preferisci pizza illimitata o tacos illimitati a vita?',
    'Verità: qual è la combinazione di cibo più strana che adori in segreto?',
    'Obbligo: descrivi la tua giornata usando solo tre emoji.',
    'Preferisci saper volare o essere invisibile?',
    'Verità: qual è stata l’ultima piccola bugia che hai detto?',
    'Obbligo: fai un complimento sincero alla persona sopra di te.',
    'Preferisci non usare mai più i social o non vedere mai più un film?',
  ],
};

/** Banco de desafios para o locale (base) da guild; fallback a ingles. PURA. */
export function pickPrompts(locale: string): string[] {
  const base = locale.split('-')[0].toLowerCase();
  return ROULETTE_PROMPTS[base] ?? ROULETTE_PROMPTS.en;
}
