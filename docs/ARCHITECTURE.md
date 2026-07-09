# Arquitetura — Vozen

> Vozen — *type it, hear it.*

Este documento descreve a arquitetura real do Vozen tal como está no código (`src/`).
Para a spec de design original ver `docs/superpowers/specs/2026-06-30-tts-bot-design.md`;
quando este documento e a spec divergem, **este reflete o código** (a spec é histórica).

## Visão geral

O Vozen é um bot de TTS (text-to-speech) para Discord. Lê em voz alta o que os
utilizadores escrevem num canal de texto, num único processo Node.js + TypeScript.

O wedge (o cruzamento que os bots dominantes não servem bem) é:

- **Voz neural grátis** — síntese com Piper self-hosted (modelos `.onnx`), custo €0
  por caráter, sem paywall nas boas vozes.
- **Fiabilidade** — auto-reconexão à voz com backoff, síntese com timeout, handlers
  globais de erro, cap na fila e graceful shutdown. O bot não cai do canal nem crasha
  num erro de síntese.
- **Auto-leitura** — lê automaticamente um canal de texto configurado (além de `/tts`
  e menções/replies ao bot).
- **Deteção de língua por mensagem** — a língua da mensagem decide a voz: a voz preferida
  (guardada do utilizador > default da guild > .env) é honrada quando já está na língua
  detetada, senão escolhe-se uma voz correta dessa língua (evita ler texto com o sotaque
  errado).

Estado por servidor (guild): cada guild tem a sua sessão de voz (ligação + player +
fila FIFO) e a sua configuração persistida.

## Módulos

