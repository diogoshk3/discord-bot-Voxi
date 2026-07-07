/**
 * Frases curtas e neutras em cada lingua-base, para o jogo "Adivinha a Lingua": o
 * Vozen le a frase COM A VOZ dessa lingua e os jogadores adivinham QUE lingua e. Cada
 * frase e uma saudacao + convite a conversa (conteudo inofensivo, boa cobertura
 * fonetica). Sao lidas via gTTS/Piper na lingua correspondente, por isso o texto tem
 * de estar CORRETO nessa lingua (acentos incluidos).
 *
 * Chave = codigo base ISO-639-1 (o mesmo que baseCodeOf devolve de um id de modelo).
 * O jogo so escolhe entre linguas que tenham AQUI uma frase E uma voz instalada, por
 * isso ter frases a mais (sem voz) e inofensivo — simplesmente nunca sao escolhidas.
 */
export const LANGUAGE_PHRASES: Record<string, string> = {
  pt: 'Olá a todos, hoje está um dia muito bonito para conversarmos juntos.',
  en: 'Hello everyone, today is a beautiful day to sit down and have a chat.',
  es: 'Hola a todos, hoy es un día muy bonito para sentarnos a conversar.',
  fr: 'Bonjour à tous, aujourd’hui est une belle journée pour discuter ensemble.',
  de: 'Hallo zusammen, heute ist ein schöner Tag, um gemütlich zu plaudern.',
  it: 'Ciao a tutti, oggi è una bella giornata per fare due chiacchiere insieme.',
  nl: 'Hallo allemaal, vandaag is een mooie dag om gezellig te kletsen.',
  ru: 'Привет всем, сегодня прекрасный день, чтобы посидеть и поговорить.',
  uk: 'Привіт усім, сьогодні чудовий день, щоб сісти й поговорити.',
  pl: 'Cześć wszystkim, dziś jest piękny dzień na miłą rozmowę.',
  tr: 'Herkese merhaba, bugün oturup sohbet etmek için güzel bir gün.',
  cs: 'Ahoj všichni, dnes je krásný den na příjemné povídání.',
  ca: 'Hola a tothom, avui fa un dia molt bonic per seure a conversar.',
  sv: 'Hej allihopa, idag är en vacker dag för att sitta och prata.',
  fi: 'Hei kaikki, tänään on kaunis päivä istua alas ja jutella.',
  da: 'Hej allesammen, i dag er en dejlig dag til at sidde og snakke.',
  ro: 'Bună tuturor, azi este o zi frumoasă pentru o conversație plăcută.',
  el: 'Γεια σε όλους, σήμερα είναι μια όμορφη μέρα για μια ωραία κουβέντα.',
  hu: 'Sziasztok mindenkinek, ma szép nap van egy kis beszélgetéshez.',
  ar: 'مرحباً بالجميع، اليوم يوم جميل لنجلس ونتحدث معاً.',
  vi: 'Xin chào mọi người, hôm nay là một ngày đẹp để ngồi trò chuyện.',
  zh: '大家好，今天是个坐下来聊天的好日子。',
  sk: 'Ahojte všetci, dnes je krásny deň na príjemný rozhovor.',
  sr: 'Здраво свима, данас је леп дан да седнемо и попричамо.',
  sw: 'Habari zenu nyote, leo ni siku nzuri ya kukaa na kuzungumza.',
  is: 'Halló öll, í dag er fallegur dagur til að setjast niður og spjalla.',
  lv: 'Sveiki visiem, šodien ir skaista diena, lai apsēstos un parunātu.',
};
