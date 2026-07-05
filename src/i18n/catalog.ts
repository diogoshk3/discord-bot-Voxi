/**
 * Catalogo de traducoes da INTERFACE (texto), keyed por chave estavel.
 *
 * Contrato:
 *  - `en` e a FONTE DE VERDADE (base/default). Toda a chave TEM de ter `en`.
 *  - `pt` e OPCIONAL/parcial: quando falta, o t() faz fallback para `en`.
 *  - As chaves sao strings estaveis (ex. 'help.title'); os valores podem conter
 *    placeholders `{param}` interpolados por t().
 *
 * NB: isto cobre so o texto da INTERFACE. O idioma da VOZ/TTS e independente e
 * NAO se toca aqui. (A unica excecao "falada" e `preview.sample`, a frase-amostra
 * do /voice preview — mas essa e texto de UI que por acaso e lido em voz alta,
 * por isso vive aqui e passa por t() como o resto.)
 *
 * P16.1: chrome do /help. P16.2 (este item): TODAS as respostas/erros/embeds
 * dos handlers migraram para aqui, com `en` natural/simpatico por defeito.
 */

export interface Entry {
  /** Ingles — obrigatorio (fonte de verdade). */
  en: string;
  /** Portugues — opcional (fallback para `en` quando ausente). */
  pt?: string;
}