Cada pasta de `src/` e a sua responsabilidade (o que está realmente no código):

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| `config/index.ts` | Carrega e valida env (`DISCORD_TOKEN`, `CLIENT_ID`, caminhos do Piper, `DB_PATH`, defaults e limites, `TTS_ENGINE`, `OPENAI_API_KEY`, `MULTILINGUAL_SEGMENTS`). `loadConfig()` → `AppConfig`. | `dotenv`, `logging` |
| `store/db.ts` | Abre SQLite (`better-sqlite3`, modo WAL), cria tabelas via `CREATE TABLE IF NOT EXISTS` e aplica migrações de coluna idempotentes via `PRAGMA table_info`. | `better-sqlite3` |
| `store/userVoice.ts` | Voz por-utilizador (modelo + velocidade): get/set/reset. | `db` |
| `store/guildConfig.ts` | Config por-guild (canal TTS, autoread, default_voice, max_chars, rate, enabled, role): get/set/reset com defaults. | `db` |
| `store/blocklist.ts` | Blocklist de palavras por-guild: add/remove/get. | `db` |
| `store/pronunciation.ts` | Dois dicionários: **PESSOAL** (`/pronunciation`, `pronunciation_user`) — global por-user, só as mensagens do próprio, cap 3 Free / 50 Premium; e **SERVIDOR** (`/serverpronunciation`, `pronunciation`, admin) — toda a guild, cap fixo 3. No pipeline aplica-se pessoal→servidor (o termo do user ganha). `addUser/ServerPronunciation` impõem o cap. | `db` |
| `store/optout.ts` | Opt-out de auto-leitura por-utilizador: is/set/clear. | `db` |
| `store/userAbbrev.ts` | Abreviaturas pessoais por-utilizador, **GLOBAIS** (chave = só `user_id`, seguem o utilizador entre servidores): get/add/remove, cap de **10** por utilizador (`USER_ABBREV_CAP`), tabela `user_abbreviation`. | `db` |
| `store/guildConfig.ts` (locale) | Além dos campos acima, `guild_config.locale` (idioma da **interface**; default `'en'`). | `db`, `i18n` |
| `store/premium.ts` | Premium/Plus por EXPIRY (`premium_guild`/`premium_user`, source `kofi`/`discord`/`manual`). **Passe** por-utilizador (`premium_pass` = N licenças + fim absoluto; `premium_pass_activation` = servidores ativados): `grantGuildPass`/`activateSeat`/`deactivateSeat` — o relógio corre no passe, `isGuildPremium` vale por linha direta **ou** por ativação de passe não-expirado. `syncDiscordEntitlements` reconcilia os entitlements nativos. | `db` |
| `premium/kofi.ts` + `kofiWebhook.ts` | Webhook do Ko-fi (opção A): parse do payload + verificação de token + extração do Discord ID da mensagem + mapa produto→grant (premium/plus × mensal/anual) — puro; o servidor HTTP fino aplica via `grant*` (source `kofi`). Inerte sem `KOFI_WEBHOOK_TOKEN`. Compra → `/premium activate`. Vendas manuais/recuperação: `/vozengrant` (OWNER-ONLY, registado só na `OWNER_GUILD_ID`, gate pelo dono real da application). O MESMO servidor HTTP também roteia a API do Painel Premium (ver `statusApi.ts`) quando ativa. | `store/premium`, `premium/statusApi` |
| `premium/statusApi.ts` | API de leitura do Painel Premium do site (`GET /api/me/premium`): valida o Bearer token na Discord (`/users/@me`, cache curto token→identidade), monta o estado via `buildPremiumStatus` e resolve nomes de servidor pelo cache do cliente. Nunca por ID arbitrário — a identidade vem sempre do token. OPT-IN por `PREMIUM_API_ENABLED`; CORS restrito a `PREMIUM_API_ORIGIN`. Montada no servidor de `kofiWebhook.ts`. | `store/premium` |
| `i18n/index.ts` | `t(key, locale, params)` — tradução pura da UI com fallback (`locale` pedido → `en` → própria `key`) e interpolação de `{param}`. `DEFAULT_LOCALE='en'`, `SUPPORTED_LOCALES=['en','pt']`, `LOCALE_DISPLAY_NAMES` (endónimos das choices de `/config language`). | `i18n/catalog` |
| `i18n/catalog.ts` | Catálogo de strings da UI por chave, com `en` (base) e `pt`. | — |
| `textCleaning/clean.ts` | Funções puras de limpeza: URL→"link", menções `@id`/`#id`→nome, remover code blocks, colapsar repetições, truncar a `maxChars`. **Strip de emoji alargado**: pictograma base + componentes zero-width (ZWJ `U+200D`, VS16 `U+FE0F`, keycap `U+20E3`) + regional indicators (bandeiras). Nomes resolvidos via callbacks. | — |
| `textCleaning/abbreviations.ts` | `expandAbbreviations(text)`: expande gírias/abreviaturas de chat **só inglesas** (ex. `btw`→"by the way") para o TTS soar natural. Dicionário **EN-only, auditado anti-colisão** (cada chave re-vetada contra palavras comuns das línguas latinas suportadas), aplicado em **QUALQUER** língua (um "brb" é "brb" em qualquer chat — sem argumento de língua). Match por fronteira de palavra `\p{L}\p{N}`. `isAllEnglishAbbrev(text)`: true se todos os tokens (ignorando pontuação envolvente) forem chaves do dict — usado para `forceLang='eng'`. | — |
| `textCleaning/userAbbrev.ts` | `applyUserAbbrev(text, entries)`: aplica as abreviaturas **pessoais** do utilizador (termo → substituição). **Passagem única** (uma alternação sobre todos os termos, um só `replace` com replacer-função): corta cascata/re-expansão (anti billion-laughs DoS) e insere o replacement **literalmente** (sem interpretar `$&`/`$$`). Teto de saída (`MAX_ABBREV_OUTPUT`). | `store/userAbbrev` |
| `textCleaning/pronunciation.ts` | `applyPronunciation(texto, dict)`: aplica o dicionário de pronúncia da guild ao texto limpo. | — |
| `language/detect.ts` | `detectLang(texto)` → código ISO 639-3 ou `''`. Consulta primeiro o **léxico de saudações** (`greetings.ts`) e só depois o `franc`. `detectLangDetailed` devolve `{lang, confident}` (léxico=certo; franc=confiante se a margem topo–2.º ≥ 0.10) — usado pela memória de língua. | `franc`, `greetings` |
| `language/greetings.ts` | `lookupShortLang(texto)`: léxico curado de saudações/palavras curtas → ISO 639-3 (o franc falha em texto curto: "ola"→und). Baseado no TEXTO (serve `/tts` e canal). Tokens ambíguos deliberadamente fora. | — |
| `language/langMemory.ts` | Memória adaptativa por-`(guild,user)` (T3.2): `rememberLang`/`recallLang` com TTL 15 min. Guarda a última língua CONFIANTE; um fragmento curto ambíguo resolve para essa língua em vez do palpite incerto do franc (sem língua-base fixa). | — |
| `language/voiceMap.ts` | `pickVoiceForLang(lang, available, preferred)` (usado pelo `resolveSynth`): honra a voz **preferida** se já estiver na língua, senão escolhe um modelo dessa língua por prefixo de locale (fallback à preferida). `pickVoice(lang, available, fallback)`: variante que mapeia a língua ao modelo por prefixo, senão devolve o fallback. `LANG_TO_PREFIX` cobre todos os modelos Piper. `modelDisplayName`/`LOCALE_NAMES`: nome amigável (endónimo) por locale de modelo, para os dropdowns. `syntheticGttsModels(piperModels, neural)`: para cada locale de `LOCALE_NAMES` sem modelo Piper no disco injeta uma voz `{locale}-google-medium` no catálogo — as línguas aparecem (e falam via Google) mesmo com `./models` vazio. | — |
| `tts/engine.ts` | Interface `TTSEngine { synth(req): Promise<audioPath> }` e tipo `SynthRequest`. | — |
| `tts/factory.ts` | `createEngine(config, cache)` seleciona o motor (Piper default; Neural atrás de flag). `selectEngine(base, config, models, cache)` (puro) embrulha o base num `MultiSegmentEngine` **só** se a flag `multilingualSegments` estiver ON; senão devolve o `base` por identidade (`===`). | `config`, `cache`, `piper`, `neural`, `multiSegment` |
| `tts/circuitBreaker.ts` | `CircuitBreakerEngine` (decorator): protege o caminho **gTTS**. Após `GTTS_BREAKER_THRESHOLD` (3) falhas **consecutivas** (Google bloqueia/timeout ~15s), **abre** por `GTTS_BREAKER_COOLDOWN_MS` (60s) e serve o `fallback` (Piper) **direto**, sem tentar o gTTS — evita acumular stalls de 15s por mensagem. Meio-aberto após o cooldown: uma sondagem; sucesso fecha, falha reabre. Degradação graciosa (uma falha fechada também cai no fallback). Relógio injetável (testes). Ligado em `createPerUserEngine` (o gTTS entra como `primary`, o Piper como `fallback`). | `engine`, `logging` |
| `tts/piper.ts` | `PiperEngine`: sintetiza via Piper → WAV, timeout + erro/EPIPE, cache-first. **Pool persistente ON por defeito (T2.1):** reutiliza processos piper quentes (~4× no caso quente, curto 408→99 ms, áudio idêntico); falha → fallback one-shot; desliga com `PIPER_PERSISTENT=0`. Spawns limitados por **semáforo global** (`PIPER_MAX_CONCURRENCY`, default `núcleos-1`). | `cache`, `piperPool`, `semaphore`, `node:child_process` |
| `tts/piperPool.ts` | `PiperProcess` (1 processo piper longo; JSON no stdin → path no stdout em FIFO) + `PiperPool` (LRU keyed por `model\|length_scale`, `PIPER_WARM_VOICES` default 3, idle-timeout, evict/shutdown). | `logging` |
| `tts/semaphore.ts` | `Semaphore` FIFO assíncrono (`tryAcquire` síncrono / `acquire` espera): limita concorrência de spawns do Piper (T1.3). | — |
| `tts/neural.ts` | `NeuralEngine` (OpenAI tts-1) atrás de flag; síntese real é verificação ao vivo pendente. | `cache` |
| `tts/kokoroEngine.ts` | `KokoroEngine` (motor neural **OPT-IN** via sidecar `kokoro-onnx`, ONNX/CPU): gestão de processo espelhada do clone (warmup→ready c/ deadline, FIFO, timeouts) mas **LANÇA** em falha para o router cair no gTTS. `resolveKokoroCmd` auto-deteta `tools/kokoro-venv`+modelo. `KOKORO_VOICES` mapeia 7 línguas (en/es/fr/hi/it/pt/ja; `zh` precisa de `misaki[zh]`). Ligado em `createPerUserEngine` como `/voice set engine:Kokoro`, embrulhado num `RouterEngine([kokoro→gTTS])` — o gTTS de toda a gente fica inalterado. | `cache`, `router`, `spokenPhrases`, `node:child_process` |
| `tts/segments.ts` | `detectSegments(text)` (puro): parte o texto em segmentos de língua por **run de script** (Latin/Cyrillic/CJK/Arabic — fronteira fiável), deteta a língua de cada pedaço (só ≥ `MIN_DETECT_CHARS`), herda vizinhos e funde consecutivos. | `language/detect` |
| `tts/wavConcat.ts` | `concatWavs(wavs)` (puro): faz parse/valida WAVs PCM Piper (22050 Hz / mono / 16-bit), concatena com silêncio anti-clique entre segmentos e reconstrói o header RIFF. | — |
| `tts/multiSegment.ts` | `MultiSegmentEngine` (decorator de `TTSEngine`, **experimental**): para texto multi-língua, sintetiza cada segmento com a voz da sua língua e concatena os WAVs (namespace de cache `multiseg`). 0–1 segmento → delega no base intacto; qualquer erro → fallback single-voice. | `segments`, `wavConcat`, `voiceMap`, `cache` |
| `tts/cache.ts` | `AudioCache`: chave `sha1(texto+modelo+velocidade)`, namespaces por motor, eviction por mtime. Conta hits/misses em `metrics`. | `metrics`, `node:fs` |
| `voice/queue.ts` | `PlayQueue`: fila FIFO com cap (descarta ao exceder). | — |
| `voice/player.ts` | `GuildVoicePlayer` por guild: `VoiceConnection` + `AudioPlayer` + fila + `say()` (devolve boolean), `isActive()`, `skip()` (com `pendingSkip`), timer de inatividade + auto-reconexão com backoff. Espera `entersState(Ready)` antes de tocar. Ver **Fiabilidade** para os invariantes. | `@discordjs/voice`, `queue`, `metrics`, `logging` |
| `voice/aloneWatcher.ts` + `voice/rejoin.ts` + `store/voicePresence.ts` | **24/7 in-call (Premium)**. O `AloneWatcher` só expulsa quando o canal fica SÓ com bots; o dep `isPremium` faz servidores Premium ficarem na call **mesmo sozinhos**. A presença (canal) é persistida em `voice_presence` ao entrar (só Premium, best-effort em `createVoiceSession`) e apagada no `/leave` e no `guildDelete` — **não** no `removePlayer` nem no `shutdown`, para sobreviver a um restart/deploy. No `ClientReady`, `planRejoin` (puro) decide repor vs esquecer e o `index.ts` executa (rejoin silencioso, best-effort). | `store/premium`, `@discordjs/voice` |
| `voice/greeting.ts` | Saudação de voz ao ENTRAR na call: `isJoinIntoChannel(old,new,bot)` (puro — deteta entrada no canal do bot), `buildGreeting({locale,name,…})` → `SynthRequest` ("Olá {nome}" na língua escolhida + voz dessa língua; fallback inglês), `GREETINGS`/`GREET_LANGUAGE_CHOICES`/`GREET_LOCALES`. O gatilho vive no `VoiceStateUpdate` (client.ts `greetOnJoin`): humano entra → `player.say`. Config: `greet_on_join` (default ON), `greet_locale` (default 'en'). | `engine` |
| `voice/greetCooldown.ts` | `GreetCooldown.shouldGreet(guild,user)`: cooldown de 5 min (`GREET_COOLDOWN_MS`) por (guild,user) da saudação — spam de entrar/sair da call não repete o "Olá {nome}"/parabéns. Janela fixa (pedido suprimido não a estende), memória capada, relógio injetável. Consultado no `greetOnJoin`. | — |
| `health/ffmpeg.ts` | `checkFfmpeg(getInfo?)`: health-check do binário ffmpeg no boot (via `prism-media`), com veredicto `{ok,version}`/`{ok:false,error}` e mensagem acionável (comando de correção no Windows). Injetável para testes. | `prism-media` |
| `moderation/filter.ts` | `isBlocked(texto, blocklist)`: verifica a blocklist (pré-síntese). | — |
| `moderation/rateLimiter.ts` | `RateLimiter` (token bucket) por-utilizador; poda preguiçosa de buckets cheios+inativos acima de `MAX_BUCKETS` (5000). | — |
| `moderation/antispam.ts` | Anti-spam de leitura (opt-in por guild, `guild_config.antispam`, default OFF): `isRepetitionSpam(texto)` (puro — muitos tokens + baixa diversidade, ex. "POKEBOLAS ×39") e `DuplicateTracker.isDuplicateSpam(guild,autor,texto,now)` (mesma pessoa a repetir a mesma msg grande em <60s, janela fixa, memória capada). Gate no `messageHandler` antes do `lastSpeaker`/`bumpTalk`. | — |
| `commands/index.ts` | Definições dos slash commands (`commandDefs`) e `handleInteraction` (join, leave, tts, skip, **laugh**, **joke**, voice, config, stats, **help**, **setup**). Toda a UI passa por `t()`/`localeFor(deps, guildId)`. | tudo acima |
| `commands/messageHandler.ts` | `handleMessage`: pipeline de auto-leitura/menção/reply em `messageCreate`. | store, textCleaning, moderation, resolveSynth |
| `commands/resolveSynth.ts` | `resolveSynth`: resolve `SynthRequest` — a **língua da mensagem decide a voz** (`lang = forceLang \|\| detectLang(text)` + `pickVoiceForLang`). `ResolveSynthInput` inclui `forceLang` (código franc que força a língua da voz, ignorando `detectLang`; usado quando a mensagem é só gírias EN). | `language` |
| `commands/prepareSpeech.ts` | `prepareSpeech` (partilhado por `/tts` e leitura de canal): texto→`SynthRequest`. Deteção ON → parte **gírias EN** para um segmento em voz inglesa e deteta o resto por si (**vozes mistas**, ex. "isto funciona **btw**"); usa a **memória de língua** (`recentLang`) para desambiguar curtos e devolve `learnedLang` (deteção confiante) para o caller memorizar. Deteção OFF → voz fixa `singleVoice`. | `detect`, `voiceMap`, `abbreviations`, `pronunciation`, `langMemory` |
| `content/jokes.ts` | Catálogo de piadas curtas multilingue (35 línguas) + `JOKE_LANGUAGES` (autocomplete `idioma`), `jokeLangByKey`, `pickJoke(langKey, seed)` (puro/seeded). Usado pelo `/joke`. | — |
| `content/laughter.ts` | `laughterFor(prefix)`: riso localizado pela língua da voz (ex. cirílico para `ru_`), com fallback "hahaha". Usado pelo `/laugh` e pelo `/joke` (opção `risos`). | — |
| `games/manager.ts` | `GameManager`: **1 jogo ativo por guild** (lock; há 1 só ligação de voz por guild). `handleMessage` encaminha as mensagens do **canal do jogo** para a partida e devolve `true` (consumida → o `handleMessage` do TTS salta essa mensagem). Possui os timers da sessão (cancelados **sempre** no fim); persiste pontos no fim **normal** (`end`), descarta no fim **forçado** (`stop`/`endGuild`). Desacoplado de discord.js/SQLite via `GameEnv`. | `games/types` |
| `games/types.ts` | `Clock` (relógio + timers **injetáveis**, `systemClock`; testes deterministas), `GameContext` (`say`/`send`/`t`/`after`/`award`/`end` + `seed`/`locale`/`defaultVoice`), `Game`, `GameDefinition`, `GameEnv`. | — |
| `games/quizGame.ts` | Base `QuizGame` dos 7 jogos "voz → 1º a acertar" (loop de N rondas, timeout com **guarda de ronda**, placar local, resumo final `game.finish.*`). Cada jogo concreto só implementa `prepare`/`makeRound`/`emptyMessage`. | `games/types` |
| `games/finish.ts` | `bump`/`sendStandings`: placar partilhado pelos jogos que **não** assentam no `QuizGame` (Reflexos, Vozen Diz). | `games/types` |
| `games/*.ts` | Os 14 jogos: `guessLanguage`, `math`, `skipCount`, `spelling`, `spellOut`, `fastSpeech`, `accentSwap` (voz, sobre `QuizGame`); `reflexes`, `vozenSays`, `roulette` (timing/one-shot); `hangman`, `wordle`, `tictactoe`, `chess` (tabuleiro, texto — `chess` é 💎 Premium, `GameDefinition.premium`, tabuleiro em **application emojis** cburnett via `games/boardEmojis.ts` carregados no `ClientReady` para `GameEnv.boardEmojis`, com fallback ASCII; assets em `assets/chess/`, upload one-off via `tools/upload-app-emojis.mjs`; `wordle` desenha a grelha em tiles-emoji A–Z coloridos com fallback ANSI). Conteúdo *seeded* em `games/content/*`. | `games/*`, `content` |
| `games/index.ts` | Registo `GAME_DEFS` (16 jogos, incl. Heads or Tails) + `gameById`/`filterGameChoices` (autocomplete com nomes na língua do utilizador). Adicionar um jogo = criar o ficheiro e listá-lo aqui. `/game play` SEM jogo mostra um select menu (beginner-friendly). | todos os jogos |
| `commands/handlers/personal.ts` | Ferramentas pessoais: `/pronunciation add\|remove\|list` (dicionário individual, `add` vazio abre um MODAL) e `/randomizer` (sorteio falado: `amount` 2–5 → modal, `options` csv, ou select do nº quando corrido vazio; fala via `speakRawText`). | `store/pronunciation`, `store/premium`, `handlers/core` |
| `store/gameScore.ts` | Leaderboard SQLite (tabela `game_score`): `addPoints`/`addWin`/`persistGameScores` (transação: soma pontos + `+1 vitória` a quem mais pontuou), `getLeaderboard`/`getUserScore`/`getUserRank`. | `db` |
| `bot/welcome.ts` | `pickWelcomeChannel(guild)` + `buildWelcomeEmbed(locale)` (puros): escolha do canal e embed de boas-vindas no `guildCreate` (onboarding). | `i18n`, `discord.js` |
| `bot/client.ts` | `createClient` (intents + partials) e `bindEvents` (eventos do gateway + handlers globais `unhandledRejection`/`uncaughtException`; `guildCreate`→welcome; `guildDelete`→`handleGuildDelete`). | `discord.js`, `commands`, `welcome` |
| `bot/deps.ts` | Tipo `BotDeps` (injeção de dependências) e helpers `getPlayer`/`removePlayer`/`getLimiter`/`handleGuildDelete` (liberta limiter **e** player ao sair de uma guild). | — |
| `bot/registerCommands.ts` | Regista os slash commands na API REST do Discord. | `discord.js`, `commands` |
| `bot/shutdown.ts` | `shutdown` (destrói players + fecha DB, idempotente) e `installSignalHandlers` (SIGINT/SIGTERM). | `logging` |
| `logging/logger.ts` | Logger estruturado com níveis e timestamps (`LOG_LEVEL`). | — |
| `metrics.ts` | Singleton de contadores em memória (`messagesSpoken`, `cacheHits`, `cacheMisses`, `synthErrors`, `voiceDrops`, `voiceReconnects`, `votes`) + **latência de síntese** (`recordSynthMs` → janela deslizante; `synthCount`/`synthP50Ms`/`synthP95Ms` no snapshot, mostrados em `/stats`). | — |
| `index.ts` | Entry point: `loadConfig` → `initDb` → `AudioCache` → `createEngine` → descobre modelos → cria cliente + `BotDeps` → `bindEvents` + `installSignalHandlers` → regista comandos → login. | tudo acima |

