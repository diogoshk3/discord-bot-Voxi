# Arquitetura — Voxi

> Voxi — *type it, hear it.*

Este documento descreve a arquitetura real do Voxi tal como está no código (`src/`).
Para a spec de design original ver `docs/superpowers/specs/2026-06-30-tts-bot-design.md`;
quando este documento e a spec divergem, **este reflete o código** (a spec é histórica).

## Visão geral

O Voxi é um bot de TTS (text-to-speech) para Discord. Lê em voz alta o que os
utilizadores escrevem num canal de texto, num único processo Node.js + TypeScript.

O wedge (o cruzamento que os bots dominantes não servem bem) é:

- **Voz neural grátis** — síntese com Piper self-hosted (modelos `.onnx`), custo €0
  por caráter, sem paywall nas boas vozes.
- **Fiabilidade** — auto-reconexão à voz com backoff, síntese com timeout, handlers
  globais de erro, cap na fila e graceful shutdown. O bot não cai do canal nem crasha
  num erro de síntese.
- **Auto-leitura** — lê automaticamente um canal de texto configurado (além de `/tts`
  e menções/replies ao bot).
- **Deteção de língua por mensagem** — escolhe a voz por mensagem a partir da língua
  detetada, com a voz guardada do utilizador a ter prioridade.

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
| `store/pronunciation.ts` | Dicionário de pronúncia por-guild (termo → substituição): add/remove/get. | `db` |
| `store/optout.ts` | Opt-out de auto-leitura por-utilizador: is/set/clear. | `db` |
| `store/guildConfig.ts` (locale) | Além dos campos acima, `guild_config.locale` (idioma da **interface**; default `'en'`). | `db`, `i18n` |
| `i18n/index.ts` | `t(key, locale, params)` — tradução pura da UI com fallback (`locale` pedido → `en` → própria `key`) e interpolação de `{param}`. `DEFAULT_LOCALE='en'`, `SUPPORTED_LOCALES=['en','pt']`, `LOCALE_DISPLAY_NAMES` (endónimos das choices de `/config language`). | `i18n/catalog` |
| `i18n/catalog.ts` | Catálogo de strings da UI por chave, com `en` (base) e `pt`. | — |
| `textCleaning/clean.ts` | Funções puras de limpeza: URL→"link", menções `@id`/`#id`→nome, remover code blocks, colapsar repetições, truncar a `maxChars`. **Strip de emoji alargado**: pictograma base + componentes zero-width (ZWJ `U+200D`, VS16 `U+FE0F`, keycap `U+20E3`) + regional indicators (bandeiras). Nomes resolvidos via callbacks. | — |
| `textCleaning/abbreviations.ts` | `expandAbbreviations(text, lang)`: expande gírias/abreviaturas de chat por língua (ex. `btw`→"by the way") para o TTS soar natural. Dicionários curados por código franc (ISO 639-3) para 11 línguas + `VARIANT_ALIASES` (mesmo dict sob variantes de código). Match por fronteira de palavra `\p{L}\p{N}`. Língua desconhecida → texto intacto. | — |
| `textCleaning/pronunciation.ts` | `applyPronunciation(texto, dict)`: aplica o dicionário de pronúncia da guild ao texto limpo. | — |
| `language/detect.ts` | `detectLang(texto)` → código ISO 639-3 (ex. `por`, `eng`) ou `''` se desconhecido/curto. | `franc` |
| `language/voiceMap.ts` | `pickVoice(lang, available, fallback)`: mapeia a língua ao modelo Piper disponível por prefixo de locale; senão devolve o fallback. `LANG_TO_PREFIX` cobre todos os modelos Piper. `modelDisplayName`/`LOCALE_NAMES`: nome amigável (endónimo) por locale de modelo, para os dropdowns. | — |
| `tts/engine.ts` | Interface `TTSEngine { synth(req): Promise<audioPath> }` e tipo `SynthRequest`. | — |
| `tts/factory.ts` | `createEngine(config, cache)` seleciona o motor (Piper default; Neural atrás de flag). `selectEngine(base, config, models, cache)` (puro) embrulha o base num `MultiSegmentEngine` **só** se a flag `multilingualSegments` estiver ON; senão devolve o `base` por identidade (`===`). | `config`, `cache`, `piper`, `neural`, `multiSegment` |
| `tts/piper.ts` | `PiperEngine`: faz `spawn` do Piper → WAV, com timeout e tratamento de erro/EPIPE. Cache-first. | `cache`, `node:child_process` |
| `tts/neural.ts` | `NeuralEngine` (OpenAI tts-1) atrás de flag; síntese real é verificação ao vivo pendente. | `cache` |
| `tts/segments.ts` | `detectSegments(text)` (puro): parte o texto em segmentos de língua por **run de script** (Latin/Cyrillic/CJK/Arabic — fronteira fiável), deteta a língua de cada pedaço (só ≥ `MIN_DETECT_CHARS`), herda vizinhos e funde consecutivos. | `language/detect` |
| `tts/wavConcat.ts` | `concatWavs(wavs)` (puro): faz parse/valida WAVs PCM Piper (22050 Hz / mono / 16-bit), concatena com silêncio anti-clique entre segmentos e reconstrói o header RIFF. | — |
| `tts/multiSegment.ts` | `MultiSegmentEngine` (decorator de `TTSEngine`, **experimental**): para texto multi-língua, sintetiza cada segmento com a voz da sua língua e concatena os WAVs (namespace de cache `multiseg`). 0–1 segmento → delega no base intacto; qualquer erro → fallback single-voice. | `segments`, `wavConcat`, `voiceMap`, `cache` |
| `tts/cache.ts` | `AudioCache`: chave `sha1(texto+modelo+velocidade)`, namespaces por motor, eviction por mtime. Conta hits/misses em `metrics`. | `metrics`, `node:fs` |
| `voice/queue.ts` | `PlayQueue`: fila FIFO com cap (descarta ao exceder). | — |
| `voice/player.ts` | `GuildVoicePlayer` por guild: `VoiceConnection` + `AudioPlayer` + fila + `say()` (devolve boolean), `isActive()`, `skip()` (com `pendingSkip`), timer de inatividade + auto-reconexão com backoff. Espera `entersState(Ready)` antes de tocar. Ver **Fiabilidade** para os invariantes. | `@discordjs/voice`, `queue`, `metrics`, `logging` |
| `health/ffmpeg.ts` | `checkFfmpeg(getInfo?)`: health-check do binário ffmpeg no boot (via `prism-media`), com veredicto `{ok,version}`/`{ok:false,error}` e mensagem acionável (comando de correção no Windows). Injetável para testes. | `prism-media` |
| `moderation/filter.ts` | `isBlocked(texto, blocklist)`: verifica a blocklist (pré-síntese). | — |
| `moderation/rateLimiter.ts` | `RateLimiter` (token bucket) por-utilizador; poda preguiçosa de buckets cheios+inativos acima de `MAX_BUCKETS` (5000). | — |
| `commands/index.ts` | Definições dos slash commands (`commandDefs`) e `handleInteraction` (join, leave, tts, skip, voice, config, stats, **help**, **setup**). Toda a UI passa por `t()`/`localeFor(deps, guildId)`. | tudo acima |
| `commands/messageHandler.ts` | `handleMessage`: pipeline de auto-leitura/menção/reply em `messageCreate`. | store, textCleaning, moderation, resolveSynth |
| `commands/resolveSynth.ts` | `resolveSynth`: resolve `SynthRequest` (precedência de voz + deteção de língua). | `language` |
| `bot/welcome.ts` | `pickWelcomeChannel(guild)` + `buildWelcomeEmbed(locale)` (puros): escolha do canal e embed de boas-vindas no `guildCreate` (onboarding). | `i18n`, `discord.js` |
| `bot/client.ts` | `createClient` (intents + partials) e `bindEvents` (eventos do gateway + handlers globais `unhandledRejection`/`uncaughtException`; `guildCreate`→welcome; `guildDelete`→`handleGuildDelete`). | `discord.js`, `commands`, `welcome` |
| `bot/deps.ts` | Tipo `BotDeps` (injeção de dependências) e helpers `getPlayer`/`removePlayer`/`getLimiter`/`handleGuildDelete` (liberta limiter **e** player ao sair de uma guild). | — |
| `bot/registerCommands.ts` | Regista os slash commands na API REST do Discord. | `discord.js`, `commands` |
| `bot/shutdown.ts` | `shutdown` (destrói players + fecha DB, idempotente) e `installSignalHandlers` (SIGINT/SIGTERM). | `logging` |
| `logging/logger.ts` | Logger estruturado com níveis e timestamps (`LOG_LEVEL`). | — |
| `metrics.ts` | Singleton de contadores em memória (`messagesSpoken`, `cacheHits`, `cacheMisses`, `synthErrors`, `voiceDrops`, `voiceReconnects`, `votes`). | — |
| `index.ts` | Entry point: `loadConfig` → `initDb` → `AudioCache` → `createEngine` → descobre modelos → cria cliente + `BotDeps` → `bindEvents` + `installSignalHandlers` → regista comandos → login. | tudo acima |

