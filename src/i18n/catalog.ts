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

  // ── /transcribe (STT — voz para texto, Premium) ─────────────────────────────
  'stt.guildOnly': {
    en: 'Transcription only works inside a server.',
    pt: 'A transcrição só funciona dentro de um servidor.',
  },
  'stt.noManage': {
    en: 'You need the **Manage Server** permission to start or stop transcription.',
    pt: 'Precisas da permissão **Gerir Servidor** para arrancar ou parar a transcrição.',
  },
  'stt.notPremium': {
    en: '🎙️ Live transcription is a **Premium** feature. See `/premium info` to unlock it for this server.',
    pt: '🎙️ A transcrição ao vivo é uma feature **Premium**. Vê `/premium info` para a desbloquear neste servidor.',
  },
  'stt.unavailable': {
    en: 'Transcription is not available on this instance (the speech-to-text engine is not installed).',
    pt: 'A transcrição não está disponível nesta instância (o motor de voz-para-texto não está instalado).',
  },
  'stt.notInVoice': {
    en: "I'm not in a voice channel — join one and run `/join` first, then start transcription.",
    pt: 'Não estou num canal de voz — entra num e corre `/join` primeiro, depois arranca a transcrição.',
  },
  'stt.alreadyRunning': {
    en: 'Transcription is already running on this server. Use `/transcribe stop` first.',
    pt: 'A transcrição já está a correr neste servidor. Usa `/transcribe stop` primeiro.',
  },
  'stt.noChannel': {
    en: "I can't post transcripts in this channel. Try running the command from a normal text channel.",
    pt: 'Não consigo postar transcrições neste canal. Tenta correr o comando de um canal de texto normal.',
  },
  'stt.started': {
    en: '✅ Transcription started. Anyone who presses **Consent** in the announcement will be transcribed to this channel.',
    pt: '✅ Transcrição iniciada. Quem carregar em **Consinto** no anúncio passa a ser transcrito para este canal.',
  },
  'stt.announceStart': {
    en: '🎙️ **Live transcription is ON in this channel.** Only people who consent are transcribed — press the button below to allow your speech to be written here. You can withdraw anytime with `/transcribe revoke`.',
    pt: '🎙️ **A transcrição ao vivo está LIGADA neste canal.** Só quem consente é transcrito — carrega no botão abaixo para permitir que a tua fala seja escrita aqui. Podes retirar quando quiseres com `/transcribe revoke`.',
  },
  'stt.consentBtn': {
    en: 'Consent to be transcribed',
    pt: 'Consinto ser transcrito',
  },
  'stt.consentThanks': {
    en: '✅ Thanks — your speech will now be transcribed on this server. Withdraw anytime with `/transcribe revoke`.',
    pt: '✅ Obrigado — a tua fala passa a ser transcrita neste servidor. Retira quando quiseres com `/transcribe revoke`.',
  },
  'stt.stopped': {
    en: '🛑 Transcription stopped.',
    pt: '🛑 Transcrição parada.',
  },
  'stt.notRunning': {
    en: 'Transcription is not running on this server.',
    pt: 'A transcrição não está a correr neste servidor.',
  },
  'stt.announceStop': {
    en: '🛑 **Live transcription is now OFF.** I stopped listening.',
    pt: '🛑 **A transcrição ao vivo está agora DESLIGADA.** Deixei de ouvir.',
  },
  'stt.revoked': {
    en: '✅ Consent withdrawn — you will no longer be transcribed on this server. (Messages already posted stay; delete them in Discord if you want.)',
    pt: '✅ Consentimento retirado — deixas de ser transcrito neste servidor. (As mensagens já postadas ficam; apaga-as no Discord se quiseres.)',
  },
  'stt.revokeNone': {
    en: "You hadn't consented to transcription on this server, so there was nothing to withdraw.",
    pt: 'Não tinhas consentido a transcrição neste servidor, por isso não havia nada a retirar.',
  },

  // ── /privacy erase (direito ao esquecimento) ────────────────────────────────
  'privacy.eraseConfirm': {
    en: '⚠️ This permanently deletes **all** your Vozen data across every server: voice settings, spoken nickname, personal abbreviations and pronunciations, saved birthday, game scores, talk stats, opt-out, and any voice clone (including recordings of your voice made by others). **This cannot be undone.** Are you sure?',
    pt: '⚠️ Isto apaga PERMANENTEMENTE **todos** os teus dados do Vozen em todos os servidores: definições de voz, apelido falado, abreviaturas e pronúncias pessoais, aniversário guardado, pontuações de jogos, estatísticas de fala, opt-out, e qualquer clone de voz (incluindo gravações da tua voz feitas por outros). **Isto não pode ser desfeito.** Tens a certeza?',
  },
  'privacy.erasePremiumNote': {
    en: '_Note: your paid Premium/Plus and its purchase history are kept — they belong to you and to legally-required financial records. To stop Premium, let it expire or contact support._',
    pt: '_Nota: o teu Premium/Plus pago e o histórico da compra são mantidos — pertencem-te e à contabilidade legalmente exigida. Para parar o Premium, deixa-o expirar ou contacta o suporte._',
  },
  'privacy.eraseYes': { en: 'Delete everything', pt: 'Apagar tudo' },
  'privacy.eraseNo': { en: 'Cancel', pt: 'Cancelar' },
  'privacy.eraseCancelled': {
    en: 'Cancelled — nothing was deleted.',
    pt: 'Cancelado — nada foi apagado.',
  },
  'privacy.eraseDone': {
    en: '✅ Done. All your personal data has been permanently deleted.',
    pt: '✅ Feito. Todos os teus dados pessoais foram apagados permanentemente.',
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
  // /shutup — cala tudo já (esvazia a fila + pára o atual), fica na call.
  'shutup.notInVoice': {
    en: "I'm not in a voice channel yet — join one and run /join first.",
    pt: 'Ainda não estou num canal de voz — entra num e corre /join primeiro.',
  },
  'shutup.nothing': {
    en: 'Nothing is playing right now.',
    pt: 'Não está nada a tocar de momento.',
  },
  'shutup.done': {
    en: "🤐 Okay, I'll stop — cleared everything in the queue.",
    pt: '🤐 Está bem, calo-me — limpei tudo o que estava na fila.',
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
    en: 'After tidying that up there was nothing left to read — try some normal text (letters or words).',
    pt: 'Depois da limpeza nao sobrou nada para ler — tenta texto normal (letras ou palavras).',
  },
  'tts.tooFast': {
    en: 'Whoa, slow down a little — try again in a moment.',
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
    en: '✅ Vozen will now call you **{name}** out loud.',
    pt: '✅ O Vozen vai chamar-te **{name}** em voz alta.',
  },
  'voice.nickname.cleared': {
    en: '✅ Spoken nickname cleared — Vozen will use your server name.',
    pt: '✅ Apelido falado removido — o Vozen vai usar o teu nome do servidor.',
  },
  'voice.nickname.invalid': {
    en: 'That name has nothing readable to say out loud. Try letters or numbers.',
    pt: 'Esse nome não tem nada legível para dizer em voz alta. Usa letras ou números.',
  },
  // /voice effect — efeito de voz (premium, 2 amostras grátis).
  'voice.effect.set': {
    en: '✅ Voice effect set to **{effect}** — your messages now play with that effect. Use `/voice effect none` to turn it off.',
    pt: '✅ Efeito de voz definido para **{effect}** — as tuas mensagens passam a tocar com esse efeito. Usa `/voice effect none` para desligar.',
  },
  'voice.effect.cleared': {
    en: '✅ Voice effect removed — clean voice again.',
    pt: '✅ Efeito de voz removido — voz limpa outra vez.',
  },
  // ── /voice clone (clone da PRÓPRIA voz, consent-first, 💎 Premium) ─────────
  'clone.locked': {
    en: '🔒 Voice cloning is a Premium feature (it costs real compute). See `/premium`.',
    pt: '🔒 O clone de voz é uma funcionalidade Premium (custa computação a sério). Vê `/premium`.',
  },
  'clone.notInVoice': {
    en: 'You need to be in the voice channel **with me** to record. Use `/join` first.',
    pt: 'Tens de estar no canal de voz **comigo** para gravar. Usa `/join` primeiro.',
  },
  'clone.alreadyRecording': {
    en: "You're already recording a sample — finish it (or press **⏹️ Stop**) before starting another.",
    pt: 'Já estás a gravar uma amostra — termina-a (ou carrega em **⏹️ Parar**) antes de começar outra.',
  },
  'clone.recording': {
    en: "🎙️ **Recording your voice** — keep talking until it stops on its own (~{target}s of speech, pauses don't count), or press **⏹️ Stop** whenever you're done. I only keep YOUR audio.",
    pt: '🎙️ **A gravar a tua voz** — continua a falar até parar sozinho (~{target}s de fala, as pausas não contam), ou carrega em **⏹️ Parar** quando quiseres. Só guardo o TEU áudio.',
  },
  'clone.recordingOther': {
    en: "🎙️ **Recording {who}** — they should keep talking until it stops on its own (~{target}s of speech, pauses don't count), or press **⏹️ Stop** to finish.",
    pt: '🎙️ **A gravar {who}** — deve continuar a falar até parar sozinho (~{target}s de fala, as pausas não contam), ou carrega em **⏹️ Parar** para terminar.',
  },
  'clone.recordingProgress': {
    en: '🔴 Recording… **{got}s / {target}s** of speech captured. Keep going!',
    pt: '🔴 A gravar… **{got}s / {target}s** de fala apanhados. Continua!',
  },
  'clone.consentRequest': {
    en: '🎙️ {invoker} wants to record **your voice** ({target}s of speech) to build a voice clone they can speak with. Do you allow it? *(expires in 60s)*',
    pt: '🎙️ {invoker} quer gravar **a tua voz** ({target}s de fala) para criar um clone de voz com que possa falar. Permites? *(expira em 60s)*',
  },
  'clone.consentAllow': { en: 'Allow', pt: 'Permitir' },
  'clone.consentDeny': { en: 'No', pt: 'Não' },
  'clone.consentNotYou': {
    en: 'Only the person being recorded can answer this.',
    pt: 'Só a pessoa a ser gravada pode responder a isto.',
  },
  'clone.consentGranted': {
    en: '✅ {who} agreed — starting the recording.',
    pt: '✅ {who} aceitou — a começar a gravação.',
  },
  'clone.consentRefused': {
    en: '✖️ {who} declined. Recording cancelled — no audio was captured.',
    pt: '✖️ {who} recusou. Gravação cancelada — nenhum áudio foi apanhado.',
  },
  'clone.consentTimeout': {
    en: "⌛ {who} didn't answer in time. Recording cancelled.",
    pt: '⌛ {who} não respondeu a tempo. Gravação cancelada.',
  },
  'clone.consentWaiting': {
    en: '⏳ Waiting for {who} to accept in the channel…',
    pt: '⏳ À espera que {who} aceite no canal…',
  },
  'clone.targetNotInVoice': {
    en: '{who} needs to be in the voice channel **with me** to be recorded. Ask them to `/join` first.',
    pt: '{who} tem de estar no canal de voz **comigo** para ser gravado. Pede-lhe para usar `/join` primeiro.',
  },
  'clone.pickFromList': {
    en: 'Pick a person from the suggestions list (only people in the call can be recorded). Leave it empty to record yourself.',
    pt: 'Escolhe uma pessoa da lista de sugestões (só quem está na call pode ser gravado). Deixa vazio para te gravares a ti.',
  },
  'clone.stopBtn': {
    en: 'Stop',
    pt: 'Parar',
  },
  'clone.stopNotYours': {
    en: 'Only the person recording can stop it.',
    pt: 'Só quem está a gravar pode parar.',
  },
  'clone.tooShort': {
    en: 'I only caught {seconds}s of speech — I need at least ~{min}s (target was {target}s) to clone well. Try again with `/voice clone record`.',
    pt: 'Só apanhei {seconds}s de fala — preciso de pelo menos ~{min}s (o alvo era {target}s) para clonar bem. Tenta outra vez com `/voice clone record`.',
  },
  'clone.saved': {
    en: '✅ Voice sample saved ({seconds}s of speech). Turn it on with `/voice clone use active:true`. Only YOU can use your clone; delete it anytime with `/voice clone delete`.',
    pt: '✅ Amostra de voz guardada ({seconds}s de fala). Liga com `/voice clone use active:true`. Só TU podes usar o teu clone; apaga-o quando quiseres com `/voice clone delete`.',
  },
  'clone.savedOther': {
    en: "✅ Saved {seconds}s of {who}'s voice as YOUR clone. Turn it on with `/voice clone use active:true`; delete it anytime with `/voice clone delete`.",
    pt: '✅ Guardados {seconds}s da voz de {who} como o TEU clone. Liga com `/voice clone use active:true`; apaga quando quiseres com `/voice clone delete`.',
  },
  'clone.failed': {
    en: 'The recording failed — try again. If it keeps happening, rejoin the voice channel.',
    pt: 'A gravação falhou — tenta outra vez. Se continuar, volta a entrar no canal de voz.',
  },
  'clone.none': {
    en: "You don't have a voice clone yet. Record one with `/voice clone record` (Premium).",
    pt: 'Ainda não tens um clone de voz. Grava um com `/voice clone record` (Premium).',
  },
  'clone.deleted': {
    en: '🗑️ Voice clone deleted — sample and consent record removed, no trace kept.',
    pt: '🗑️ Clone de voz apagado — amostra e registo de consentimento removidos, sem rasto.',
  },
  // Revogação pela pessoa gravada: apagou clones que OUTROS tinham feito da voz dela.
  'clone.revoked': {
    en: '🛑 Consent withdrawn — removed {count} voice clone(s) other people had made from your voice.',
    pt: '🛑 Consentimento retirado — removi {count} clone(s) que outras pessoas tinham feito da tua voz.',
  },
  'clone.status': {
    en: '🧬 Voice clone: sample recorded {date} · currently **{state}**.',
    pt: '🧬 Clone de voz: amostra gravada {date} · neste momento **{state}**.',
  },
  'clone.stateOn': { en: 'ON', pt: 'LIGADO' },
  'clone.stateOff': { en: 'off', pt: 'desligado' },
  'clone.noSample': {
    en: 'You need a sample first — record one with `/voice clone record`.',
    pt: 'Primeiro precisas de uma amostra — grava com `/voice clone record`.',
  },
  'clone.enabled': {
    en: '✅ Your messages will now be read in **your cloned voice**. Turn off anytime with `/voice clone use active:false`.',
    pt: '✅ As tuas mensagens passam a ser lidas com a **tua voz clonada**. Desliga quando quiseres com `/voice clone use active:false`.',
  },
  'clone.enabledNoEngine': {
    en: "✅ Saved — but the clone engine isn't installed on this instance yet, so you'll hear the normal voice for now.",
    pt: '✅ Guardado — mas o motor de clone ainda não está instalado nesta instância, por isso para já ouves a voz normal.',
  },
  'clone.disabled': {
    en: '✅ Cloned voice off — back to your normal voice.',
    pt: '✅ Voz clonada desligada — de volta à tua voz normal.',
  },
  'voice.effect.locked': {
    en: '🔒 **{effect}** is a Premium effect. Free effects: 🤖 Robot and 🔊 Echo. Unlock all with Vozen Premium — see `/premium`.',
    pt: '🔒 **{effect}** é um efeito Premium. Efeitos grátis: 🤖 Robot e 🔊 Echo. Desbloqueia todos com o Vozen Premium — vê `/premium`.',
  },
  'voice.engine.gcloudLocked': {
    en: '🔒 **💎 Google HD** is a Premium voice engine. Unlock it with Vozen Plus (personal) or Vozen Premium (server) — see `/premium`. Meanwhile your voice stays on the free Google engine.',
    pt: '🔒 O motor **💎 Google HD** é Premium. Desbloqueia-o com o Vozen Plus (pessoal) ou o Vozen Premium (servidor) — vê `/premium`. Entretanto a tua voz fica no motor Google grátis.',
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
    en: "Hi, I'm Vozen. type it, hear it.",
    // FIX (auditoria i18n/locale — docs/I18N-LOCALE-AUDIT.md §2): a versao anterior
    // tinha "Ola, eu sou o Vozen. type it, hear it." — a 2.a frase ficava por
    // traduzir. Esta chave e FALADA pelo TTS (a unica excecao "falada" do
    // catalogo, ver comentario no topo do ficheiro), por isso uma frase
    // bilingue soa a erro de sintetizador, nao a escolha de marca — ao contrario
    // de 'help.title'/'welcome.footer', que TEM um comentario explicito "tagline
    // fica em ingles em qualquer idioma" (aqui nao havia esse comentario, logo
    // nao ha evidencia de que a mistura fosse intencional). Os 32 locales Fase B
    // ja traduziram esta frase por inteiro (ex. es: "escríbelo, escúchalo"; ca:
    // "Escriu-ho i escolta'l") — pt (curado a mao na Fase A) era a UNICA excecao.
    // Alinhado ao mesmo padrao curto/imperativo.
    pt: 'Ola, eu sou o Vozen. escreve, ouve.',
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
  // /rizz — pick-up line falada + (opcional) efeito sonoro.
  'rizz.playing': {
    en: '😏 Dropping some rizz…\n> {line}',
    pt: '😏 A mandar umas cantadas…\n> {line}',
  },
  'rizz.unknownLang': {
    en: "I don't know that language. Pick one from the list.",
    pt: 'Nao conheco essa lingua. Escolhe uma da lista.',
  },
  'rizz.locked': {
    en: '🔒 **/rizz** is a Premium perk. Unlock it with Vozen Plus (you) or Premium (this server). See `/premium`.',
    pt: '🔒 O **/rizz** é um extra Premium. Desbloqueia com o Vozen Plus (tu) ou Premium (este servidor). Vê `/premium`.',
  },

  // ── /sound (soundboard: toca um clip curto na call via assetPath) ──────────
  'sound.playing': {
    en: '🔊 Playing **{name}**…',
    pt: '🔊 A tocar **{name}**…',
  },
  'sound.unknown': {
    en: "I don't have that sound. Run `/sound` to see the list.",
    pt: 'Não tenho esse som. Usa `/sound` para veres a lista.',
  },
  'sound.list': {
    en: '🔊 **Sounds:** {sounds}\nPlay one with `/sound name:<sound>` (I need to be in your voice channel).',
    pt: '🔊 **Sons:** {sounds}\nToca um com `/sound name:<som>` (tenho de estar no teu canal de voz).',
  },
  'sound.disabled': {
    en: '🔇 The soundboard is **off** on this server. An admin can enable it with `/config soundboard`.',
    pt: '🔇 O soundboard está **desligado** neste servidor. Um admin pode ligá-lo com `/config soundboard`.',
  },

  // ── Micro-comandos divertidos (/8ball, /fortune, /fact, /wyr) ──────────────
  'fun.eightball': {
    en: '🎱 **{question}**\n> {answer}',
    pt: '🎱 **{question}**\n> {answer}',
  },
  'fun.fortune': {
    en: '🥠 {text}',
    pt: '🥠 {text}',
  },
  'fun.fact': {
    en: '💡 {text}',
    pt: '💡 {text}',
  },
  'fun.wyr': {
    en: '🤔 {text}',
    pt: '🤔 {text}',
  },

  // ── /birthday ──────────────────────────────────────────────────────────────
  'birthday.set': {
    en: "🎂 Birthday saved: **{day}/{month}**. I'll wish you a happy birthday when you join a voice channel that day!",
    pt: '🎂 Aniversário guardado: **{day}/{month}**. Digo-te parabéns quando entrares numa call nesse dia!',
  },
  'birthday.invalid': {
    en: "That's not a real date. Check the day and month.",
    pt: 'Essa data não existe. Verifica o dia e o mês.',
  },
  'birthday.cleared': {
    en: '🎂 Birthday removed.',
    pt: '🎂 Aniversário removido.',
  },
  'birthday.show': {
    en: '🎂 Your birthday is set to **{day}/{month}**.',
    pt: '🎂 O teu aniversário está definido para **{day}/{month}**.',
  },
  'birthday.none': {
    en: "You haven't set a birthday yet. Use `/birthday set`.",
    pt: 'Ainda não definiste um aniversário. Usa `/birthday set`.',
  },

  // ── /topspeakers (tagarelas do servidor) ───────────────────────────────────
  'topspeakers.title': {
    en: '🗣️ **Top speakers** — who I read the most on this server:',
    pt: '🗣️ **Tagarelas** — quem eu mais li neste servidor:',
  },
  'topspeakers.empty': {
    en: "I haven't read anyone's messages yet. Set up a read channel with `/setup`!",
    pt: 'Ainda não li mensagens de ninguém. Configura um canal de leitura com `/setup`!',
  },
  'topspeakers.line': {
    en: '{rank}. <@{user}> — **{count}** messages · 🔥 {streak}-day streak',
    pt: '{rank}. <@{user}> — **{count}** mensagens · 🔥 streak de {streak} dias',
  },

  // ── /serverstats (perk Premium; free vê um teaser) ────────────────────────
  'serverstats.title': {
    en: '📊 **Server stats**',
    pt: '📊 **Estatísticas do servidor**',
  },
  'serverstats.empty': {
    en: "No stats yet — I haven't read any messages or run any games here. Set up with `/setup`!",
    pt: 'Ainda sem estatísticas — não li mensagens nem corri jogos aqui. Configura com `/setup`!',
  },
  'serverstats.messages': {
    en: '🗣️ **{total}** messages read · **{speakers}** people',
    pt: '🗣️ **{total}** mensagens lidas · **{speakers}** pessoas',
  },
  'serverstats.topTalkers': {
    en: '**Top talkers:**',
    pt: '**Top tagarelas:**',
  },
  'serverstats.talkerLine': {
    en: '{rank}. <@{user}> — {count} msgs · 🔥 {streak}d',
    pt: '{rank}. <@{user}> — {count} msgs · 🔥 {streak}d',
  },
  'serverstats.streak': {
    en: '🔥 Longest active streak: **{days}** days',
    pt: '🔥 Maior streak ativo: **{days}** dias',
  },
  'serverstats.games': {
    en: '🎮 **{points}** game points · **{wins}** wins · **{players}** players',
    pt: '🎮 **{points}** pontos de jogos · **{wins}** vitórias · **{players}** jogadores',
  },
  'serverstats.topPlayers': {
    en: '**Top players:**',
    pt: '**Top jogadores:**',
  },
  'serverstats.playerLine': {
    en: '{rank}. <@{user}> — {points} pts · {wins} wins',
    pt: '{rank}. <@{user}> — {points} pts · {wins} vitórias',
  },
  'serverstats.upsell': {
    en: '🔒 That’s the free preview. **Premium** unlocks streaks, game stats and the full top 5 — see `/premium`.',
    pt: '🔒 Isto é a pré-visualização grátis. O **Premium** desbloqueia streaks, estatísticas de jogos e o top 5 completo — vê `/premium`.',
  },
  // Aviso de streak 🔥 (F1): primeira mensagem lida do dia. {user} = id (menção), {n} = dias.
  'streak.day': {
    en: '🔥 <@{user}> is on a **{n}-day** streak! Keep talking to keep it alive.',
    pt: '🔥 <@{user}> está numa streak de **{n} dias**! Continua a falar para a manteres.',
  },
  // Título do leaderboard automático (F2) que aparece de vez em quando no canal do /setup.
  'leaderboard.autoTitle': {
    en: '🏆 Top talkers in this server',
    pt: '🏆 Os que mais falam neste servidor',
  },

  // ── /premium & /redeem ─────────────────────────────────────────────────────
  'premium.title': {
    en: '💎 **Vozen Premium status**',
    pt: '💎 **Estado do Vozen Premium**',
  },
  'premium.lineServerActive': {
    en: '🖥️ **Server:** Premium until {date}',
    pt: '🖥️ **Servidor:** Premium até {date}',
  },
  'premium.lineServerFree': {
    en: '🖥️ **Server:** Free plan',
    pt: '🖥️ **Servidor:** plano Free',
  },
  'premium.lineUserActive': {
    en: '👤 **You (Plus):** active until {date}',
    pt: '👤 **Tu (Plus):** ativo até {date}',
  },
  'premium.lineUserFree': {
    en: '👤 **You (Plus):** not active',
    pt: '👤 **Tu (Plus):** inativo',
  },
  'premium.getHint': {
    en: 'Everything you use today stays free. Premium adds all 8 voice effects, voice cloning, 24/7 in-call, 50 personal pronunciations, /rizz and the premium games. Support: https://ko-fi.com/',
    pt: 'Tudo o que já usas continua grátis. O Premium acrescenta os 8 efeitos de voz, clone de voz, 24/7 na call, 50 pronúncias pessoais, /rizz e os jogos premium. Apoio: https://ko-fi.com/',
  },
  // Passe (compra de Premium): linha de estado + montra + fluxo activate/deactivate.
  'premium.linePass': {
    en: '🎟️ **Your Premium pass:** {used}/{total} licences in use · expires {date}',
    pt: '🎟️ **O teu passe Premium:** {used}/{total} licenças em uso · termina {date}',
  },
  'premium.passServers': {
    en: '↳ In use on: {servers}',
    pt: '↳ Em uso em: {servers}',
  },
  'premium.pitch': {
    en: "You don't have Premium yet. **Vozen Premium** (€3.99/mo for 3 servers, or €7.99/mo for 8) unlocks for the whole server: all 8 voice effects, voice cloning, 24/7 in-call, 50 personal pronunciations (vs 3), the /rizz command and the premium games (Word Chain, Wordle, Chess). **Vozen Plus** (€1.99/mo) gives you those perks personally, on any server.",
    pt: 'Ainda não tens Premium. O **Vozen Premium** (€3,99/mês para 3 servidores, ou €7,99/mês para 8) desbloqueia para o servidor inteiro: os 8 efeitos de voz, clone de voz, 24/7 na call, 50 pronúncias pessoais (vs 3), o comando /rizz e os jogos premium (Cadeia de Palavras, Termo, Xadrez). O **Vozen Plus** (€1,99/mês) dá-te essas perks só para ti, em qualquer servidor.',
  },
  'premium.buyHint': {
    en: '▶ **Get Premium:** {link}\nAfter buying, run `/premium activate` on the server you want.',
    pt: '▶ **Obter Premium:** {link}\nDepois de comprares, corre `/premium activate` no servidor que quiseres.',
  },
  'premium.confirmActivate': {
    en: 'Use **1 of your {total} Premium licences** on **this server**? You have **{used}** in use right now. You can free it later with `/premium deactivate` — the clock keeps running on the pass either way.',
    pt: 'Usar **1 das tuas {total} licenças Premium** **neste servidor**? Tens **{used}** em uso agora. Podes libertá-la depois com `/premium deactivate` — o relógio corre sempre no passe.',
  },
  'premium.confirmYes': {
    en: '💎 Use a licence',
    pt: '💎 Usar licença',
  },
  'premium.confirmNo': {
    en: 'Cancel',
    pt: 'Cancelar',
  },
  'premium.activateOk': {
    en: '✅ Premium is now active on **this server** until {date}. Licences: **{used}/{total}** in use.',
    pt: '✅ Premium ativo **neste servidor** até {date}. Licenças: **{used}/{total}** em uso.',
  },
  'premium.activateCancelled': {
    en: 'Cancelled — no licence was used.',
    pt: 'Cancelado — não gastaste nenhuma licença.',
  },
  'premium.activateTimeout': {
    en: 'Timed out — no licence was used.',
    pt: 'Tempo esgotado — não gastaste nenhuma licença.',
  },
  'premium.noPass': {
    en: "You don't have an active Premium pass. Get one and it lands on your account — then run `/premium activate` here.\n▶ {link}",
    pt: 'Não tens um passe Premium ativo. Compra um e ele cai na tua conta — depois corre `/premium activate` aqui.\n▶ {link}',
  },
  'premium.alreadyActive': {
    en: 'This server already has one of your Premium licences. Nothing to do.',
    pt: 'Este servidor já tem uma das tuas licenças Premium. Nada a fazer.',
  },
  'premium.noSeats': {
    en: 'All your **{total}** Premium licences are in use ({servers}). Free one with `/premium deactivate` there, then try again here.',
    pt: 'As tuas **{total}** licenças Premium estão todas em uso ({servers}). Liberta uma com `/premium deactivate` aí e tenta outra vez aqui.',
  },
  'premium.needManageGuild': {
    en: 'Activating Premium affects the whole server — only members with **Manage Server** can do it. Ask an admin.',
    pt: 'Ativar o Premium afeta o servidor inteiro — só membros com **Gerir Servidor** o podem fazer. Pede a um admin.',
  },
  'premium.deactivateOk': {
    en: "✅ Freed this server's Premium licence. Use it on another server with `/premium activate`.",
    pt: '✅ Libertaste a licença Premium deste servidor. Usa-a noutro servidor com `/premium activate`.',
  },
  'premium.deactivateNone': {
    en: 'This server has no Premium licence from you to free.',
    pt: 'Este servidor não tem nenhuma licença tua para libertar.',
  },
  'premium.thisServer': {
    en: 'this server',
    pt: 'este servidor',
  },
  // /vozengrant (owner-only)
  'grant.denied': {
    en: '⛔ This command is for the bot owner only.',
    pt: '⛔ Este comando é só para o dono do bot.',
  },
  'grant.okPremium': {
    en: '✅ Granted <@{user}> a **Premium pass** ({seats} licences) for **{days}** days — expires {date}. They activate it with `/premium activate`.',
    pt: '✅ Concedido a <@{user}> um **passe Premium** ({seats} licenças) por **{days}** dias — termina {date}. Ativa com `/premium activate`.',
  },
  'grant.okPlus': {
    en: '✅ Granted <@{user}> **Vozen Plus** for **{days}** days — expires {date}.',
    pt: '✅ Concedido a <@{user}> o **Vozen Plus** por **{days}** dias — termina {date}.',
  },
  // ── /gencode (owner) + /redeem (público) — códigos de presente ─────────────
  'gencode.done': {
    en: '✅ Generated **{count}** {plan} code(s), **{days}** days each. Share them privately:\n{list}',
    pt: '✅ Gerado(s) **{count}** código(s) {plan}, **{days}** dias cada. Partilha-os em privado:\n{list}',
  },
  'redeem.okPlus': {
    en: '🎁 Redeemed! You got **Vozen Plus** for **{days}** days — expires {date}.',
    pt: '🎁 Resgatado! Recebeste o **Vozen Plus** por **{days}** dias — termina {date}.',
  },
  'redeem.okPremium': {
    en: '🎁 Redeemed! You got a **Premium pass** ({seats} licences) for **{days}** days — expires {date}. Activate it in your server with `/premium activate`.',
    pt: '🎁 Resgatado! Recebeste um **passe Premium** ({seats} licenças) por **{days}** dias — termina {date}. Ativa-o no teu servidor com `/premium activate`.',
  },
  'redeem.notFound': {
    en: "❌ That code doesn't exist. Double-check it and try again.",
    pt: '❌ Esse código não existe. Confere e tenta outra vez.',
  },
  'redeem.used': {
    en: '❌ That code has already been redeemed.',
    pt: '❌ Esse código já foi resgatado.',
  },
  'redeem.expired': {
    en: '❌ That code has expired.',
    pt: '❌ Esse código expirou.',
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
    en: '(none yet — add one with /voice abbrev add)',
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
    en: "Blocked: {word}. I'll skip this word when reading, but still read the rest of the message.",
    pt: 'Bloqueado: {word}. Vou saltar esta palavra ao ler, mas leio o resto da mensagem na mesma.',
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
    en: 'Vozen will now announce **who spoke** before each message (e.g. "Alex said hi"). Turn off with `/config xsaid active:false`.',
    pt: 'O Vozen vai anunciar **quem falou** antes de cada mensagem (ex.: "Alex disse olá"). Desliga com `/config xsaid active:false`.',
  },
  'config.xsaidOff': {
    en: 'Vozen will **no longer** announce who spoke — it reads only the message.',
    pt: 'O Vozen **deixou de** anunciar quem falou — lê só a mensagem.',
  },
  'config.autojoinOn': {
    en: '✅ Auto-join **on** — Vozen will join your voice channel when you type in the TTS channel.',
    pt: '✅ Auto-entrada **ligada** — o Vozen entra no teu canal de voz quando escreves no canal de TTS.',
  },
  'config.autojoinOff': {
    en: 'Auto-join **off** — use `/join` to bring Vozen into voice.',
    pt: 'Auto-entrada **desligada** — usa `/join` para trazer o Vozen para a voz.',
  },
  'config.stayOn': {
    en: '✅ 24/7 in-call **on** — Vozen will stay in the voice channel even when it empties, and come back after restarts. 💎 Needs Premium to take effect (buy or `/redeem` a code, then `/premium activate`).',
    pt: '✅ 24/7 na call **ligado** — o Vozen fica no canal de voz mesmo quando esvazia, e volta após reinícios. 💎 Precisa de Premium para ter efeito (compra ou `/redeem` um código, depois `/premium activate`).',
  },
  'config.stayOff': {
    en: '24/7 in-call **off** — Vozen leaves when the voice channel empties (default).',
    pt: '24/7 na call **desligado** — o Vozen sai quando o canal de voz esvazia (padrão).',
  },
  'config.readBotsOn': {
    en: '✅ Vozen will now read messages from **other bots and webhooks** too.',
    pt: '✅ O Vozen passa a ler também mensagens de **outros bots e webhooks**.',
  },
  'config.readBotsOff': {
    en: 'Vozen will **ignore** other bots and webhooks (only real people are read).',
    pt: 'O Vozen **ignora** outros bots e webhooks (só lê pessoas reais).',
  },
  'config.textInVoiceOn': {
    en: '✅ Vozen will also read the **text chat inside its voice channel**.',
    pt: '✅ O Vozen também vai ler o **chat de texto dentro do canal de voz** onde está.',
  },
  'config.textInVoiceOff': {
    en: 'Vozen will **not** read the voice channel text chat (only the TTS channel).',
    pt: 'O Vozen **não** lê o chat de texto do canal de voz (só o canal de TTS).',
  },
  'config.antispamOn': {
    en: "✅ Anti-spam **on** — Vozen won't read spammed messages (mass word repetition or the same big message posted over and over).",
    pt: '✅ Anti-spam **ligado** — o Vozen não lê mensagens spamadas (repetição em massa da mesma palavra ou a mesma mensagem grande repetida).',
  },
  'config.antispamOff': {
    en: 'Anti-spam **off** — Vozen reads every message as usual.',
    pt: 'Anti-spam **desligado** — o Vozen lê todas as mensagens como habitual.',
  },
  'config.streaksOn': {
    en: '✅ Streak notices **on** — Vozen shows a 🔥 day-streak message the first time each person speaks each day.',
    pt: '✅ Avisos de streak **ligados** — o Vozen mostra a mensagem de streak 🔥 na primeira vez que cada pessoa fala em cada dia.',
  },
  'config.streaksOff': {
    en: 'Streak notices **off** — Vozen still tracks streaks (see `/topspeakers`) but stays quiet about them.',
    pt: 'Avisos de streak **desligados** — o Vozen continua a contar os streaks (vê `/topspeakers`) mas não os anuncia.',
  },
  'config.soundboardOn': {
    en: 'Soundboard **on** — anyone can play clips with `/sound`.',
    pt: 'Soundboard **ligado** — qualquer pessoa pode tocar clips com `/sound`.',
  },
  'config.soundboardOff': {
    en: 'Soundboard **off** — `/sound` is disabled on this server.',
    pt: 'Soundboard **desligado** — o `/sound` está desativado neste servidor.',
  },
  'config.greetOn': {
    en: "✅ I'll greet people by name when they join the voice channel.",
    pt: '✅ Vou saudar as pessoas pelo nome quando entrarem no canal de voz.',
  },
  'config.greetOff': {
    en: "🔇 I **won't** greet people when they join the voice channel.",
    pt: '🔇 **Não** vou saudar as pessoas quando entrarem no canal de voz.',
  },
  'config.greetLangSet': {
    en: '✅ Join greeting language set to **{language}**.',
    pt: '✅ Língua da saudação de entrada definida para **{language}**.',
  },
  // Sucesso do /config default-voice: lidera com o NOME AMIGAVEL ({name}) e mantem o
  // id cru ({model}) subtil/copy-pasteavel. Usada quando o utilizador nao tem voz
  // propria, por isso e a voz que os membros vao ouvir por defeito.
  'config.defaultVoiceSet': {
    en: '✅ Server default voice set to **{name}**. Members without their own voice will hear this one. (id: `{model}`)',
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
  'config.showAntispam': {
    en: 'Anti-spam: {value}',
    pt: 'Anti-spam: {value}',
  },
  'config.showSoundboard': {
    en: 'Soundboard (/sound): {value}',
    pt: 'Soundboard (/sound): {value}',
  },
  'config.showGreet': {
    en: 'Greet on join: {value} ({language})',
    pt: 'Saudar à entrada: {value} ({language})',
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
    en: 'I couldn\'t tell which channel to use. Pass a text channel in the "channel" option.',
    pt: 'Nao consegui identificar o canal. Indica um canal de texto na opcao "canal".',
  },
  'setup.channelWrongType': {
    en: 'The auto-read channel has to be a text channel (not a voice channel or a category). Pass one in the "channel" option.',
    pt: 'O canal de auto-leitura tem de ser um canal de texto do servidor (nao voz nem categoria). Indica um na opcao "canal".',
  },
  'setup.done': {
    en: '**All set — Vozen is ready.**',
    pt: '**Setup do Vozen concluido.**',
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
    en: "To fix what's missing: in your server settings open Vozen's role (or the channel's permissions) and enable the items marked with ❌.",
    pt: 'Para corrigir o que falta: nas definicoes do servidor abre o role do Vozen (ou as permissoes do canal) e ativa as permissoes marcadas com ❌.',
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
    en: '**Vozen stats**',
    pt: '**Estatisticas do Vozen**',
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
    en: 'That message has no text to read out loud.',
    pt: 'Essa mensagem não tem texto para ler em voz alta.',
  },

  // ── /uptime · /botstats (públicos) ────────────────────────────────────────
  'uptime.text': {
    en: '🟢 Vozen has been online for **{uptime}**.',
    pt: '🟢 O Vozen está online há **{uptime}**.',
  },
  'botstats.title': {
    en: '📊 **Vozen — stats**',
    pt: '📊 **Vozen — estatísticas**',
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
    en: "Vozen's invite link isn't set up yet (CLIENT_ID is missing). Let the bot admin know.",
    pt: 'O Vozen ainda nao tem o link de convite configurado (CLIENT_ID em falta). Avisa o admin do bot.',
  },
  'invite.link': {
    en: 'Add Vozen to your server:\n{url}',
    pt: 'Adiciona o Vozen ao teu servidor:\n{url}',
  },
  'vote.noClientId': {
    en: "Vozen's vote link isn't set up yet (CLIENT_ID is missing). Let the bot admin know.",
    pt: 'O Vozen ainda nao tem o link de voto configurado (CLIENT_ID em falta). Avisa o admin do bot.',
  },
  'vote.link': {
    en: 'Vote for Vozen (free, every 12h) and get **24h of Vozen Plus** for yourself 🎁 (once a month) — plus you help more people find it:\n{url}',
    pt: 'Vota no Vozen (grátis, a cada 12h) e ganha **24h de Vozen Plus** para ti 🎁 (1× por mês) — e ainda ajudas mais gente a encontrá-lo:\n{url}',
  },
  'invite.button': { en: 'Add Vozen', pt: 'Adicionar o Vozen' },
  'vote.button': { en: 'Vote on top.gg', pt: 'Votar no top.gg' },
  // Upsell curto (uma linha) para anexar onde um utilizador FREE já é upsellado.
  'vote.upsell': {
    en: '🗳️ No Plus? Vote for Vozen on top.gg → **24h of Plus free** (once a month): {url}',
    pt: '🗳️ Sem Plus? Vota no Vozen no top.gg → **24h de Plus grátis** (1× por mês): {url}',
  },
  // Estado no /premium quando a recompensa por voto está em cooldown ({date} = <t:..:R>).
  'vote.cooldownStatus': {
    en: '🗳️ You already claimed your vote reward — vote again for another **24h of Plus** {date}.',
    pt: '🗳️ Já ganhaste a recompensa por voto — podes ganhar mais **24h de Plus** {date}.',
  },

  // ── /help chrome (tudo o que NAO e a lista de comandos, que vem de commandDefs) ──
  // O titulo vira DESCRICAO do embed (embeds nao renderizam markdown no titulo),
  // por isso 'help.title' e texto simpatico sem `**…**`.
  'help.title': {
    en: 'Vozen — type it, hear it.',
    // Sem `pt`: a marca/tagline e a mesma em qualquer idioma (fallback a en).
  },
  'help.embedTitle': {
    en: 'Vozen — Commands',
    pt: 'Vozen — Comandos',
  },
  'help.intro': {
    en: 'Vozen reads your text aloud in voice channels — free neural voices, dozens of languages.',
    pt: 'O Vozen le o teu texto em voz alta nos canais de voz — vozes neurais gratis, dezenas de linguas.',
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
      '• /voice effect <effect> — voice effect (robot, echo… 💎 more with Premium)\n' +
      '• /voice clone record — clone YOUR OWN voice (💎 Premium, consent-first)\n' +
      '• /voice optout · /voice optin — turn auto-read off / on for you',
    pt:
      '• /voice set <model> — escolhe a tua voz · ex. /voice set pt_PT-tugao-medium\n' +
      '• /voice list — ve as vozes disponiveis\n' +
      '• /voice preview — ouve uma amostra da tua voz\n' +
      '• /voice reset — volta a voz por defeito\n' +
      '• /voice effect <efeito> — efeito de voz (robot, echo… 💎 mais com Premium)\n' +
      '• /voice clone record — clona a TUA voz (💎 Premium, com consentimento)\n' +
      '• /voice optout · /voice optin — desliga / liga a leitura automatica para ti',
  },
  'help.groupFun': {
    en: 'Fun',
    pt: 'Diversao',
  },
  'help.groupFunBody': {
    en:
      '• /joke — I tell a short joke (pick a language + optional laughter) · e.g. /joke English\n' +
      '• /rizz — I drop a pickup line (pick a language + optional rizz sound) · 💎 Premium\n' +
      '• /sound — I play a sound clip in the call · e.g. /sound name:airhorn (or /sound to list them)\n' +
      '• /laugh — I laugh out loud in your current voice\n' +
      '• /8ball · /fortune · /fact · /wyr — I answer/read out loud (and in chat)\n' +
      '• /birthday set — I wish you a happy birthday when you join on your day\n' +
      '• /topspeakers — who I read the most + daily streaks\n' +
      '• /serverstats — server stats: messages, top talkers, games · 💎 Premium (free preview)\n' +
      '• /game — play a minigame with the server (13 games!) · e.g. /game play, /game leaderboard',
    pt:
      '• /joke — conto uma piada curta (escolhe a lingua + risos opcionais) · ex. /joke Portuguese\n' +
      '• /rizz — mando uma cantada (escolhe a lingua + efeito rizz opcional) · 💎 Premium\n' +
      '• /sound — toco um clip de som na call · ex. /sound name:airhorn (ou /sound para os listar)\n' +
      '• /laugh — rio-me em voz alta na tua voz atual\n' +
      '• /8ball · /fortune · /fact · /wyr — respondo/leio em voz alta (e no chat)\n' +
      '• /birthday set — digo-te parabens quando entrares na call no teu dia\n' +
      '• /serverstats — estatísticas do servidor: mensagens, top tagarelas, jogos · 💎 Premium (pré-vê grátis)\n' +
      '• /game — joga um minijogo com o servidor (13 jogos!) · ex. /game play, /game leaderboard',
  },
  'help.groupAdmin': {
    en: 'Server admin (needs Manage Server)',
    pt: 'Admin do servidor (precisa de Gerir Servidor)',
  },
  'help.groupAdminBody': {
    en:
      '• /setup — guided one-step configuration · run this first\n' +
      '• /config — autoread, tts-channel, language, default-voice, blockword, pronunciation,\n' +
      '  rate-limit, role, max-chars, antispam, enabled · e.g. /config tts-channel #general\n' +
      '• /transcribe — 🎙️ live speech-to-text of consenting speakers (Premium)\n' +
      '• /stats — bot statistics',
    pt:
      '• /setup — configuracao guiada num passo · corre isto primeiro\n' +
      '• /config — autoread, tts-channel, language, default-voice, blockword, pronunciation,\n' +
      '  rate-limit, role, max-chars, antispam, enabled · ex. /config tts-channel #geral\n' +
      '• /transcribe — 🎙️ voz-para-texto ao vivo de quem consente (Premium)\n' +
      '• /stats — estatisticas do bot',
  },
  'help.groupMore': {
    en: 'More',
    pt: 'Mais',
  },
  'help.groupMoreBody': {
    en:
      '• /invite — add Vozen to another server\n' +
      '• /vote — vote for Vozen on top.gg\n' +
      '• /help — show this help',
    pt:
      '• /invite — adiciona o Vozen a outro servidor\n' +
      '• /vote — vota no Vozen no top.gg\n' +
      '• /help — mostra esta ajuda',
  },
  'help.footer': {
    en: 'New here? Run {command} to get started.',
    pt: 'Primeira vez? Corre {command} para comecares.',
  },
  // Linha de suporte/denúncia no /help (requisito da Política de Desenvolvedor do
  // Discord: o utilizador tem de ter uma forma de reportar problemas/violações).
  'help.support': {
    en: '🛟 Need help or want to report an issue? {url}',
    pt: '🛟 Precisas de ajuda ou queres reportar um problema? {url}',
  },

  // ── welcome embed (guildCreate) ────────────────────────────────────────────
  // Enviado UMA vez quando o Vozen entra num servidor novo. Guild nova nao tem
  // config, por isso o locale e sempre o default ('en'). Beginner-friendly: diz
  // o que o Vozen faz + como comecar (/setup) + onde ver a ajuda (/help).
  'welcome.title': {
    en: 'Thanks for adding Vozen! 👋',
    pt: 'Obrigado por adicionares o Vozen! 👋',
  },
  'welcome.description': {
    en: "Vozen reads your chat out loud in voice channels — type it, hear it.\n\n**Get started in one step:** run {setup} and I'll set up auto-read and join your voice channel.\n\nNeed the full command list? Run {help}.",
    pt: 'O Vozen le o teu chat em voz alta nos canais de voz — escreve e ouve.\n\n**Comeca num passo:** corre {setup} e eu configuro a auto-leitura e entro no teu canal de voz.\n\nQueres a lista completa de comandos? Corre {help}.',
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
    en: 'Vozen — type it, hear it.',
    // Sem `pt`: a tagline e a mesma em qualquer idioma (fallback a en).
  },
  // Diferenciador vs. o lider pago do mercado ("TTS Bot", ~€5/mes): a voz neural do
  // Vozen e gratuita e sem paywall. SO texto de posicionamento — NAO promete "mais
  // facil"/"invite-and-go" (o projeto e self-host; os docs avisam para nao o dizer).
  'welcome.tagline': {
    en: 'Natural neural voice — free forever, no paywall.',
    pt: 'Voz neural natural — grátis para sempre, sem paywall.',
  },

  // ── /game — minijogos ─────────────────────────────────────────────────────
  // Chrome do comando (arranque, paragem, leaderboard, lista) + cada jogo. `en` e a
  // fonte de verdade; `pt` traduzido. As outras 32 linguas caem em `en` via t().
  'game.start.needVoice': {
    en: 'This is a **voice game** — hop into a voice channel and run /join first, then start it.',
    pt: 'Este é um **jogo de voz** — entra num canal de voz e corre /join primeiro, depois começa.',
  },
  'game.start.alreadyActive': {
    en: 'A game is already running in <#{channel}>. Finish it (or use `/game stop`) before starting another.',
    pt: 'Já há um jogo a decorrer em <#{channel}>. Termina-o (ou usa `/game stop`) antes de começar outro.',
  },
  'game.start.premiumLocked': {
    en: '🔒 **{game}** is a Premium game (it costs real compute). See `/premium`.',
    pt: '🔒 **{game}** é um jogo Premium (custa computação a sério). Vê `/premium`.',
  },
  'game.start.started': {
    en: '🎮 Starting **{game}**! Watch the channel — good luck!',
    pt: '🎮 A começar **{game}**! Atenção ao canal — boa sorte!',
  },
  // Jogo iniciado numa THREAD descartável (servidores grandes: não afoga o canal).
  'game.start.startedThread': {
    en: '🎮 **{game}** started in <#{channel}> — join there! The thread self-deletes when the game ends.',
    pt: '🎮 **{game}** começou em <#{channel}> — joguem lá! A thread apaga-se sozinha quando o jogo acaba.',
  },
  // Resumo no canal-PAI quando um jogo em thread termina (a thread vai desaparecer).
  'game.thread.winner': {
    en: '🏆 {winner} won the game!',
    pt: '🏆 {winner} venceu o jogo!',
  },
  'game.thread.ended': {
    en: '🎮 The game ended.',
    pt: '🎮 A partida terminou.',
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
    en: '{rank} <@{user}> — **{points}** pts ({wins} wins)',
    pt: '{rank} <@{user}> — **{points}** pts ({wins} vitórias)',
  },
  // Resumo final partilhado por qualquer jogo (placar da partida).
  'game.finish.title': {
    en: '🏁 **Game over!** Final scores:',
    pt: '🏁 **Fim de jogo!** Pontuações finais:',
  },
  'game.finish.line': {
    en: '{rank} **{user}** — {points}',
    pt: '{rank} **{user}** — {points}',
  },
  'game.finish.noScores': {
    en: '🏁 Game over — nobody scored this time. Next time!',
    pt: '🏁 Fim de jogo — ninguém pontuou desta vez. Para a próxima!',
  },
  // FALADO (na voz da guild): o Vozen anuncia o vencedor em voz alta no fim.
  'game.finish.winnerVoice': {
    en: '{user} wins!',
    pt: '{user} venceu!',
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
    en: '⏱️ Time! That was **{language}**.',
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
  'game.math.round': {
    en: '🧮 Round {n}/{total} — **{a} {op} {b} = ?**',
    pt: '🧮 Ronda {n}/{total} — **{a} {op} {b} = ?**',
  },
  'game.math.correct': {
    en: '✅ **{user}** nailed it — the answer was **{answer}**!',
    pt: '✅ **{user}** acertou — o resultado era **{answer}**!',
  },
  'game.math.timeout': {
    en: '⏱️ Time! The answer was **{answer}**.',
    pt: '⏱️ Tempo! O resultado era **{answer}**.',
  },
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
  'game.skipCount.round': {
    en: '👂 Round {n}/{total} — which number did I skip?',
    pt: '👂 Ronda {n}/{total} — que número saltei?',
  },
  'game.skipCount.correct': {
    en: '✅ **{user}** caught it — I skipped **{answer}**!',
    pt: '✅ **{user}** apanhou — saltei o **{answer}**!',
  },
  'game.skipCount.timeout': {
    en: '⏱️ Time! I skipped **{answer}**.',
    pt: '⏱️ Tempo! Saltei o **{answer}**.',
  },

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
  'game.spelling.round': {
    en: '🗣️ Round {n}/{total} — write the word I say…',
    pt: '🗣️ Ronda {n}/{total} — escreve a palavra que eu disser…',
  },
  'game.spelling.correct': {
    en: '✅ **{user}** spelled **{word}** right!',
    pt: '✅ **{user}** escreveu **{word}** corretamente!',
  },
  'game.spelling.timeout': {
    en: '⏱️ Time! The word was **{word}**.',
    pt: '⏱️ Tempo! A palavra era **{word}**.',
  },
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
  'game.spellOut.round': {
    en: '🔤 Round {n}/{total} — listen to the letters…',
    pt: '🔤 Ronda {n}/{total} — ouve as letras…',
  },
  'game.spellOut.correct': {
    en: '✅ **{user}** got it — **{word}**!',
    pt: '✅ **{user}** acertou — **{word}**!',
  },
  'game.spellOut.timeout': {
    en: '⏱️ Time! It spelled **{word}**.',
    pt: '⏱️ Tempo! Soletrava **{word}**.',
  },

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
  'game.fastSpeech.round': {
    en: '⚡ Round {n}/{total} — here it comes, fast!',
    pt: '⚡ Ronda {n}/{total} — aí vai, depressa!',
  },
  'game.fastSpeech.correct': {
    en: '✅ **{user}** decoded it: “{phrase}”',
    pt: '✅ **{user}** decifrou: “{phrase}”',
  },
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
  'game.accentSwap.round': {
    en: '🌍 Round {n}/{total} — what word am I trying to say?',
    pt: '🌍 Ronda {n}/{total} — que palavra estou a tentar dizer?',
  },
  'game.accentSwap.correct': {
    en: '✅ **{user}** got it — **{word}**!',
    pt: '✅ **{user}** acertou — **{word}**!',
  },
  'game.accentSwap.timeout': {
    en: '⏱️ Time! The word was **{word}**.',
    pt: '⏱️ Tempo! A palavra era **{word}**.',
  },

  // ── Reflexos ──────────────────────────────────────────────────────────────
  'game.reflexes.name': { en: 'Reflexes', pt: 'Reflexos' },
  'game.reflexes.desc': {
    en: "I count down, then shout GO — first to type after that wins. Don't jump early!",
    pt: 'Faço a contagem e grito JÁ — o primeiro a escrever depois disso ganha. Não te precipites!',
  },
  'game.reflexes.intro': {
    en: "⚡ **Reflexes** — {rounds} rounds. When I shout **GO**, type anything as fast as you can. Type before GO and it's a false start!",
    pt: '⚡ **Reflexos** — {rounds} rondas. Quando eu gritar **JÁ**, escreve o que for o mais rápido possível. Escreveres antes do JÁ é falsa partida!',
  },
  'game.reflexes.ready': {
    en: '🚦 Round {n}/{total} — get ready…',
    pt: '🚦 Ronda {n}/{total} — preparados…',
  },
  // FALADO (na voz da guild): a contagem decrescente.
  'game.reflexes.countdown': { en: 'three… two… one…', pt: 'três… dois… um…' },
  'game.reflexes.go': { en: '🟢 **GO!!!**', pt: '🟢 **JÁ!!!**' },
  'game.reflexes.goVoice': { en: 'Go!', pt: 'Já!' },
  'game.reflexes.tooSoon': {
    en: '🔴 **{user}** jumped the gun — too soon!',
    pt: '🔴 **{user}** precipitou-se — cedo demais!',
  },
  'game.reflexes.win': {
    en: '⚡ **{user}** is the fastest! Point!',
    pt: '⚡ **{user}** foi o mais rápido! Ponto!',
  },
  'game.reflexes.tooSlow': {
    en: '😴 Nobody reacted in time. Next!',
    pt: '😴 Ninguém reagiu a tempo. Próxima!',
  },

  // ── Heads or Tails (cara ou coroa) ─────────────────────────────────────────
  'game.headsOrTails.name': { en: 'Heads or Tails', pt: 'Cara ou Coroa' },
  'game.headsOrTails.desc': {
    en: 'Call the coin flip — type heads or tails before I flip. Best guesser wins!',
    pt: 'Adivinha a moeda — escreve cara ou coroa antes de eu a atirar. Quem acertar mais ganha!',
  },
  'game.headsOrTails.intro': {
    en: '🪙 **Heads or Tails** — {rounds} rounds. Each round, type `heads` or `tails` before I flip the coin. 1 point per correct call!',
    pt: '🪙 **Cara ou Coroa** — {rounds} rondas. Em cada ronda, escreve `cara` ou `coroa` antes de eu atirar a moeda. 1 ponto por acerto!',
  },
  'game.headsOrTails.introVoice': {
    en: "Let's play heads or tails!",
    pt: 'Vamos jogar cara ou coroa!',
  },
  'game.headsOrTails.round': {
    en: '🪙 Round {n}/{total} — heads or tails? Type your call!',
    pt: '🪙 Ronda {n}/{total} — cara ou coroa? Escreve o teu palpite!',
  },
  'game.headsOrTails.roundVoice': { en: 'Heads… or tails?', pt: 'Cara… ou coroa?' },
  'game.headsOrTails.heads': { en: 'heads', pt: 'cara' },
  'game.headsOrTails.tails': { en: 'tails', pt: 'coroa' },
  'game.headsOrTails.resultVoice': { en: "It's {side}!", pt: 'Saiu {side}!' },
  'game.headsOrTails.winners': {
    en: "It's **{side}**! Point for: {users}",
    pt: 'Saiu **{side}**! Ponto para: {users}',
  },
  'game.headsOrTails.noWinners': {
    en: "It's **{side}**! Nobody called it — no points.",
    pt: 'Saiu **{side}**! Ninguém acertou — sem pontos.',
  },

  // ── Vozen Diz (Simon Says) ─────────────────────────────────────────────────
  'game.vozenSays.name': { en: 'Vozen Says', pt: 'Vozen Diz' },
  'game.vozenSays.desc': {
    en: "Only obey when the order starts with 'Vozen says'. Fall for a trap and you're caught!",
    pt: "Só obedeces quando a ordem começa por 'Vozen diz'. Cais numa ratoeira e és apanhado!",
  },
  'game.vozenSays.intro': {
    en: "🫡 **Vozen Says** — {rounds} orders. Do it ONLY if I start with **'Vozen says'**. Otherwise, don't move!",
    pt: "🫡 **Vozen Diz** — {rounds} ordens. Só cumpres se eu começar por **'Vozen diz'**. Caso contrário, não mexas!",
  },
  // FALADOS (na voz da guild): o prefixo da ordem e o verbo.
  'game.vozenSays.prefix': { en: 'Vozen says', pt: 'Vozen diz' },
  'game.vozenSays.verb': { en: 'type', pt: 'escrevam' },
  'game.vozenSays.real': {
    en: '🗣️ Round {n}/{total} — “{command}”',
    pt: '🗣️ Ronda {n}/{total} — «{command}»',
  },
  'game.vozenSays.trap': {
    en: '🗣️ Round {n}/{total} — “{command}”',
    pt: '🗣️ Ronda {n}/{total} — «{command}»',
  },
  'game.vozenSays.obeyed': {
    en: '✅ **{user}** obeyed first — point!',
    pt: '✅ **{user}** obedeceu primeiro — ponto!',
  },
  'game.vozenSays.caught': {
    en: "🔴 **{user}** — I didn't say Vozen says! Caught!",
    pt: '🔴 **{user}** — eu não disse Vozen diz! Apanhado!',
  },
  'game.vozenSays.nobody': {
    en: '😴 Nobody obeyed **{word}** in time. Next!',
    pt: '😴 Ninguém obedeceu a **{word}** a tempo. Próxima!',
  },
  'game.vozenSays.trapCleared': {
    en: '😌 It was a trap — well spotted, nobody fell for **{word}**.',
    pt: '😌 Era uma ratoeira — bem visto, ninguém caiu em **{word}**.',
  },

  // ── Roleta (Verdade ou Consequência) ──────────────────────────────────────
  'game.roulette.name': { en: 'Truth or Dare Roulette', pt: 'Roleta (Verdade ou Consequência)' },
  'game.roulette.desc': {
    en: 'I spin and read one truth-or-dare prompt out loud. Run it again for another.',
    pt: 'Rodo a roleta e leio um desafio (verdade ou consequência) em voz alta. Corre outra vez para outro.',
  },
  'game.roulette.header': { en: '🎯 **The wheel says…**', pt: '🎯 **A roleta diz…**' },

  // ── Forca (Hangman) ───────────────────────────────────────────────────────
  'game.hangman.name': { en: 'Hangman', pt: 'Forca' },
  'game.hangman.desc': {
    en: 'Guess the word one letter at a time — 6 misses and it’s over.',
    pt: 'Adivinha a palavra letra a letra — 6 erros e acabou.',
  },
  'game.hangman.intro': {
    en: '🪢 **Hangman** — type one letter at a time to guess the word. You can also type the whole word!',
    pt: '🪢 **Forca** — escreve uma letra de cada vez para adivinhar a palavra. Também podes tentar a palavra inteira!',
  },
  'game.hangman.hit': {
    en: '🟢 **{user}** found **{letter}**!',
    pt: '🟢 **{user}** encontrou o **{letter}**!',
  },
  'game.hangman.miss': {
    en: '🔴 **{user}** — no **{letter}**.',
    pt: '🔴 **{user}** — não há **{letter}**.',
  },
  'game.hangman.wrongLetters': { en: 'Wrong: {letters}', pt: 'Erradas: {letters}' },
  'game.hangman.win': {
    en: '🎉 **{user}** solved it — **{word}**!',
    pt: '🎉 **{user}** resolveu — **{word}**!',
  },
  'game.hangman.lose': {
    en: '💀 Out of tries! The word was **{word}**.',
    pt: '💀 Sem tentativas! A palavra era **{word}**.',
  },
  'game.hangman.idle': {
    en: '🕹️ Game paused (nobody playing). The word was **{word}**.',
    pt: '🕹️ Jogo terminado (ninguém a jogar). A palavra era **{word}**.',
  },

  // ── Termo/Wordle ──────────────────────────────────────────────────────────
  'game.wordle.name': { en: 'Wordle', pt: 'Termo' },
  'game.wordle.desc': {
    en: 'Guess the 5-letter word. 🟩 right spot, 🟨 wrong spot, ⬛ not in word. 💎 Premium.',
    pt: 'Adivinha a palavra de 5 letras. 🟩 sítio certo, 🟨 sítio errado, ⬛ não existe. 💎 Premium.',
  },
  'game.wordle.intro': {
    en: '🟩 **Wordle** — type a 5-letter word. You share {max} guesses. 🟩 right spot · 🟨 wrong spot · ⬛ not in word.',
    pt: '🟩 **Termo** — escreve uma palavra de 5 letras. Partilham {max} tentativas. 🟩 sítio certo · 🟨 sítio errado · ⬛ não existe.',
  },
  // Palpite errado (não-final): VERBO explícito para nunca se ler como derrota — se
  // alguém tiver o nick "Perdeste", "**Perdeste** — faltam 4" lia-se como resultado.
  'game.wordle.guess': {
    en: '🔤 **{user}** guessed — **{left}** guesses left',
    pt: '🔤 **{user}** tentou — faltam **{left}** tentativas',
  },
  // "Teclado" de estado: letras na palavra / descartadas (riscadas).
  'game.wordle.inWord': { en: '🟢 in word: {letters}', pt: '🟢 na palavra: {letters}' },
  'game.wordle.out': { en: '🚫 out: ~~{letters}~~', pt: '🚫 fora: ~~{letters}~~' },
  'game.wordle.win': {
    en: '🎉 **{user}** got it in {n} — **{word}**!',
    pt: '🎉 **{user}** acertou em {n} — **{word}**!',
  },
  'game.wordle.lose': {
    en: '💀 Out of guesses! The word was **{word}**.',
    pt: '💀 Sem tentativas! A palavra era **{word}**.',
  },
  'game.wordle.idle': {
    en: '🕹️ Game paused (nobody playing). The word was **{word}**.',
    pt: '🕹️ Jogo terminado (ninguém a jogar). A palavra era **{word}**.',
  },

  // ── Galo (tic-tac-toe) ────────────────────────────────────────────────────
  'game.tictactoe.name': { en: 'Tic-Tac-Toe', pt: 'Jogo do Galo' },
  'game.tictactoe.desc': {
    en: 'Two players — type a number 1-9 to place your mark. Three in a row wins.',
    pt: 'Dois jogadores — escreve um número 1-9 para marcar. Três em linha ganha.',
  },
  'game.tictactoe.intro': {
    en: '⭕ **Tic-Tac-Toe** — first two players to move are ❌ and ⭕ (❌ starts). Type a number 1-9 to play your cell.',
    pt: '⭕ **Jogo do Galo** — os dois primeiros a jogar são ❌ e ⭕ (❌ começa). Escreve um número 1-9 para jogar na casa.',
  },
  'game.tictactoe.turn': { en: 'Turn: **{mark}**', pt: 'Vez de: **{mark}**' },
  'game.tictactoe.notYourTurn': {
    en: '⏳ **{user}**, it’s **{mark}**’s turn.',
    pt: '⏳ **{user}**, é a vez do **{mark}**.',
  },
  'game.tictactoe.taken': {
    en: '🚫 Cell {cell} is taken — pick another.',
    pt: '🚫 A casa {cell} está ocupada — escolhe outra.',
  },
  'game.tictactoe.win': {
    en: '🎉 **{user}** ({mark}) wins!',
    pt: '🎉 **{user}** ({mark}) ganhou!',
  },
  'game.tictactoe.draw': { en: '🤝 It’s a draw!', pt: '🤝 Empate!' },
  'game.tictactoe.idle': {
    en: '🕹️ Game ended (nobody playing).',
    pt: '🕹️ Jogo terminado (ninguém a jogar).',
  },

  // ── Xadrez (💎 Premium) ────────────────────────────────────────────────────
  'game.chess.name': { en: 'Chess', pt: 'Xadrez' },
  'game.chess.desc': {
    en: 'Two players — real chess rules (check, castling, promotion…). Type a move like "e4" or "Nf3". 💎 Premium.',
    pt: 'Dois jogadores — regras reais de xadrez (xeque, roque, promoção…). Escreve uma jogada tipo "e4" ou "Nf3". 💎 Premium.',
  },
  'game.chess.intro': {
    en: '♟️ **Chess** — the first two players to move are White and Black (White starts). Type a move in algebraic notation ("e4", "Nf3", "O-O") or coordinates ("e2e4"). Type "resign" to give up.',
    pt: '♟️ **Xadrez** — os dois primeiros a jogar ficam com as brancas e as pretas (as brancas começam). Escreve uma jogada em notação algébrica ("e4", "Nf3", "O-O") ou por coordenadas ("e2e4"). Escreve "desisto" para desistir.',
  },
  'game.chess.white': { en: 'White', pt: 'brancas' },
  'game.chess.black': { en: 'Black', pt: 'pretas' },
  'game.chess.seats': {
    en: '⚪ White: **{white}** · ⚫ Black: **{black}**',
    pt: '⚪ Brancas: **{white}** · ⚫ Pretas: **{black}**',
  },
  'game.chess.turn': { en: '{move} — turn: **{color}**', pt: '{move} — vez de: **{color}**' },
  'game.chess.check': { en: '♟️ Check!', pt: '♟️ Xeque!' },
  'game.chess.notYourTurn': {
    en: '⏳ **{user}**, it’s **{color}**’s turn.',
    pt: '⏳ **{user}**, é a vez das **{color}**.',
  },
  'game.chess.illegalMove': {
    en: '🚫 "{move}" isn’t a legal move — try again.',
    pt: '🚫 "{move}" não é uma jogada válida — tenta outra vez.',
  },
  'game.chess.checkmate': {
    en: '🏆 Checkmate ({move})! **{user}** wins!',
    pt: '🏆 Xeque-mate ({move})! **{user}** ganhou!',
  },
  'game.chess.draw': { en: '🤝 It’s a draw ({move})!', pt: '🤝 Empate ({move})!' },
  'game.chess.resigned': {
    en: '🏳️ **{user}** resigned — **{winner}** wins!',
    pt: '🏳️ **{user}** desistiu — **{winner}** ganhou!',
  },
  'game.chess.idle': {
    en: '🕹️ Game ended (nobody playing).',
    pt: '🕹️ Jogo terminado (ninguém a jogar).',
  },

  // ── word-chain (cadeia de palavras) ───────────────────────────────────────
  'game.wordChain.name': { en: 'Word Chain', pt: 'Cadeia de Palavras' },
  'game.wordChain.descr': {
    en: 'Turn-based word chain in one language: say a word starting with the last letter of the previous one. 2 lives, no repeats, the clock speeds up. Pick the language with the `language` option. 💎 Premium.',
    pt: 'Cadeia de palavras por turnos numa língua: diz uma palavra que comece na última letra da anterior. 2 vidas, sem repetir, e o relógio acelera. Escolhe a língua na opção `language`. 💎 Premium.',
  },
  'game.wordChain.unavailable': {
    en: "⚠️ Word Chain isn't available in **{lang}** right now (missing word list).",
    pt: '⚠️ A Cadeia de Palavras não está disponível em **{lang}** de momento (falta a lista de palavras).',
  },
  'game.wordChain.lobby': {
    en: '🔗 **Word Chain** in **{lang}**! Type anything in this channel within **{seconds}s** to join.',
    pt: '🔗 **Cadeia de Palavras** em **{lang}**! Escreve qualquer coisa neste canal nos próximos **{seconds}s** para entrar.',
  },
  'game.wordChain.notEnough': {
    en: '😴 Not enough players joined (need at least 2). Game cancelled.',
    pt: '😴 Não entraram jogadores suficientes (mínimo 2). Jogo cancelado.',
  },
  'game.wordChain.begin': {
    en: '🚀 Starting! Players: {players}. Each word must start with the last letter of the one before.',
    pt: '🚀 A começar! Jogadores: {players}. Cada palavra tem de começar na última letra da anterior.',
  },
  'game.wordChain.turn': {
    en: '**{name}**, your turn! A **{lang}** word starting with **{letter}** — {hearts} · ⏱️ {seconds}s',
    pt: '**{name}**, é a tua vez! Uma palavra começada por **{letter}** — {hearts} · ⏱️ {seconds}s',
  },
  'game.wordChain.accepted': {
    en: '✅ **{word}** — next letter: **{letter}**',
    pt: '✅ **{word}** — próxima letra: **{letter}**',
  },
  'game.wordChain.bad.letter': {
    en: '↪️ It must start with **{letter}**.',
    pt: '↪️ Tem de começar por **{letter}**.',
  },
  'game.wordChain.bad.short': {
    en: '📏 Too short — at least **{min}** letters.',
    pt: '📏 Curta demais — pelo menos **{min}** letras.',
  },
  'game.wordChain.bad.repeated': {
    en: '🔁 That word was already used.',
    pt: '🔁 Essa palavra já foi usada.',
  },
  'game.wordChain.bad.word': {
    en: "📖 That's not in the dictionary.",
    pt: '📖 Não está no dicionário.',
  },
  'game.wordChain.bad.latin': {
    en: '🔤 Only letters A–Z count.',
    pt: '🔤 Só contam letras de A a Z.',
  },
  'game.wordChain.timeout': {
    en: '⏰ **{name}** ran out of time! {hearts} left.',
    pt: '⏰ **{name}** ficou sem tempo! Restam {hearts}.',
  },
  'game.wordChain.eliminated': { en: '💀 **{name}** is out!', pt: '💀 **{name}** está fora!' },
  'game.wordChain.winner': {
    en: '🏆 **{name}** wins the chain! ({chain} words)',
    pt: '🏆 **{name}** vence a cadeia! ({chain} palavras)',
  },

  // ── /game stats (por-utilizador) ──────────────────────────────────────────
  'game.stats.none': {
    en: "You haven't played any games yet. Try `/game play`!",
    pt: 'Ainda não jogaste nenhum jogo. Experimenta `/game play`!',
  },
  'game.stats.body': {
    en: '🎮 **Your stats** — **{points}** points · **{wins}** wins · {rank}',
    pt: '🎮 **As tuas estatísticas** — **{points}** pontos · **{wins}** vitórias · {rank}',
  },
  'game.stats.rank': { en: 'rank **#{rank}** of {total}', pt: 'posição **#{rank}** de {total}' },
  'game.stats.unranked': { en: 'not ranked yet', pt: 'ainda sem posição' },

  // ── /game play sem jogo: select beginner-friendly (plano v4) ───────────────
  'game.pickPrompt': {
    en: '🎮 Which game do you want to play? Pick one:',
    pt: '🎮 Que jogo queres jogar? Escolhe um:',
  },
  'game.pickPlaceholder': { en: 'Choose a game…', pt: 'Escolhe um jogo…' },
  'game.pickTimeout': {
    en: '⏰ No game picked — run `/game play` again when ready.',
    pt: '⏰ Nenhum jogo escolhido — corre `/game play` outra vez quando quiseres.',
  },

  // ── /pronunciation (dicionário PESSOAL, limites 3 Free / 50 Premium) ───────
  'pron.listHeader': {
    en: '🗣️ **Your pronunciations** ({count}/{limit}):',
    pt: '🗣️ **As tuas pronúncias** ({count}/{limit}):',
  },
  'pron.listEmpty': {
    en: 'You have none yet — add one with `/pronunciation add`.',
    pt: 'Ainda não tens nenhuma — adiciona com `/pronunciation add`.',
  },
  'pron.set': {
    en: '✅ Saved! When **you** type “{term}”, I will say “{replacement}”.',
    pt: '✅ Guardado! Quando **tu** escreveres “{term}”, eu digo “{replacement}”.',
  },
  'pron.removed': { en: '🗑️ Removed “{term}”.', pt: '🗑️ “{term}” removido.' },
  'pron.notFound': {
    en: 'You have no pronunciation for “{term}”. See yours with `/pronunciation list`.',
    pt: 'Não tens nenhuma pronúncia para “{term}”. Vê as tuas com `/pronunciation list`.',
  },
  'pron.empty': {
    en: 'The word and how to say it cannot be empty.',
    pt: 'A palavra e a forma de dizer não podem estar vazias.',
  },
  'pron.limitHit': {
    en: '🔒 You reached your limit of **{limit}** pronunciations. Remove one with `/pronunciation remove`.',
    pt: '🔒 Atingiste o teu limite de **{limit}** pronúncias. Remove uma com `/pronunciation remove`.',
  },
  'pron.limitUpsell': {
    en: '💎 Vozen Plus or Premium raises it to **50** → {url}',
    pt: '💎 O Vozen Plus ou Premium sobe o limite para **50** → {url}',
  },
  'pron.modalTitle': { en: 'Teach Vozen a pronunciation', pt: 'Ensina uma pronúncia ao Vozen' },
  'pron.modalTerm': { en: 'The word (as people type it)', pt: 'A palavra (como se escreve)' },
  'pron.modalSay': { en: 'How Vozen should say it', pt: 'Como o Vozen a deve dizer' },

  // ── /serverpronunciation (servidor, admin, cap 3) ──────────────────────────
  'spron.listHeader': {
    en: '🗣️ **Server pronunciations** ({count}/{limit}) — apply to everyone:',
    pt: '🗣️ **Pronúncias do servidor** ({count}/{limit}) — aplicam-se a todos:',
  },
  'spron.listEmpty': {
    en: 'None yet — add one with `/serverpronunciation add`.',
    pt: 'Ainda nenhuma — adiciona com `/serverpronunciation add`.',
  },
  'spron.set': {
    en: '✅ Saved for the whole server! “{term}” → “{replacement}”.',
    pt: '✅ Guardado para o servidor inteiro! “{term}” → “{replacement}”.',
  },
  'spron.removed': {
    en: '🗑️ Removed “{term}” from the server.',
    pt: '🗑️ “{term}” removido do servidor.',
  },
  'spron.notFound': {
    en: 'The server has no pronunciation for “{term}”.',
    pt: 'O servidor não tem nenhuma pronúncia para “{term}”.',
  },
  'spron.limitHit': {
    en: '🔒 The server reached its limit of **{limit}** pronunciations. Remove one with `/serverpronunciation remove`.',
    pt: '🔒 O servidor atingiu o limite de **{limit}** pronúncias. Remove uma com `/serverpronunciation remove`.',
  },
  'spron.modalTitle': { en: 'Server pronunciation', pt: 'Pronúncia do servidor' },
  'spron.modalSay': {
    en: 'How Vozen says it for everyone',
    pt: 'Como o Vozen a diz para todos',
  },

  // ── /randomizer (sorteio falado) ────────────────────────────────────────────
  'rand.selectPrompt': {
    en: '🎲 **Randomizer** — how many options do you want me to pick from?',
    pt: '🎲 **Randomizer** — entre quantas opções queres que eu escolha?',
  },
  'rand.selectPlaceholder': { en: 'Number of options…', pt: 'Número de opções…' },
  'rand.selectOption': { en: '{n} options', pt: '{n} opções' },
  'rand.filling': {
    en: '📝 Fill in the form that just opened!',
    pt: '📝 Preenche o formulário que acabou de abrir!',
  },
  'rand.modalTitle': { en: 'Randomizer — {amount} options', pt: 'Randomizer — {amount} opções' },
  'rand.modalOption': { en: 'Option {n}', pt: 'Opção {n}' },
  'rand.needTwo': {
    en: 'Give me at least 2 options separated by commas (e.g. "pizza, sushi").',
    pt: 'Dá-me pelo menos 2 opções separadas por vírgulas (ex.: "pizza, sushi").',
  },
  'rand.result': {
    en: 'Out of {count} options, I pick… **{winner}**!',
    pt: 'Entre {count} opções, escolho… **{winner}**!',
  },
  'rand.speak': { en: 'I pick… {winner}!', pt: 'Eu escolho… {winner}!' },
  'rand.notInVoice': {
    en: '_(join a voice channel with me and I will say it out loud next time)_',
    pt: '_(entra numa call comigo e para a próxima digo-o em voz alta)_',
  },
  'rand.timeout': {
    en: '⏰ Nothing picked — run `/randomizer` again when ready.',
    pt: '⏰ Nada escolhido — corre `/randomizer` outra vez quando quiseres.',
  },
};