### Comandos

`/help` (embed agrupado — Geral / Voz / Admin — derivado de `commandDefs`),
`/setup` (onboarding guiado, admin; auto-join via `joinUserVoice`),
`/join`, `/leave`, `/tts <texto>`, `/skip`,
`/laugh` (o Vozen ri na voz atual do utilizador; `content/laughter.ts`),
`/joke <idioma> <risos>` (piada curta na língua escolhida — `idioma` por autocomplete
sobre 35 línguas; `risos` acrescenta o riso da língua no fim; `content/jokes.ts`),
`/voice set|list|reset|optout|optin|preview`,
`/voice abbrev add|remove|list` (abreviaturas **pessoais** por-utilizador, **globais**,
cap 10; `store/userAbbrev.ts` + `textCleaning/userAbbrev.ts`, tabela `user_abbreviation`),
`/config` (admin: tts-channel, autoread, max-chars, rate-limit, role, enabled,
default-voice, **language**, show, reset, + subgrupos `blockword` e `pronunciation`),
`/game play|stop|list|leaderboard|stats` (minijogos — ver abaixo),
`/stats` (admin).

### Minijogos (`/game`)

**15 jogos** de grupo, geridos pelo `GameManager` (`src/games/`): **1 jogo ativo por
guild** de cada vez. O comando `/game play <jogo>` arranca (autocomplete com os nomes
na língua de quem invoca; jogos de **voz** exigem o bot numa call — `needsVoice`),
`/game stop` pára, `/game list` lista, `/game leaderboard` mostra o top do servidor e
`/game stats` as estatísticas do próprio (pontos, vitórias, posição). O leaderboard
persiste em `game_score` (`store/gameScore.ts`).