### Comandos

`/help` (embed agrupado — Geral / Voz / Admin — derivado de `commandDefs`),
`/setup` (onboarding guiado, admin; auto-join via `joinUserVoice`),
`/join`, `/leave`, `/tts <texto>`, `/skip`,
`/voice set|list|reset|optout|optin|preview`,
`/config` (admin: tts-channel, autoread, max-chars, rate-limit, role, enabled,
default-voice, **language**, show, reset, + subgrupos `blockword` e `pronunciation`),
`/stats` (admin).

A **interface está em inglês por defeito** (`guild_config.locale='en'`); cada guild
pode trocar com `/config language` (`en`/`pt`). Todo o texto de resposta passa por
`t(key, locale, params)` com `locale = localeFor(deps, guildId)` (default `'en'`,
inclusive em DMs).

## Fluxo mensagem → fala

Pipeline de auto-leitura em `commands/messageHandler.ts` (`handleMessage`), pela
**ordem real** do código:

1. **Ignorar**: mensagem de bot, sem guild, ou sem `content` → sai.
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
10. **Gírias/abreviaturas** (`expandAbbreviations(cleaned, detectLang(cleaned))`):
    aplicada **depois** do `cleanText` (precisa de texto sem URLs/menções para detetar
    a língua) e **antes** da pronúncia.
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

