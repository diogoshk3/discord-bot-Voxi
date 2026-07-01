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
  'join.joined': {
    en: "I'm in {channel} now — start talking and I'll read it out.",
    pt: 'Entrei em {channel} — escreve e eu leio em voz alta.',
  },
  'leave.left': {
    en: 'Left the voice channel. See you next time!',
    pt: 'Sai do canal de voz. Ate a proxima!',
  },
  'skip.notInVoice': {
    en: "I'm not in a voice channel right now.",
    pt: 'Nao estou num canal de voz de momento.',
  },
  'skip.skipped': {
    en: 'Skipped.',
    pt: 'Saltado.',
  },
  'tts.notInVoice': {
    en: "I'm not in a voice channel yet — run /join first.",
    pt: 'Ainda nao estou num canal de voz — usa /join primeiro.',
  },
  'tts.nothingToRead': {
    en: "There's nothing to read there.",
    pt: 'Nao ha nada para ler.',
  },
  'tts.nothingAfterClean': {
    en: "After tidying that up there was nothing left to read.",
    pt: 'Depois da limpeza nao sobrou nada para ler.',
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

  // ── /voice ────────────────────────────────────────────────────────────────
  'voice.unknownModel': {
    en: "I don't know that voice — check /voice list.",
    pt: 'Nao conheco essa voz — usa /voice list.',
  },
  'voice.set': {
    en: 'Voice set to {model} at {speed}×.',
    pt: 'Voz definida: {model} a {speed}×.',
  },
  'voice.listHeader': {
    en: 'Available voices:',
    pt: 'Vozes disponiveis:',
  },
  'voice.listEmpty': {
    en: '(none installed)',
    pt: '(nenhuma instalada)',
  },
  'voice.reset': {
    en: 'Your voice is back to the default.',
    pt: 'A tua voz voltou ao valor por defeito.',
  },
  'voice.optout': {
    en: "You won't be read automatically anymore. Run /voice optin to turn it back on.",
    pt: 'Ja nao seras lido automaticamente. Usa /voice optin para voltar.',
  },
  'voice.optin': {
    en: "You'll be read automatically again.",
    pt: 'Voltas a ser lido automaticamente.',
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
    pt: 'Ola, eu sou o Voxi. type it, hear it.',
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
  'config.channelSet': {
    en: 'Auto-read channel set to {channel}.',
    pt: 'Canal de auto-leitura: {channel}.',
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
  'config.defaultVoiceSet': {
    en: "Server default voice set to {model}.",
    pt: 'Voz default do servidor: {model}.',
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
    en: "I couldn't tell which channel to use. Pass a text channel in the \"canal\" option.",
    pt: 'Nao consegui identificar o canal. Indica um canal de texto na opcao "canal".',
  },
  'setup.channelWrongType': {
    en: 'The auto-read channel has to be a text channel (not a voice channel or a category). Pass one in the "canal" option.',
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
    en: "Here are the bot's commands.",
    pt: 'Aqui ficam os comandos do bot.',
  },
  'help.groupGeneral': {
    en: 'General',
    pt: 'Geral',
  },
  'help.groupVoice': {
    en: 'Voice (per user)',
    pt: 'Voz (por utilizador)',
  },
  'help.groupAdmin': {
    en: 'Admin (needs Manage Server)',
    pt: 'Admin (precisa de Gerir Servidor)',
  },
  'help.subcommands': {
    en: 'subcommands',
    pt: 'subcomandos',
  },
  'help.configNote': {
    en: '/config has several subcommands — use /config show to see the current config.',
    pt: '/config tem varios subcomandos — usa /config show para veres a config atual.',
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
  'welcome.footer': {
    en: 'Voxi — type it, hear it.',
    // Sem `pt`: a tagline e a mesma em qualquer idioma (fallback a en).
  },
};