Cada partida corre numa **thread descartável** criada a partir do canal do `/game play`
(`games/thread.ts`): os palpites ficam contidos na thread (não afogam o canal em
servidores grandes), o `channelId` da sessão passa a ser o da thread e o `parentChannelId`
guarda o canal original. No fim, o **vencedor** (por pontos) é anunciado no **canal-pai**
(sobrevive) e a thread é apagada `THREAD_DELETE_DELAY_MS` depois. **Fallback**: canais sem
threads (voz/DM) ou sem permissões → joga no próprio canal, como antes. Os jogadores
respondem na thread (ou no canal, no fallback); o `GameManager.handleMessage` consome essas
mensagens (não são lidas em voz alta). Os timers usam um `Clock` injetável e são cancelados
no fim (o timer do apagar-thread é independente da sessão, um one-shot no clock). Uma saída de **voz** (`removePlayer` → `onVoiceLeft`) só termina
jogos que **precisam de voz** (um jogo de tabuleiro sobrevive a uma saída de voz não
relacionada); a guild ser **removida** (`handleGuildDelete` → `endGuild`) termina qualquer
jogo (sem leak). Famílias:
- **Voz → 1º a acertar** (base `QuizGame`): Adivinha a Língua, Matemática Falada,
  Contagem Sabotada, Ditado, Soletrado ao Contrário, Velocidade Estúpida, Sotaque Trocado.