`/tts` e `/voice preview` reutilizam o mesmo sub-pipeline
(rate-limit → cleanText → guard L/N → gírias → pronúncia → blocklist → resolveSynth →
`say`), **mas não** estão sujeitos a gating por role nem a opt-out: são ações explícitas
do utilizador (escreve o comando), não leitura passiva. Estes dois comandos **usam** o
boolean de `say()` para responder com verdade — `tts.queued` se entrou na fila,
`tts.busy` se a fila estava cheia; a auto-leitura ignora o valor.

### Precedência de voz (`resolveSynth` + `pickVoice`)

A escolha de voz segue esta ordem (confirmada em `resolveSynth.ts` e `voiceMap.ts`):

1. **Voz guardada do utilizador** (`user_voice`): se existir, usa o seu **modelo e
   velocidade** e a deteção de língua **não** corre.
2. Sem voz de utilizador: deteta a língua (`detectLang`) e, via `pickVoice`, usa o
   **modelo da língua detetada se existir** em `availableModels`.
3. Só quando a língua é desconhecida ou não há modelo correspondente é que cai no
   **fallback** = `guild default_voice` (se não-vazio) → `.env DEFAULT_VOICE` →
   `'en_US-amy-medium'`.

Subtileza: a deteção de língua pode **sobrepor-se** ao `default_voice` da guild —
o default só é usado quando nenhuma língua corresponde. A **velocidade** vem da voz
guardada do utilizador, senão é **sempre** `defaultSpeed` (`DEFAULT_SPEED`); o
`default_voice` da guild define apenas o modelo, nunca a velocidade.

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

- **(c) Precedência de voz.** user-voice (modelo+velocidade) > modelo da língua detetada
  (se disponível) > `guild default_voice` (se não-vazio) > `.env DEFAULT_VOICE` >
  `'en_US-amy-medium'`. Ver "Precedência de voz" acima. Mantém a escolha automática por
  mensagem sem perder a preferência explícita do utilizador.

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
- **Deteção de língua pode sobrepor-se ao `default_voice` da guild.** Como `pickVoice`
  prefere o modelo da língua detetada, uma guild que configurou `default_voice` só o vê
  aplicado quando nenhuma língua corresponde (ver "Precedência de voz").
- **Multi-segmento só separa com confiança texto multi-script.** `detectSegments` parte
  por run de script (Latin/Cyrillic/CJK/Arabic). Duas línguas do **mesmo script** na
  mesma frase (ex. inglês + francês, ambos Latin) não são separadas de forma fiável — o
  texto tende a ficar num só segmento com a língua dominante. Além disso a feature está
  atrás da flag `MULTILINGUAL_SEGMENTS` (default OFF) e a síntese real depende de
  verificação ao vivo.
- **`cym`/`isl`/`ltz` dormentes na deteção.** `LANG_TO_PREFIX` mapeia galês, islandês e
  luxemburguês, mas o **franc v5** não os emite (sem modelo de trigramas), pelo que hoje
  não são detetados por mensagem. As entradas ficam (corretas e forward-compatible):
  `pickVoice` é independente do franc, por isso funcionam se a fonte de deteção mudar.
- **Dicionários de gírias parciais.** `expandAbbreviations` cobre 11 línguas; várias
  (ex. ucraniano) ficam **vazias de propósito** (curadoria pendente de um falante — uma
  expansão errada é pior que nenhuma). Chinês/árabe/persa/suaíli não têm dict e os
  `VARIANT_ALIASES` estão prontos mas sem apontar para nada hoje.
- **Mobile.** Limitação estrutural da plataforma Discord (clientes móveis não tocam o
  áudio de bots de voz de forma fiável); fora de âmbito.