export const catalog: Record<string, Entry> = {
  // ── generico ──────────────────────────────────────────────────────────────
  'error.generic': {
    en: 'Something went wrong. Please try again.',
    pt: 'Ocorreu um erro. Tenta outra vez.',
  },
  'error.needManageGuild': {
    en: 'You need the **Manage Server** permission to do that.',
    pt: 'Precisas da permissao **Gerir Servidor** para fazer isto.',
  },

  // ── /join · /leave · /skip · /tts ─────────────────────────────────────────
  'join.needVoiceChannel': {
    en: 'Hop into a voice channel first, then run /join.',
    pt: 'Entra primeiro num canal de voz e depois usa /join.',
  },
  'join.missingPerms': {
    en: 'I need the **Connect** and **Speak** permissions in {channel}.',
    pt: 'Preciso das permissoes **Ligar** e **Falar** em {channel}.',
  },
  // Sucesso do /join: confirma a entrada e da o PROXIMO PASSO ao iniciante. NOTA: um
  // /join simples NAO liga a auto-leitura (so o /setup a liga), por isso o passo
  // "sempre funciona" e /tts (dizer algo JA); /setup fica como pointer para depois
  // poder escrever no canal. Nao promete "escreve e sou lido" sem /setup (seria falso).
  'join.joined': {
    en: "✅ I'm in {channel}! Next step: say `/tts hello` and I'll read it out loud. Want me to auto-read a channel? Run /setup.",
    pt: '✅ Entrei em {channel}! Próximo passo: diz `/tts olá` e eu leio em voz alta. Queres que leia um canal automaticamente? Corre /setup.',
  },
  'leave.left': {
    en: 'Left the voice channel. See you next time!',
    pt: 'Sai do canal de voz. Ate a proxima!',
  },
  'skip.notInVoice': {
    en: "I'm not in a voice channel yet — join one and run /join first, then try again.",
    pt: 'Ainda nao estou num canal de voz — entra num e corre /join primeiro, depois tenta outra vez.',
  },
  'skip.skipped': {
    en: 'Skipped.',
    pt: 'Saltado.',
  },
  // Ha player na voz mas nada a tocar nem na fila: /skip nao finge que saltou.
  'skip.nothing': {
    en: 'Nothing is playing right now.',
    pt: 'Não está nada a tocar de momento.',
  },
  // Partilhada por /tts, /joke e /laugh ("sem player" -> bot fora da voz). Guia o
  // principiante: junta-te a uma call E corre /join, depois tenta outra vez.
  'tts.notInVoice': {
    en: "I'm not in a voice channel yet — join one and run /join, then try again.",
    pt: 'Ainda nao estou num canal de voz — entra num e corre /join, depois tenta outra vez.',
  },
  'tts.nothingToRead': {
    en: "There's nothing to read there — send me some text to say.",
    pt: 'Nao ha nada para ler — manda-me algum texto para eu dizer.',
  },
  'tts.nothingAfterClean': {
    en: "After tidying that up there was nothing left to read — try some normal text (letters or words).",
    pt: 'Depois da limpeza nao sobrou nada para ler — tenta texto normal (letras ou palavras).',
  },
  'tts.tooFast': {
    en: "Whoa, slow down a little — try again in a moment.",
    pt: 'Calma, vai com mais calma — tenta daqui a um instante.',
  },
  'tts.blocked': {
    en: 'That text contains a blocked word, so I skipped it.',
    pt: 'Esse texto tem uma palavra bloqueada, por isso ignorei-o.',
  },
  'tts.queued': {
    en: "Got it — it's in the queue.",
    pt: 'Feito — esta na fila.',
  },
  // Fila no cap: o pedido NAO entrou na fila. Usada por /tts e /voice preview para
  // nao mentir "queued"/"playing" quando nada foi enfileirado (P18.1).
  'tts.busy': {
    en: "I'm busy right now — try again in a moment.",
    pt: 'Estou ocupado agora — tenta daqui a um instante.',
  },

  // ── /voice ────────────────────────────────────────────────────────────────
  'voice.unknownModel': {
    en: "I don't know that voice — check /voice list.",
    pt: 'Nao conheco essa voz — usa /voice list.',
  },
  // speed fora do intervalo permitido: o builder do `speed` NAO tem min/max, por isso
  // o Discord NAO rejeita client-side. Antes o handler fazia silent-clamp (ex. 5 -> 2×)
  // e respondia "sucesso" — uma surpresa silenciosa. Agora damos um erro amigavel com
  // o intervalo permitido e NAO gravamos nada. Boundaries 0.5 e 2.0 continuam validos.
  'voice.badSpeed': {
    en: 'Speed has to be between 0.5 and 2.0 (1.0 is normal). Try `/voice set model:… speed:1.0`.',
    pt: 'A velocidade tem de estar entre 0.5 e 2.0 (1.0 é o normal). Tenta `/voice set model:… speed:1.0`.',
  },
  // Sucesso do /voice set: lidera com o NOME AMIGAVEL ({name}, ex. "English (US) —
  // Amy"), mantem o id cru ({model}) subtil e copy-pasteavel, e da o PROXIMO PASSO
  // (ouvir a voz JA via /tts — sempre funciona, sem depender de auto-read).
  'voice.set': {
    en: '✅ Your voice is now **{name}** at {speed}× (engine: **{engine}**). Try `/tts hello` to hear it. (id: `{model}`)',
    pt: '✅ A tua voz agora é **{name}** a {speed}× (motor: **{engine}**). Experimenta `/tts olá` para a ouvir. (id: `{model}`)',
  },
  'voice.listHeader': {
    en: 'Available voices:',
    pt: 'Vozes disponiveis:',
  },
  'voice.listEmpty': {
    en: '(none installed)',
    pt: '(nenhuma instalada)',
  },
  // Sucesso do /voice reset: confirma o reset e aponta o PROXIMO PASSO (escolher
  // outra voz) — /voice list para ver as opcoes, /voice set para escolher.
  'voice.reset': {
    en: '✅ Your voice is back to the default. Pick another anytime with `/voice list` and `/voice set`.',
    pt: '✅ A tua voz voltou ao valor por defeito. Escolhe outra quando quiseres com `/voice list` e `/voice set`.',
  },
  'voice.optout': {
    en: "You won't be read automatically anymore. Run /voice optin to turn it back on.",
    pt: 'Ja nao seras lido automaticamente. Usa /voice optin para voltar.',
  },
  'voice.optin': {
    en: "You'll be read automatically again.",
    pt: 'Voltas a ser lido automaticamente.',
  },
  'voice.nickname.set': {
    en: '✅ Voxi will now call you **{name}** out loud.',
    pt: '✅ O Voxi vai chamar-te **{name}** em voz alta.',
  },
  'voice.nickname.cleared': {
    en: '✅ Spoken nickname cleared — Voxi will use your server name.',
    pt: '✅ Apelido falado removido — o Voxi vai usar o teu nome do servidor.',
  },
  'voice.nickname.invalid': {
    en: "That name has nothing readable to say out loud. Try letters or numbers.",
    pt: 'Esse nome não tem nada legível para dizer em voz alta. Usa letras ou números.',
  },
  // /voice detection — liga/desliga a deteccao AUTOMATICA de lingua para o proprio.
  // DEFAULT = OFF (voz UNICA fixa p/ todas as linguas — parece a mesma pessoa). ON e
  // opt-in: voz nativa por lingua, MAS pode trocar de locutor. A mensagem OFF aponta
  // para /voice set (a "definicao" para trocar a voz).
  'voice.detection.on': {
    en: '✅ Per-language detection is **on** — each language is read by its native voice, so the speaker may change between languages.',
    pt: '✅ Deteção por-língua **ligada** — cada língua é lida pela sua voz nativa, por isso o locutor pode mudar entre línguas.',
  },
  'voice.detection.off': {
    en: "✅ Per-language detection is **off** (default) — one single voice reads everything, in every language. Pick it with `/voice set`.",
    pt: '✅ Deteção por-língua **desligada** (padrão) — uma só voz lê tudo, em qualquer língua. Escolhe-a com `/voice set`.',
  },
  'voice.notInVoice': {
    en: "I'm not in a voice channel yet — run /join first.",
    pt: 'Ainda nao estou num canal de voz — usa /join primeiro.',
  },
  'voice.previewPlaying': {
    en: 'Playing a sample…',
    pt: 'A reproduzir uma amostra…',
  },
  // Frase-amostra falada pela voz escolhida no /voice preview. Curta e neutra.
  'preview.sample': {
    en: "Hi, I'm Voxi. type it, hear it.",
    // FIX (auditoria i18n/locale — docs/I18N-LOCALE-AUDIT.md §2): a versao anterior
    // tinha "Ola, eu sou o Voxi. type it, hear it." — a 2.a frase ficava por
    // traduzir. Esta chave e FALADA pelo TTS (a unica excecao "falada" do
    // catalogo, ver comentario no topo do ficheiro), por isso uma frase
    // bilingue soa a erro de sintetizador, nao a escolha de marca — ao contrario
    // de 'help.title'/'welcome.footer', que TEM um comentario explicito "tagline
    // fica em ingles em qualquer idioma" (aqui nao havia esse comentario, logo
    // nao ha evidencia de que a mistura fosse intencional). Os 32 locales Fase B
    // ja traduziram esta frase por inteiro (ex. es: "escríbelo, escúchalo"; ca:
    // "Escriu-ho i escolta'l") — pt (curado a mao na Fase A) era a UNICA excecao.
    // Alinhado ao mesmo padrao curto/imperativo.
    pt: 'Ola, eu sou o Voxi. escreve, ouve.',
  },

  // ── /laugh · /joke (diversao por-utilizador; tocam audio via player.say) ────
  // Confirmacao do /laugh: reutiliza o gate tts.notInVoice para "sem player" e
  // tts.busy para fila cheia (consistencia com /tts e /voice preview).
  'laugh.playing': {
    en: 'Haha! Playing that in your voice…',
    pt: 'Haha! A reproduzir na tua voz…',
  },
  // Confirmacao do /joke: inclui a piada para o utilizador a ver escrita tambem.
  'joke.playing': {
    en: 'Telling a joke…\n> {joke}',
    pt: 'A contar uma piada…\n> {joke}',
  },
  // idioma pedido nao existe na lista de linguas suportadas.
  'joke.unknownLang': {
    en: "I don't know that language. Pick one from the list.",
    pt: 'Nao conheco essa lingua. Escolhe uma da lista.',
  },

  // ── /voice abbrev (abreviaturas pessoais, globais) ─────────────────────────
  'voice.abbrev.added': {
    en: 'Got it — {term} will be read as {replacement}.',
    pt: 'Feito — {term} passa a ser lido como {replacement}.',
  },
  'voice.abbrev.removed': {
    en: 'Removed your abbreviation for {term}.',
    pt: 'Removi a tua abreviatura de {term}.',
  },
  'voice.abbrev.listHeader': {
    en: 'Your personal abbreviations ({count}/{cap} used):',
    pt: 'As tuas abreviaturas pessoais ({count}/{cap} usadas):',
  },
  'voice.abbrev.listEmpty': {
    en: "(none yet — add one with /voice abbrev add)",
    pt: '(nenhuma ainda — cria uma com /voice abbrev add)',
  },
  'voice.abbrev.capReached': {
    en: "You've reached the limit of {cap} personal abbreviations. Remove one before adding another.",
    pt: 'Chegaste ao limite de {cap} abreviaturas pessoais. Remove uma antes de adicionar outra.',
  },
  'voice.abbrev.invalidTerm': {
    en: 'The term must be a single word (letters and digits only), up to 50 characters.',
    pt: 'O termo tem de ser uma unica palavra (so letras e digitos), ate 50 caracteres.',
  },
  'voice.abbrev.emptyReplacement': {
    en: "The reading can't be empty.",
    pt: 'A leitura nao pode ser vazia.',
  },
  'voice.abbrev.tooLong': {
    en: 'The reading is too long (max 200 characters).',
    pt: 'A leitura e demasiado longa (maximo 200 caracteres).',
  },

  // ── /config ───────────────────────────────────────────────────────────────
  'config.wordEmpty': {
    en: "The word can't be empty.",
    pt: 'A palavra nao pode ser vazia.',
  },
  'config.blocked': {
    en: 'Blocked: {word}.',
    pt: 'Bloqueado: {word}.',
  },
  'config.unblocked': {
    en: 'Unblocked: {word}.',
    pt: 'Desbloqueado: {word}.',
  },
  'config.pronListHeader': {
    en: 'Pronunciation dictionary:',
    pt: 'Dicionario de pronuncia:',
  },
  'config.pronEmptyValue': {
    en: '(empty)',
    pt: '(vazio)',
  },
  'config.listEmpty': {
    en: '(none)',
    pt: '(nenhum)',
  },
  'config.termEmpty': {
    en: "The term can't be empty.",
    pt: 'O termo nao pode ser vazio.',
  },
  'config.pronEmpty': {
    en: "The pronunciation can't be empty.",
    pt: 'A pronuncia nao pode ser vazia.',
  },
  'config.pronSet': {
    en: 'Got it — {term} will be read as {replacement}.',
    pt: 'Feito — {term} passa a ser lido como {replacement}.',
  },
  'config.pronRemoved': {
    en: 'Removed the pronunciation for {term}.',
    pt: 'Removi a pronuncia de {term}.',
  },
  'config.channelWrongType': {
    en: 'Pick a text channel (not a voice channel or a category).',
    pt: 'Escolhe um canal de texto (nao voz nem categoria).',
  },
  'config.channelNoAccess': {
    en: "I can't see {channel} — please check my permissions there.",
    pt: 'Nao tenho acesso a {channel} — verifica as minhas permissoes.',
  },
  // Sucesso do /config tts-channel: confirma o canal e da o PROXIMO PASSO — garantir
  // que a auto-leitura esta ligada (/config autoread on) para as mensagens serem lidas.
  'config.channelSet': {
    en: 'Auto-read channel set to {channel}. Next: make sure auto-read is on with `/config autoread active:true`.',
    pt: 'Canal de auto-leitura: {channel}. A seguir: confirma que a auto-leitura está ligada com `/config autoread ativo:true`.',
  },
  'config.autoreadOn': {
    en: 'Auto-read is now **on**.',
    pt: 'Auto-leitura: **ligada**.',
  },
  'config.autoreadOff': {
    en: 'Auto-read is now **off**.',
    pt: 'Auto-leitura: **desligada**.',
  },
  'config.maxCharsRange': {
    en: 'The max-chars value has to be between 1 and 2000.',
    pt: 'O valor de max-chars tem de estar entre 1 e 2000.',
  },
  'config.maxCharsSet': {
    en: 'Max characters per message set to {value}.',
    pt: 'Max chars: {value}.',
  },
  'config.rateLimitRange': {
    en: 'The rate-limit value has to be between 1 and 120.',
    pt: 'O valor de rate-limit tem de estar entre 1 e 120.',
  },
  'config.rateLimitSet': {
    en: 'Rate limit set to {value} messages per minute.',
    pt: 'Rate-limit: {value}/min.',
  },
  'config.roleSet': {
    en: 'Auto-read is now limited to members with {role}.',
    pt: 'Auto-leitura restrita a quem tem {role}.',
  },
  'config.roleCleared': {
    en: 'Role restriction removed — everyone can be read now.',
    pt: 'Restricao de role removida: todos podem ser lidos.',
  },
  'config.enabledOn': {
    en: 'TTS is now **on** for this server.',
    pt: 'TTS **ativado** neste servidor.',
  },
  'config.enabledOff': {
    en: 'TTS is now **off** for this server.',
    pt: 'TTS **desativado** neste servidor.',
  },
  'config.xsaidOn': {
    en: 'Voxi will now announce **who spoke** before each message (e.g. "Alex said hi"). Turn off with `/config xsaid active:false`.',
    pt: 'O Voxi vai anunciar **quem falou** antes de cada mensagem (ex.: "Alex disse olá"). Desliga com `/config xsaid active:false`.',
  },
  'config.xsaidOff': {
    en: 'Voxi will **no longer** announce who spoke — it reads only the message.',
    pt: 'O Voxi **deixou de** anunciar quem falou — lê só a mensagem.',
  },
  'config.autojoinOn': {
    en: '✅ Auto-join **on** — Voxi will join your voice channel when you type in the TTS channel.',
    pt: '✅ Auto-entrada **ligada** — o Voxi entra no teu canal de voz quando escreves no canal de TTS.',
  },
  'config.autojoinOff': {
    en: 'Auto-join **off** — use `/join` to bring Voxi into voice.',
    pt: 'Auto-entrada **desligada** — usa `/join` para trazer o Voxi para a voz.',
  },
  'config.readBotsOn': {
    en: '✅ Voxi will now read messages from **other bots and webhooks** too.',
    pt: '✅ O Voxi passa a ler também mensagens de **outros bots e webhooks**.',
  },
  'config.readBotsOff': {
    en: 'Voxi will **ignore** other bots and webhooks (only real people are read).',
    pt: 'O Voxi **ignora** outros bots e webhooks (só lê pessoas reais).',
  },
  'config.textInVoiceOn': {
    en: "✅ Voxi will also read the **text chat inside its voice channel**.",
    pt: '✅ O Voxi também vai ler o **chat de texto dentro do canal de voz** onde está.',
  },
  'config.textInVoiceOff': {
    en: 'Voxi will **not** read the voice channel text chat (only the TTS channel).',
    pt: 'O Voxi **não** lê o chat de texto do canal de voz (só o canal de TTS).',
  },
  // Sucesso do /config default-voice: lidera com o NOME AMIGAVEL ({name}) e mantem o
  // id cru ({model}) subtil/copy-pasteavel. Usada quando o utilizador nao tem voz
  // propria, por isso e a voz que os membros vao ouvir por defeito.
  'config.defaultVoiceSet': {
    en: "✅ Server default voice set to **{name}**. Members without their own voice will hear this one. (id: `{model}`)",
    pt: '✅ Voz default do servidor: **{name}**. Os membros sem voz própria vão ouvir esta. (id: `{model}`)',
  },
  'config.reset': {
    en: 'Config reset to defaults. Your blocklist and pronunciations were kept.',
    pt: 'Config reposta aos valores por defeito. Blocklist e pronuncia mantidas.',
  },
  // /config show — cabecalho + linhas + valores especiais
  'config.showTitle': {
    en: '**Server configuration**',
    pt: '**Configuracao do servidor**',
  },
  'config.showChannel': {
    en: 'TTS channel: {value}',
    pt: 'Canal TTS: {value}',
  },
  'config.showAutoread': {
    en: 'Auto-read: {value}',
    pt: 'Auto-leitura: {value}',
  },
  'config.showRole': {
    en: 'Role: {value}',
    pt: 'Role: {value}',
  },
  'config.showEnabled': {
    en: 'Enabled: {value}',
    pt: 'Ativo: {value}',
  },
  'config.showXsaid': {
    en: 'Announce speaker (xsaid): {value}',
    pt: 'Anunciar quem falou (xsaid): {value}',
  },
  'config.showAutojoin': {
    en: 'Auto-join: {value}',
    pt: 'Auto-entrada: {value}',
  },
  'config.showReadBots': {
    en: 'Read bots/webhooks: {value}',
    pt: 'Ler bots/webhooks: {value}',
  },
  'config.showTextInVoice': {
    en: 'Text-in-voice: {value}',
    pt: 'Texto-em-voz: {value}',
  },
  'config.showVoice': {
    en: 'Default voice: {value}',
    pt: 'Voz default: {value}',
  },
  'config.showMaxChars': {
    en: 'Max characters: {value}',
    pt: 'Max chars: {value}',
  },
  'config.showRateLimit': {
    en: 'Rate limit: {value}/min',
    pt: 'Rate-limit: {value}/min',
  },
  'config.showBlocklist': {
    en: 'Blocklist: {count} words',
    pt: 'Blocklist: {count} palavras',
  },
  'config.showPronunciation': {
    en: 'Pronunciations: {count} entries',
    pt: 'Pronuncia: {count} entradas',
  },
  'config.valueNone': {
    en: '(none)',
    pt: '(nenhum)',
  },
  'config.valueAny': {
    en: 'anyone',
    pt: 'qualquer',
  },
  'config.valueAutoDetect': {
    en: '(auto-detect)',
    pt: '(deteção automática)',
  },
  'config.on': {
    en: 'on',
    pt: 'on',
  },
  'config.off': {
    en: 'off',
    pt: 'off',
  },
  // /config language — troca do idioma da INTERFACE. A confirmacao e mostrada JA
  // na NOVA lingua (o handler chama t() com o locale escolhido), por isso os dois
  // valores devem soar naturais em cada idioma. {language} = nome legivel (endonimo).
  'config.language.set': {
    en: 'Interface language set to {language}.',
    pt: 'Idioma da interface definido para {language}.',
  },
  'config.language.unsupported': {
    en: "That language isn't supported yet.",
    pt: 'Esse idioma ainda nao e suportado.',
  },

  // ── /setup ────────────────────────────────────────────────────────────────
  'setup.noChannel': {
    en: "I couldn't tell which channel to use. Pass a text channel in the \"channel\" option.",
    pt: 'Nao consegui identificar o canal. Indica um canal de texto na opcao "canal".',
  },
  'setup.channelWrongType': {
    en: 'The auto-read channel has to be a text channel (not a voice channel or a category). Pass one in the "channel" option.',
    pt: 'O canal de auto-leitura tem de ser um canal de texto do servidor (nao voz nem categoria). Indica um na opcao "canal".',
  },
  'setup.done': {
    en: '**All set — Voxi is ready.**',
    pt: '**Setup do Voxi concluido.**',
  },
  'setup.channelLine': {
    en: 'Auto-read channel: {channel}',
    pt: 'Canal de auto-leitura: {channel}',
  },
  'setup.autoreadOn': {
    en: 'Auto-read: on',
    pt: 'Auto-leitura: ligada',
  },
  'setup.permsHeader': {
    en: '**Permissions:**',
    pt: '**Permissoes:**',
  },
  'setup.permView': {
    en: 'ViewChannel (see the text channel)',
    pt: 'ViewChannel (ver o canal de texto)',
  },
  'setup.permSend': {
    en: 'SendMessages (post in the text channel)',
    pt: 'SendMessages (escrever no canal de texto)',
  },
  'setup.permConnect': {
    en: 'Connect (join the voice channel)',
    pt: 'Connect (ligar ao canal de voz)',
  },
  'setup.permSpeak': {
    en: 'Speak (talk in the voice channel)',
    pt: 'Speak (falar no canal de voz)',
  },
  'setup.permOk': {
    en: '✅ {label}',
    pt: '✅ {label}',
  },
  'setup.permMissing': {
    en: '❌ {label} — missing',
    pt: '❌ {label} — falta',
  },
  'setup.permUnchecked': {
    en: "⏳ {label} — not checked yet (I'll verify it on /join)",
    pt: '⏳ {label} — nao verificado (sera validado no /join)',
  },
  'setup.fixHint': {
    en: "To fix what's missing: in your server settings open Voxi's role (or the channel's permissions) and enable the items marked with ❌.",
    pt: 'Para corrigir o que falta: nas definicoes do servidor abre o role do Voxi (ou as permissoes do canal) e ativa as permissoes marcadas com ❌.',
  },
  'setup.voiceUncheckedNote': {
    en: "You're not in a voice channel, so I couldn't check Connect/Speak yet — I'll verify them when you run /join.",
    pt: 'Nao estas num canal de voz, por isso nao deu para verificar Connect/Speak agora — serao validados quando correres /join.',
  },
  'setup.allGood': {
    en: "Everything's ready. Hop into a voice channel and run /join.",
    pt: 'Esta tudo pronto. Entra num canal de voz e usa /join.',
  },
  // /setup juntou-se JA ao canal de voz do invocador (reutilizou a logica de /join).
  'setup.joinedVoice': {
    en: "I've joined {channel} too — no need to run /join.",
    pt: 'Ja entrei em {channel} — nao precisas de correr /join.',
  },
  // Proximo passo quando o /setup ja se juntou a voz: e so escrever.
  'setup.readyTalk': {
    en: "Everything's ready. Type in the auto-read channel and I'll read it out loud.",
    pt: 'Esta tudo pronto. Escreve no canal de auto-leitura e eu leio em voz alta.',
  },
  // Guia para MEMBROS (nao-admin): o passo seguinte que o admin partilha com o
  // servidor. E o fluxo em 3 passos — curto e concreto, NAO a referencia completa
  // de comandos (essa e o /help). Header + corpo numerado.
  'setup.membersHeader': {
    en: '**Tell your members (the 3-step flow):**',
    pt: '**Diz aos teus membros (o fluxo em 3 passos):**',
  },
  'setup.membersBody': {
    en:
      '1) Join a voice channel\n' +
      '2) Run /join so I hop in with you\n' +
      '3) Type in this channel (or use /tts) and I read it out loud\n' +
      'Full command list: /help',
    pt:
      '1) Entra num canal de voz\n' +
      '2) Corre /join para eu entrar contigo\n' +
      '3) Escreve neste canal (ou usa /tts) e eu leio em voz alta\n' +
      'Lista completa de comandos: /help',
  },

  // ── /stats ────────────────────────────────────────────────────────────────
  'stats.title': {
    en: '**Voxi stats**',
    pt: '**Estatisticas do Voxi**',
  },
  'stats.messagesSpoken': {
    en: 'Messages spoken: {value}',
    pt: 'Mensagens faladas: {value}',
  },
  'stats.cacheHits': {
    en: 'Cache hits: {value}',
    pt: 'Cache hits: {value}',
  },
  'stats.cacheMisses': {
    en: 'Cache misses: {value}',
    pt: 'Cache misses: {value}',
  },
  'stats.synthErrors': {
    en: 'Synthesis errors: {value}',
    pt: 'Erros de sintese: {value}',
  },
  'stats.synthLatency': {
    en: 'Synthesis latency: p50 {p50}ms / p95 {p95}ms ({count} samples)',
    pt: 'Latencia de sintese: p50 {p50}ms / p95 {p95}ms ({count} amostras)',
  },
  'stats.voiceDrops': {
    en: 'Voice drops: {value}',
    pt: 'Quedas de voz: {value}',
  },
  'stats.voiceReconnects': {
    en: 'Reconnects: {value}',
    pt: 'Reconexoes: {value}',
  },
  'stats.votes': {
    en: 'top.gg votes: {value}',
    pt: 'Votos top.gg: {value}',
  },
  'stats.activePlayers': {
    en: 'Active players: {value}',
    pt: 'Players ativos: {value}',
  },
  'stats.servers': {
    en: 'Servers: {value}',
    pt: 'Servidores: {value}',
  },
  'stats.uptime': {
    en: 'Uptime: {value}s',
    pt: 'Uptime: {value}s',
  },

  // ── context-menu "Speak" ──────────────────────────────────────────────────
  'speak.emptyMessage': {
    en: "That message has no text to read out loud.",
    pt: 'Essa mensagem não tem texto para ler em voz alta.',
  },

  // ── /uptime · /botstats (públicos) ────────────────────────────────────────
  'uptime.text': {
    en: '🟢 Voxi has been online for **{uptime}**.',
    pt: '🟢 O Voxi está online há **{uptime}**.',
  },
  'botstats.title': {
    en: '📊 **Voxi — stats**',
    pt: '📊 **Voxi — estatísticas**',
  },
  'botstats.servers': {
    en: 'Servers: **{value}**',
    pt: 'Servidores: **{value}**',
  },
  'botstats.voiceSessions': {
    en: 'Voice sessions now: **{value}**',
    pt: 'Sessões de voz agora: **{value}**',
  },
  'botstats.messagesSpoken': {
    en: 'Messages spoken: **{value}**',
    pt: 'Mensagens lidas: **{value}**',
  },
  'botstats.uptime': {
    en: 'Uptime: **{value}**',
    pt: 'Online há: **{value}**',
  },

  // ── /invite · /vote ───────────────────────────────────────────────────────
  'invite.noClientId': {
    en: "Voxi's invite link isn't set up yet (CLIENT_ID is missing). Let the bot admin know.",
    pt: 'O Voxi ainda nao tem o link de convite configurado (CLIENT_ID em falta). Avisa o admin do bot.',
  },
  'invite.link': {
    en: 'Add Voxi to your server:\n{url}',
    pt: 'Adiciona o Voxi ao teu servidor:\n{url}',
  },
  'vote.noClientId': {
    en: "Voxi's vote link isn't set up yet (CLIENT_ID is missing). Let the bot admin know.",
    pt: 'O Voxi ainda nao tem o link de voto configurado (CLIENT_ID em falta). Avisa o admin do bot.',
  },
  'vote.link': {
    en: 'Vote for Voxi (free, every 12h) and help more people find it:\n{url}',
    pt: 'Vota no Voxi (grátis, a cada 12h) e ajuda mais gente a encontrá-lo:\n{url}',
  },

  // ── /help chrome (tudo o que NAO e a lista de comandos, que vem de commandDefs) ──
  // O titulo vira DESCRICAO do embed (embeds nao renderizam markdown no titulo),
  // por isso 'help.title' e texto simpatico sem `**…**`.
  'help.title': {
    en: 'Voxi — type it, hear it.',
    // Sem `pt`: a marca/tagline e a mesma em qualquer idioma (fallback a en).
  },
  'help.embedTitle': {
    en: 'Voxi — Commands',
    pt: 'Voxi — Comandos',
  },
  'help.intro': {
    en: 'Voxi reads your text aloud in voice channels — free neural voices, dozens of languages.',
    pt: 'O Voxi le o teu texto em voz alta nos canais de voz — vozes neurais gratis, dezenas de linguas.',
  },

  // Quick start (3 passos): o primeiro FIELD do embed. Curto, numerado, para um
  // principiante arrancar em 30 segundos. Mantido dentro do cap de 1024 chars.
  'help.quickStartTitle': {
    en: 'Quick start (3 steps)',
    pt: 'Inicio rapido (3 passos)',
  },
  'help.quickStartBody': {
    en:
      '1) Join a voice channel, then run /join\n' +
      '2) Type in the text channel (or use /tts Hello everyone!)\n' +
      '3) (optional) Pick a voice with /voice set',
    pt:
      '1) Entra num canal de voz e corre /join\n' +
      '2) Escreve no canal de texto (ou usa /tts Ola a todos!)\n' +
      '3) (opcional) Escolhe uma voz com /voice set',
  },

  // ── grupos beginner-friendly (5): cada um e um FIELD do embed ─────────────
  'help.groupStarted': {
    en: 'Getting started',
    pt: 'Primeiros passos',
  },
  'help.groupStartedBody': {
    en:
      '• /join — I join your voice channel\n' +
      '• /leave — I leave the voice channel\n' +
      '• /tts <text> — I read text out loud · e.g. /tts Hello everyone!\n' +
      '• /skip — skip whatever I am reading right now',
    pt:
      '• /join — entro no teu canal de voz\n' +
      '• /leave — saio do canal de voz\n' +
      '• /tts <texto> — leio texto em voz alta · ex. /tts Ola a todos!\n' +
      '• /skip — salto o que estou a ler agora',
  },
  'help.groupVoice': {
    en: 'Your voice',
    pt: 'A tua voz',
  },
  'help.groupVoiceBody': {
    en:
      '• /voice set <model> — choose your voice · e.g. /voice set en_US-amy-medium\n' +
      '• /voice list — see the available voices\n' +
      '• /voice preview — hear a sample of your voice\n' +
      '• /voice reset — go back to the default voice\n' +
      '• /voice detection <on/off> — native voice per language, speaker may change (off by default: one fixed voice)\n' +
      '• /voice optout · /voice optin — turn auto-read off / on for you',
    pt:
      '• /voice set <model> — escolhe a tua voz · ex. /voice set pt_PT-tugao-medium\n' +
      '• /voice list — ve as vozes disponiveis\n' +
      '• /voice preview — ouve uma amostra da tua voz\n' +
      '• /voice reset — volta a voz por defeito\n' +
      '• /voice detection <on/off> — voz nativa por lingua, o locutor pode mudar (desligado por defeito: uma voz fixa)\n' +
      '• /voice optout · /voice optin — desliga / liga a leitura automatica para ti',
  },
  'help.groupFun': {
    en: 'Fun',
    pt: 'Diversao',
  },
  'help.groupFunBody': {
    en:
      '• /joke — I tell a short joke (pick a language + optional laughter) · e.g. /joke English\n' +
      '• /laugh — I laugh out loud in your current voice',
    pt:
      '• /joke — conto uma piada curta (escolhe a lingua + risos opcionais) · ex. /joke Portuguese\n' +
      '• /laugh — rio-me em voz alta na tua voz atual',
  },
  'help.groupAdmin': {
    en: 'Server admin (needs Manage Server)',
    pt: 'Admin do servidor (precisa de Gerir Servidor)',
  },
  'help.groupAdminBody': {
    en:
      '• /setup — guided one-step configuration · run this first\n' +
      '• /config — autoread, tts-channel, language, default-voice, blockword, pronunciation,\n' +
      '  rate-limit, role, max-chars, enabled · e.g. /config tts-channel #general\n' +
      '• /stats — bot statistics',
    pt:
      '• /setup — configuracao guiada num passo · corre isto primeiro\n' +
      '• /config — autoread, tts-channel, language, default-voice, blockword, pronunciation,\n' +
      '  rate-limit, role, max-chars, enabled · ex. /config tts-channel #geral\n' +
      '• /stats — estatisticas do bot',
  },
  'help.groupMore': {
    en: 'More',
    pt: 'Mais',
  },
  'help.groupMoreBody': {
    en:
      '• /invite — add Voxi to another server\n' +
      '• /vote — vote for Voxi on top.gg\n' +
      '• /help — show this help',
    pt:
      '• /invite — adiciona o Voxi a outro servidor\n' +
      '• /vote — vota no Voxi no top.gg\n' +
      '• /help — mostra esta ajuda',
  },
  'help.footer': {
    en: 'New here? Run {command} to get started.',
    pt: 'Primeira vez? Corre {command} para comecares.',
  },

  // ── welcome embed (guildCreate) ────────────────────────────────────────────
  // Enviado UMA vez quando o Voxi entra num servidor novo. Guild nova nao tem
  // config, por isso o locale e sempre o default ('en'). Beginner-friendly: diz
  // o que o Voxi faz + como comecar (/setup) + onde ver a ajuda (/help).
  'welcome.title': {
    en: 'Thanks for adding Voxi! 👋',
    pt: 'Obrigado por adicionares o Voxi! 👋',
  },
  'welcome.description': {
    en: "Voxi reads your chat out loud in voice channels — type it, hear it.\n\n**Get started in one step:** run {setup} and I'll set up auto-read and join your voice channel.\n\nNeed the full command list? Run {help}.",
    pt: 'O Voxi le o teu chat em voz alta nos canais de voz — escreve e ouve.\n\n**Comeca num passo:** corre {setup} e eu configuro a auto-leitura e entro no teu canal de voz.\n\nQueres a lista completa de comandos? Corre {help}.',
  },
  // Field do welcome: o fluxo em 3 passos para os MEMBROS arrancarem. Curto e
  // concreto (join voz -> /join -> escrever/tts), a apontar para /help para a lista
  // completa — teaser, NAO a referencia de comandos. Cabe no cap de 1024 do field.
  'welcome.stepsTitle': {
    en: 'How members use it (3 steps)',
    pt: 'Como os membros usam (3 passos)',
  },
  'welcome.stepsBody': {
    en:
      '1) Join a voice channel\n' +
      '2) Run /join so I join you\n' +
      '3) Type in the text channel (or use /tts) and I read it out loud\n' +
      'Full command list: /help',
    pt:
      '1) Entra num canal de voz\n' +
      '2) Corre /join para eu entrar contigo\n' +
      '3) Escreve no canal de texto (ou usa /tts) e eu leio em voz alta\n' +
      'Lista completa de comandos: /help',
  },
  'welcome.footer': {
    en: 'Voxi — type it, hear it.',
    // Sem `pt`: a tagline e a mesma em qualquer idioma (fallback a en).
  },
  // Diferenciador vs. o lider pago do mercado ("TTS Bot", ~€5/mes): a voz neural do
  // Voxi e gratuita e sem paywall. SO texto de posicionamento — NAO promete "mais
  // facil"/"invite-and-go" (o projeto e self-host; os docs avisam para nao o dizer).
  'welcome.tagline': {
    en: 'Natural neural voice — free forever, no paywall.',
    pt: 'Voz neural natural — grátis para sempre, sem paywall.',
  },

  // ── /game — minijogos ─────────────────────────────────────────────────────
  // Chrome do comando (arranque, paragem, leaderboard, lista) + cada jogo. `en` e a
  // fonte de verdade; `pt` traduzido. As outras 32 linguas caem em `en` via t().
  'game.start.needVoice': {
    en: "This is a **voice game** — hop into a voice channel and run /join first, then start it.",
    pt: 'Este é um **jogo de voz** — entra num canal de voz e corre /join primeiro, depois começa.',
  },
  'game.start.alreadyActive': {
    en: "A game is already running in <#{channel}>. Finish it (or use `/game stop`) before starting another.",
    pt: 'Já há um jogo a decorrer em <#{channel}>. Termina-o (ou usa `/game stop`) antes de começar outro.',
  },
  'game.start.started': {
    en: '🎮 Starting **{game}**! Watch the channel — good luck!',
    pt: '🎮 A começar **{game}**! Atenção ao canal — boa sorte!',
  },
  'game.unknownGame': {
    en: "I don't know that game. Pick one from the list.",
    pt: 'Não conheço esse jogo. Escolhe um da lista.',
  },
  'game.stop.ok': {
    en: '🛑 Stopped the current game.',
    pt: '🛑 Parei o jogo atual.',
  },
  'game.stop.none': {
    en: 'There is no game running right now.',
    pt: 'Não há nenhum jogo a decorrer agora.',
  },
  'game.list.title': {
    en: '🎮 **Games** — start one with `/game play`:',
    pt: '🎮 **Jogos** — começa um com `/game play`:',
  },
  'game.list.line': {
    en: '• **{name}** — {desc}',
    pt: '• **{name}** — {desc}',
  },
  'game.leaderboard.title': {
    en: '🏆 **Leaderboard** — top players on this server:',
    pt: '🏆 **Leaderboard** — os melhores jogadores deste servidor:',
  },
  'game.leaderboard.empty': {
    en: 'No games have been played yet. Be the first — `/game play`!',
    pt: 'Ainda não se jogou nada. Sê o primeiro — `/game play`!',
  },
  'game.leaderboard.line': {
    en: '{rank}. <@{user}> — **{points}** pts ({wins} wins)',
    pt: '{rank}. <@{user}> — **{points}** pts ({wins} vitórias)',
  },
  // Resumo final partilhado por qualquer jogo (placar da partida).
  'game.finish.title': {
    en: '🏁 **Game over!** Final scores:',
    pt: '🏁 **Fim de jogo!** Pontuações finais:',
  },
  'game.finish.line': {
    en: '{rank}. **{user}** — {points}',
    pt: '{rank}. **{user}** — {points}',
  },
  'game.finish.noScores': {
    en: "🏁 Game over — nobody scored this time. Next time!",
    pt: '🏁 Fim de jogo — ninguém pontuou desta vez. Para a próxima!',
  },

  // ── Adivinha a Língua ─────────────────────────────────────────────────────
  'game.guessLanguage.name': {
    en: 'Guess the Language',
    pt: 'Adivinha a Língua',
  },
  'game.guessLanguage.desc': {
    en: 'I read a sentence in a random language — first to name it wins the point.',
    pt: 'Leio uma frase numa língua aleatória — o primeiro a acertar ganha o ponto.',
  },
  'game.guessLanguage.intro': {
    en: "🗣️ **Guess the Language** — I'll read {rounds} sentences. Type which language you hear. Fastest correct answer wins each round!",
    pt: '🗣️ **Adivinha a Língua** — vou ler {rounds} frases. Escreve que língua ouves. A resposta certa mais rápida ganha cada ronda!',
  },
  'game.guessLanguage.round': {
    en: '🎧 Round {n}/{total} — listen…',
    pt: '🎧 Ronda {n}/{total} — ouve com atenção…',
  },
  'game.guessLanguage.correct': {
    en: '✅ **{user}** got it — it was **{language}**!',
    pt: '✅ **{user}** acertou — era **{language}**!',
  },
  'game.guessLanguage.timeout': {
    en: "⏱️ Time! That was **{language}**.",
    pt: '⏱️ Tempo! Era **{language}**.',
  },
  'game.guessLanguage.noLanguages': {
    en: "I don't have enough voices installed to play this. Ask an admin to add more voices.",
    pt: 'Não tenho vozes suficientes instaladas para jogar isto. Pede a um admin para adicionar mais vozes.',
  },

  // ── Matemática Falada ─────────────────────────────────────────────────────
  'game.math.name': { en: 'Mental Math', pt: 'Matemática Falada' },
  'game.math.desc': {
    en: 'I say a sum out loud — first to type the answer wins.',
    pt: 'Digo uma conta em voz alta — o primeiro a escrever o resultado ganha.',
  },
  'game.math.intro': {
    en: '🔢 **Mental Math** — {rounds} sums. Listen and type the answer as fast as you can!',
    pt: '🔢 **Matemática Falada** — {rounds} contas. Ouve e escreve o resultado o mais rápido que conseguires!',
  },
  'game.math.round': { en: '🧮 Round {n}/{total} — **{a} {op} {b} = ?**', pt: '🧮 Ronda {n}/{total} — **{a} {op} {b} = ?**' },
  'game.math.correct': { en: '✅ **{user}** nailed it — the answer was **{answer}**!', pt: '✅ **{user}** acertou — o resultado era **{answer}**!' },
  'game.math.timeout': { en: '⏱️ Time! The answer was **{answer}**.', pt: '⏱️ Tempo! O resultado era **{answer}**.' },
  // Palavras dos operadores — FALADAS (na voz da guild), por isso texto simples.
  'game.math.plus': { en: 'plus', pt: 'mais' },
  'game.math.minus': { en: 'minus', pt: 'menos' },
  'game.math.times': { en: 'times', pt: 'vezes' },

  // ── Contagem Sabotada ─────────────────────────────────────────────────────
  'game.skipCount.name': { en: 'Missing Number', pt: 'Contagem Sabotada' },
  'game.skipCount.desc': {
    en: 'I count out loud but skip one number — first to catch it wins.',
    pt: 'Conto em voz alta mas salto um número — o primeiro a apanhá-lo ganha.',
  },
  'game.skipCount.intro': {
    en: '🔢 **Missing Number** — I count, but I skip one. Type the missing number! ({rounds} rounds)',
    pt: '🔢 **Contagem Sabotada** — eu conto, mas salto um número. Escreve o que faltou! ({rounds} rondas)',
  },
  'game.skipCount.round': { en: '👂 Round {n}/{total} — which number did I skip?', pt: '👂 Ronda {n}/{total} — que número saltei?' },
  'game.skipCount.correct': { en: '✅ **{user}** caught it — I skipped **{answer}**!', pt: '✅ **{user}** apanhou — saltei o **{answer}**!' },
  'game.skipCount.timeout': { en: '⏱️ Time! I skipped **{answer}**.', pt: '⏱️ Tempo! Saltei o **{answer}**.' },

  // ── Ditado ────────────────────────────────────────────────────────────────
  'game.spelling.name': { en: 'Spelling Bee', pt: 'Ditado' },
  'game.spelling.desc': {
    en: 'I say a word — first to spell it correctly wins.',
    pt: 'Digo uma palavra — o primeiro a escrevê-la corretamente ganha.',
  },
  'game.spelling.intro': {
    en: "✍️ **Spelling Bee** — I'll say {rounds} words. Type each one spelled correctly!",
    pt: '✍️ **Ditado** — vou dizer {rounds} palavras. Escreve cada uma corretamente!',
  },
  'game.spelling.round': { en: '🗣️ Round {n}/{total} — write the word I say…', pt: '🗣️ Ronda {n}/{total} — escreve a palavra que eu disser…' },
  'game.spelling.correct': { en: '✅ **{user}** spelled **{word}** right!', pt: '✅ **{user}** escreveu **{word}** corretamente!' },
  'game.spelling.timeout': { en: '⏱️ Time! The word was **{word}**.', pt: '⏱️ Tempo! A palavra era **{word}**.' },
  'game.spelling.empty': {
    en: "I don't have a word list for this server's voice language yet.",
    pt: 'Ainda não tenho uma lista de palavras para a língua da voz deste servidor.',
  },

  // ── Soletrado ao Contrário ────────────────────────────────────────────────
  'game.spellOut.name': { en: 'Unscramble the Spelling', pt: 'Soletrado ao Contrário' },
  'game.spellOut.desc': {
    en: 'I spell a word letter by letter — first to write the whole word wins.',
    pt: 'Soletro uma palavra letra a letra — o primeiro a escrever a palavra inteira ganha.',
  },
  'game.spellOut.intro': {
    en: '🔡 **Unscramble the Spelling** — I spell {rounds} words letter by letter. Type the full word!',
    pt: '🔡 **Soletrado ao Contrário** — soletro {rounds} palavras letra a letra. Escreve a palavra completa!',
  },
  'game.spellOut.round': { en: '🔤 Round {n}/{total} — listen to the letters…', pt: '🔤 Ronda {n}/{total} — ouve as letras…' },
  'game.spellOut.correct': { en: '✅ **{user}** got it — **{word}**!', pt: '✅ **{user}** acertou — **{word}**!' },
  'game.spellOut.timeout': { en: '⏱️ Time! It spelled **{word}**.', pt: '⏱️ Tempo! Soletrava **{word}**.' },

  // ── Velocidade Estúpida ───────────────────────────────────────────────────
  'game.fastSpeech.name': { en: 'Fast Talk', pt: 'Velocidade Estúpida' },
  'game.fastSpeech.desc': {
    en: 'I read a sentence super fast — first to type what I said wins.',
    pt: 'Leio uma frase super depressa — o primeiro a escrever o que eu disse ganha.',
  },
  'game.fastSpeech.intro': {
    en: '💨 **Fast Talk** — {rounds} sentences at ludicrous speed. Type what you hear!',
    pt: '💨 **Velocidade Estúpida** — {rounds} frases a uma velocidade ridícula. Escreve o que ouvires!',
  },
  'game.fastSpeech.round': { en: '⚡ Round {n}/{total} — here it comes, fast!', pt: '⚡ Ronda {n}/{total} — aí vai, depressa!' },
  'game.fastSpeech.correct': { en: '✅ **{user}** decoded it: “{phrase}”', pt: '✅ **{user}** decifrou: “{phrase}”' },
  'game.fastSpeech.timeout': { en: '⏱️ Time! It was: “{phrase}”', pt: '⏱️ Tempo! Era: “{phrase}”' },
  'game.fastSpeech.empty': {
    en: "I don't have phrases for this server's voice language yet.",
    pt: 'Ainda não tenho frases para a língua da voz deste servidor.',
  },

  // ── Sotaque Trocado ───────────────────────────────────────────────────────
  'game.accentSwap.name': { en: 'Funny Accent', pt: 'Sotaque Trocado' },
  'game.accentSwap.desc': {
    en: 'I say a word with a foreign accent — first to write it wins.',
    pt: 'Digo uma palavra com um sotaque estrangeiro — o primeiro a escrevê-la ganha.',
  },
  'game.accentSwap.intro': {
    en: '🎭 **Funny Accent** — {rounds} words said with the wrong accent. Type the word!',
    pt: '🎭 **Sotaque Trocado** — {rounds} palavras ditas com o sotaque errado. Escreve a palavra!',
  },
  'game.accentSwap.round': { en: '🌍 Round {n}/{total} — what word am I trying to say?', pt: '🌍 Ronda {n}/{total} — que palavra estou a tentar dizer?' },
  'game.accentSwap.correct': { en: '✅ **{user}** got it — **{word}**!', pt: '✅ **{user}** acertou — **{word}**!' },
  'game.accentSwap.timeout': { en: '⏱️ Time! The word was **{word}**.', pt: '⏱️ Tempo! A palavra era **{word}**.' },
};