- **Timing / one-shot**: Reflexos, Vozen Diz, Roleta (Verdade ou Consequência).
- **Tabuleiro (texto, jogadas por letra/palavra/número)**: Forca, Termo/Wordle, Galo —
  `needsVoice=false`, com timeout de inatividade (3 min).

Todo o texto passa por `t()` (chaves `game.*`; `en` fonte + `pt`); o conteúdo *seeded*
(bancos de palavras/frases/desafios) vive em `games/content/*`. No **fim** de cada
partida com vencedor, o Vozen anuncia-o **em voz alta** (`announceWinner`, chave
`game.finish.winnerVoice`) — on-brand; é no-op se o bot não estiver numa call (jogos
de tabuleiro sem voz).

A **interface está em inglês por defeito** (`guild_config.locale='en'`); cada guild
pode trocar com `/config language` (`en`/`pt`). Todo o texto de resposta passa por
`t(key, locale, params)` com `locale = localeFor(deps, guildId)` (default `'en'`,
inclusive em DMs).

## Fluxo mensagem → fala

Pipeline de auto-leitura em `commands/messageHandler.ts` (`handleMessage`), pela
**ordem real** do código:

1. **Ignorar**: mensagem de bot, sem guild, ou sem `content` → sai.
1b. **Minijogo ativo** (`deps.games?.handleMessage`): se houver um jogo `/game` a decorrer
   **no canal desta mensagem**, ela é entregue à partida (um potencial palpite) e o
   pipeline sai **sem** a ler em voz alta — as respostas dos jogadores não são TTS. Vem
   **antes** do rate-limit/auto-leitura (um palpite não gasta rate-limit nem exige canal
   configurado). As próprias mensagens do bot já foram filtradas no passo 1.
2. **Kill-switch da guild**: se `guild_config.enabled` for falso → sai.
3. **Trigger**: continua só se for canal de auto-leitura (`autoread` + canal igual a
   `tts_channel_id`), **ou** menção ao bot, **ou** reply ao bot. Senão → sai.
4. **Gating por role**: se a guild definiu `tts_role_id`, o autor tem de ter esse role
   (membro ausente → ignora). Aplica-se a canal **e** menção **e** reply.
5. **Opt-out por utilizador**: só silencia a leitura **passiva** do canal de
   auto-leitura. Uma menção/reply é ação explícita do utilizador e **não** é
   bloqueada pelo opt-out.
6. **Player ativo**: tem de existir um `GuildVoicePlayer` nesta guild (criado por
   `/join`). Senão → sai.
7. **Rate-limit por utilizador**: token bucket por guild (`ratePerMin`); se exceder → sai.
8. **Limpeza** (`cleanText`, inclui o strip de emoji alargado e truncar a `maxChars`).
9. **Guard de legibilidade**: exige pelo menos **uma letra ou número** (`/[\p{L}\p{N}]/u`).
   Cobre o vazio `''` e também texto que ficou só com pontuação, símbolos ou resíduo
   zero-width do strip de emoji (rede de segurança) → nesse caso descarta.
9b. **Anti-spam** (só se `guild_config.antispam` ON, default OFF): `isRepetitionSpam(cleaned)`
   OU `DuplicateTracker.isDuplicateSpam(...)` → descarta em silêncio (com log). **Antes** do
   `lastSpeaker`/`bumpTalk` — uma mensagem saltada não conta. Ver `moderation/antispam.ts`.
10. **Abreviaturas pessoais + gírias EN**: primeiro `applyUserAbbrev(cleaned, …)`
    (abreviaturas **pessoais** do utilizador, globais — precedência pessoal > embutido),
    depois `expandAbbreviations(personal)` — gírias **só inglesas**, aplicadas em qualquer
    língua (**sem** argumento de língua). Sobre o texto já com as abreviaturas pessoais
    calcula-se `forceLang = isAllEnglishAbbrev(personal) ? 'eng' : undefined`, que força a
    voz inglesa quando a mensagem é só gírias EN. Aplicado **depois** do `cleanText` e
    **antes** da pronúncia.
11. **Pronúncia** (`applyPronunciation`): aplicada **depois** das gírias e **antes** da
    blocklist, para que o texto realmente falado seja o que é verificado e guardado (a
    pronúncia opera sobre a palavra já expandida).
12. **Blocklist** (`isBlocked`) → se bater, bloqueia (sem falar).
13. **Resolver voz** (`resolveSynth`): ver "Precedência de voz" abaixo.
14. **`player.say(req)`** → enfileira FIFO e devolve **boolean** (ver invariantes); a
    síntese acontece no worker (`playNext`), não no `say`, para preservar a ordem de chegada.
15. **Worker (`playNext`)**: sintetiza → espera `entersState(Ready)` da ligação **antes**
    de `play()` (a 1.ª fala numa ligação lenta não vai para o vazio) → toca em sequência;
    `/skip` corta a atual (ou descarta o item na janela de síntese via `pendingSkip`).
16. **Inatividade**: sem fila e sem nada a tocar durante `inactivityMs` (default 5 min)
    → callback `onIdle` remove o player e sai do canal de voz.

`/tts` reutiliza o mesmo sub-pipeline (rate-limit → cleanText → guard L/N →
abreviaturas pessoais + gírias EN + `forceLang` → pronúncia → blocklist → resolveSynth →
`say`), **mas não** está sujeito a gating por role nem a opt-out: é ação explícita do
utilizador (escreve o comando), não leitura passiva. O `/voice preview` toca **uma voz
específica** (demo) e por isso constrói o `SynthRequest` diretamente, sem passar por
`resolveSynth`. `/tts` e `/voice preview` **usam** o boolean de `say()` para responder
com verdade — `tts.queued` se entrou na fila, `tts.busy` se a fila estava cheia; a
auto-leitura ignora o valor.

`/laugh` e `/joke` também têm rate-limit por-utilizador (mesmo limiter do `/tts`) e
constroem o `SynthRequest` diretamente (a língua é conhecida — a voz atual do user no
`/laugh`, a língua escolhida no `/joke` — não detetada).

### Precedência de voz (`resolveSynth` + `pickVoiceForLang`)

A **língua da mensagem decide a voz.** `resolveSynth` deteta **sempre** a língua
(`lang = forceLang || detectLang(text)`) e chama `pickVoiceForLang(lang, available,
preferred)` (confirmado em `resolveSynth.ts` e `voiceMap.ts`):

1. **Voz preferida** — por precedência: voz guardada do utilizador (`user_voice`) →
   `guild default_voice` (se não-vazio) → `.env DEFAULT_VOICE` → `'en_US-amy-medium'`.
2. A voz preferida é **honrada só quando já está na língua detetada**. Caso contrário
   escolhe-se uma **voz correta da língua detetada**; se não houver modelo para essa
   língua, cai-se na **preferida**.
3. **`forceLang`**: quando a mensagem é só gírias EN (`isAllEnglishAbbrev`), passa-se
   `forceLang='eng'` e a escolha usa essa língua em vez de `detectLang` (que em texto
   curto pode devolver `''`).

Consequência (design): uma voz fixa (ex. via `/voice set`) **nunca** acaba a ler texto
de outra língua — que sairia "a comer as palavras". A **velocidade** vem da voz guardada
do utilizador, senão é **sempre** `defaultSpeed` (`DEFAULT_SPEED`); o `default_voice` da
guild define apenas o modelo, nunca a velocidade.

## Decisões de arquitetura

- **(a) TypeScript CommonJS.** `package.json` **não** tem `"type": "module"`; os imports
  internos são **sem `.js`**; o `tsconfig.json` usa `module: NodeNext` /
  `moduleResolution: NodeNext` com `target ES2022`. Corre em Node no Windows e
  Dockeriza-se depois sem reescrever ESM.

- **(b) Engine factory.** `createEngine(config, cache)` escolhe o motor. **Piper é o
  default** (self-host, sem API key). O `NeuralEngine` (OpenAI tts-1) está atrás da flag
  `TTS_ENGINE=neural` **e** exige `OPENAI_API_KEY` — sem a key, `createEngine` falha
  rápido com mensagem clara. Um `TTS_ENGINE` inválido degrada para `piper` com aviso
  (o default seguro), em vez de crashar o arranque por um typo. Toda a app fala com a
  interface abstrata `TTSEngine`, por isso trocar de motor não toca no resto.

- **(c) A língua da mensagem decide a voz.** `resolveSynth` deteta **sempre** a língua
  (`forceLang || detectLang`) e usa `pickVoiceForLang`: a voz **preferida** (user-voice >
  `guild default_voice` > `.env DEFAULT_VOICE` > `'en_US-amy-medium'`) é honrada **só
  quando já está na língua detetada**; senão escolhe-se uma voz correta dessa língua
  (fallback à preferida). Ver "Precedência de voz" acima. Evita que uma voz fixa leia
  texto de outra língua (garble), sem perder a preferência explícita quando as línguas
  coincidem.

- **(d) Gating por canal e por role como checks standalone.** O trigger (canal de
  auto-leitura, menção, reply) e o gating por role são verificações separadas **após** o
  trigger, para que o gating se aplique a canal **+** menção **+** reply de forma
  uniforme. `/tts` e `/voice preview`, por serem ações explícitas, ficam fora do gating
  por role e do opt-out.

- **(e) Cache de áudio por namespace de motor + eviction por mtime.** A chave é
  `sha1(texto + modelo + velocidade)`. `AudioCache.withNamespace('piper'|'neural')`
  isola fisicamente as caches por motor (`<dir>/<namespace>/`), evitando que um motor
  sirva áudio produzido pelo outro. Ao exceder o número máximo de ficheiros (500),
  removem-se os mais antigos por `mtime` (LRU aproximado), excluindo sempre o recém-escrito.

- **(f) SQLite via `better-sqlite3` (WAL).** Zero setup, ideal para correr no PC. As
  tabelas novas são criadas com `CREATE TABLE IF NOT EXISTS` (não destrutivo) e as
  migrações de coluna são idempotentes: lê `PRAGMA table_info(...)` e só faz
  `ALTER TABLE ... ADD COLUMN` quando a coluna falta (no-op em DBs novas). O `initDb`
  envolve abrir + schema num try/catch que fecha o handle e dá mensagem clara em caso
  de ficheiro inválido/sem permissões.

- **(g) i18n com inglês por defeito e fallback que nunca crasha.** A interface é
  traduzida por `t(key, locale, params)`; `en` é a base e o default (`guild_config.locale`
  arranca em `'en'`). A cadeia de resolução é `locale pedido → en → própria key`, e os
  `{param}` ausentes ficam intactos — nenhuma chave em falta rebenta a resposta. Hoje
  `SUPPORTED_LOCALES = ['en','pt']`; adicionar um locale a esse array **sem** o mapear
  em `LOCALE_DISPLAY_NAMES` é erro de compilação (mapas nunca dessincronizam em silêncio).
  Nota: o idioma da **voz/TTS** é independente da língua da **interface** e não passa
  pelo i18n (`LOCALE_NAMES`/`modelDisplayName` em `voiceMap.ts` são um mapa distinto).

- **(h) Multi-segmento multi-língua atrás de flag (default OFF).** `selectEngine` é uma
  função **pura** que, só com `multilingualSegments` ON, embrulha o motor base num
  `MultiSegmentEngine`; com a flag OFF devolve o base por identidade (`===`), pelo que o
  caminho de síntese fica byte-a-byte o de hoje (voz única para a frase). O
  `MultiSegmentEngine` guarda o WAV combinado num namespace de cache separado (`multiseg`)
  e cai em single-voice perante qualquer erro — o player recebe sempre um WAV.

- **(i) Invariantes do player como contrato.** `say()` devolve boolean (só o sinal
  **síncrono** de fila-cheia/destruído); o worker espera `entersState(Ready)` antes de
  tocar; o handler `'error'` do `AudioPlayer` **não** drena a fila (evita double-fire com
  o `Idle`); `handleDisconnect` tem guard `destroyed` + `onIdle` identity-aware. Ver
  **Fiabilidade**.

## Fiabilidade

A robustez é requisito do wedge, não um extra:

- **Health-check do ffmpeg no arranque.** `checkFfmpeg()` faz `FFmpeg.getInfo()` (via
  `prism-media`) no boot e, se o binário faltar ou for da plataforma errada, dá um erro
  **acionável** logo no arranque (com o comando de correção no Windows) em vez de rebentar
  tarde na 1.ª reprodução com um `unhandledRejection` cru.
- **Esperar `Ready` antes de tocar.** No worker, `entersState(connection, Ready, 10s)`
  corre **depois** da síntese e **antes** de `play()`: numa ligação lenta / 1.ª fala a
  conexão pode ainda estar em `signalling`/`connecting` e tocar aí mandaria o áudio para
  o vazio (sem som, sem erro). Fica depois da síntese de propósito — a ligação estabelece
  **em paralelo** com a síntese (≈ `max(ready, synth)`, não a soma). Se não ficar Ready a
  tempo, o item é saltado (não toca para o vazio) e a fila continua.
- **Auto-reconexão à voz com backoff.** Ao entrar em
  `VoiceConnectionStatus.Disconnected`, o player espera a renegociação soft do gateway
  (`Signalling`/`Connecting` → `Ready`); se não recuperar, tenta `rejoin()` manual até
  3 vezes com espera crescente. Só destrói a ligação e sai se nada disto recuperar. Conta
  `voiceDrops` uma vez por episódio e `voiceReconnects` no sucesso (soft ou rejoin), nunca
  a dobrar (guard `destroyed || reconnecting`).
- **Piper com timeout.** Cada síntese tem timeout de 15s; ao exceder, mata o processo
  (`SIGKILL`) e rejeita. Erros de spawn, código de saída ≠ 0 e EPIPE no stdin são
  tratados sem crashar; o `EPIPE` (child morreu) é engolido pois o evento `close` trata.
- **Item de síntese saltado, nunca crasha.** Se `synth` falha, o `playNext` regista,
  incrementa `synthErrors` e avança para o próximo item da fila (sem crescimento de stack).
- **Handlers globais.** `bot/client.ts` (`bindEvents`) regista `unhandledRejection` e
  `uncaughtException` que registam e mantêm o processo vivo, além de `Events.Error` do
  gateway.
- **Cap na fila.** A `PlayQueue` tem cap (default 20); uma rajada de spam não enche a
  memória — ao exceder, descarta com aviso suave.
- **Permissões em falta.** `/join` verifica `Connect`/`Speak` **antes** de tocar num
  player existente e responde com mensagem clara em vez de falhar em silêncio.
- **Graceful shutdown.** `installSignalHandlers` liga SIGINT/SIGTERM a `shutdown`, que
  destrói todos os players (sai dos canais de voz), limpa o mapa e fecha a DB — tudo
  idempotente — antes de `process.exit(0)`.

### Invariantes do player (pós-review)

Estes cinco pontos são requisitos de correção do `GuildVoicePlayer`, não otimizações:

- **`say()` devolve boolean.** Reflete só o resultado **síncrono** de enfileirar: `true`
  se entrou na fila, `false` se foi descartado (player destruído **ou** fila no cap).
  `/tts` e `/voice preview` usam-no para não mentir "queued" quando nada entrou. O
  synth-skip e a ligação-não-Ready acontecem **depois** no worker e, por design, não se
  refletem aqui.
- **`/skip` na janela de síntese (`pendingSkip`).** Se o `/skip` chega enquanto o item
  está a ser sintetizado / a aguardar `Ready` (o `AudioPlayer` real ainda está `Idle`,
  logo `stop()` é no-op), marca-se `pendingSkip` para o worker **descartar** o item
  in-flight antes de tocar. A flag é reposta no início de cada iteração (anti-leak: um
  `/skip` só afeta o item atual).
- **Handler `'error'` não drena a fila.** No `@discordjs/voice` um erro do recurso a
  tocar emite `'error'` **e depois** transita para `Idle` (síncrono, mesmo recurso). Ter
  `playNext()` no `'error'` **e** no `Idle` drenava a fila 2× (double-fire), colapsando a
  flag `playing` e podendo disparar `onIdle` a meio da fala. O `Idle` faz o único drain.
- **Player morto não derruba o substituto.** `handleDisconnect` tem guard `destroyed`
  **antes** de `destroy()/onIdle()`: se um `/join`/`/leave` substituiu este player no slot
  da guild durante a janela de rejoin, o player velho sai em silêncio — o `onIdle` é keyed
  por guild e derrubaria o substituto acabado de criar (identity-aware).
- **`isActive()`** é um predicado leve (a tocar **ou** fila não-vazia) que o `/skip` lê
  **antes** de `skip()` para distinguir "nada a tocar" de "saltei", sem alterar estado.

### Gestão de memória

- **Sair de uma guild liberta tudo.** `handleGuildDelete` (ligado a `guildDelete`) apaga a
  entrada de `limiters` (e os buckets do `RateLimiter` dentro) **e** destrói/remove o
  player — evita crescimento de memória num uptime longo.
- **Poda de buckets do `RateLimiter`.** Acima de `MAX_BUCKETS` (5000), `allow()` faz uma
  poda preguiçosa de buckets cheios+inativos, protegendo contra crescimento por muitos
  utilizadores distintos.

## Observabilidade

- **Logger estruturado** (`logging/logger.ts`): níveis `debug < info < warn < error`,
  com timestamp ISO e nível por linha; o nível mínimo lê-se de `LOG_LEVEL` (default
  `info`). `warn`/`error` vão para `stderr`, o resto para `stdout`.
- **Métricas** (`metrics.ts`): singleton de contadores em memória — `messagesSpoken`,
  `cacheHits`, `cacheMisses`, `synthErrors`, `voiceDrops`, `voiceReconnects`, `votes`.
  O comando **`/stats`** (admin) expõe os contadores relevantes (incluindo quedas e
  reconexões de voz) junto com players ativos, nº de servidores e uptime do processo.

## Onboarding

- **Welcome no `guildCreate`.** Ao entrar num servidor novo, `bindEvents` liga
  `pickWelcomeChannel` (systemChannel se o bot puder escrever lá, senão o 1.º canal de
  texto enviável, senão nada — nunca crasha) + `buildWelcomeEmbed` (em `en`, pois uma
  guild nova não tem config) e envia **uma** vez um embed que aponta para `/setup` e
  `/help` e reforça o diferenciador (voz neural grátis, sem paywall).
- **`/setup` guiado** (admin): valida o canal de texto (`ViewChannel`+`SendMessages`,
  cada perm com o seu estado na checklist), faz auto-join do canal de voz do invocador
  (`joinUserVoice`) e explica os próximos passos.

## Developer experience (DX)

- **CI (GitHub Actions).** Corre `build` + `vitest` em Node 20 e 22 a cada push/PR;
  badge no README.
- **Smoke test de boot.** Monta as `BotDeps` reais (config, DB, cache, engine, cliente)
  sem ligar ao Discord — apanha regressões de arranque sem precisar de token.
- **Health-check do ffmpeg no boot** (ver Fiabilidade): falha cedo e com mensagem
  acionável se o binário faltar.

## Limitações conhecidas

- **Self-host ainda não é beginner-friendly.** Não há ainda caminho hosted /
  invite-and-go: o utilizador tem de instalar Node, dependências nativas, o binário do
  Piper e os modelos. Está no roadmap (P7).
- **Síntese real Piper/Neural depende de verificação ao vivo.** Os testes cobrem a
  seleção de motor e o pipeline; a geração real de WAV pelo Piper e a síntese do
  `NeuralEngine` (OpenAI) precisam de verificação ao vivo com o binário/credenciais.
- **`cacheKey` partilhado entre motores, mitigado por namespace.** A chave
  `sha1(texto+modelo+velocidade)` não inclui o motor; se um motor e outro produzissem a
  mesma chave, poderiam servir áudio errado. Isto está mitigado por
  `withNamespace('piper'|'neural')`, que separa fisicamente as caches.
- **A língua da mensagem pode sobrepor-se ao `default_voice` da guild.** Como a voz é
  escolhida pela língua detetada (`pickVoiceForLang`), uma guild que configurou
  `default_voice` só o vê aplicado quando esse modelo já está na língua da mensagem, ou
  quando não há modelo para a língua detetada (ver "Precedência de voz").
- **Multi-segmento só separa com confiança texto multi-script.** `detectSegments` parte
  por run de script (Latin/Cyrillic/CJK/Arabic). Duas línguas do **mesmo script** na
  mesma frase (ex. inglês + francês, ambos Latin) não são separadas de forma fiável — o
  texto tende a ficar num só segmento com a língua dominante. Além disso a feature está
  atrás da flag `MULTILINGUAL_SEGMENTS` (default OFF) e a síntese real depende de
  verificação ao vivo.
- **`cym`/`isl`/`ltz` dormentes na deteção.** `LANG_TO_PREFIX` mapeia galês, islandês e
  luxemburguês, mas o **franc v5** não os emite (sem modelo de trigramas), pelo que hoje
  não são detetados por mensagem. As entradas ficam (corretas e forward-compatible):
  `pickVoiceForLang` é independente do franc, por isso funcionam se a fonte de deteção mudar.
- **Gírias só inglesas.** `expandAbbreviations` usa um dicionário **EN-only** (auditado
  anti-colisão), aplicado em qualquer língua. Gírias não-inglesas (pt/es/fr/…) **não** são
  expandidas de propósito: uma expansão errada é pior que nenhuma, e cada chave EN foi
  re-vetada contra palavras comuns das línguas latinas suportadas para não disparar por
  engano. Abreviaturas específicas de outra língua ficam a cargo do utilizador via
  `/voice abbrev` (pessoais) ou do admin via `/config pronunciation` (por-guild).
- **Mobile.** Limitação estrutural da plataforma Discord (clientes móveis não tocam o
  áudio de bots de voz de forma fiável); fora de âmbito.
