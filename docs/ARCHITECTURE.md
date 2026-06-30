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
| `config/index.ts` | Carrega e valida env (`DISCORD_TOKEN`, `CLIENT_ID`, caminhos do Piper, `DB_PATH`, defaults e limites, `TTS_ENGINE`, `OPENAI_API_KEY`). `loadConfig()` → `AppConfig`. | `dotenv`, `logging` |
| `store/db.ts` | Abre SQLite (`better-sqlite3`, modo WAL), cria tabelas via `CREATE TABLE IF NOT EXISTS` e aplica migrações de coluna idempotentes via `PRAGMA table_info`. | `better-sqlite3` |
| `store/userVoice.ts` | Voz por-utilizador (modelo + velocidade): get/set/reset. | `db` |
| `store/guildConfig.ts` | Config por-guild (canal TTS, autoread, default_voice, max_chars, rate, enabled, role): get/set/reset com defaults. | `db` |
| `store/blocklist.ts` | Blocklist de palavras por-guild: add/remove/get. | `db` |
| `store/pronunciation.ts` | Dicionário de pronúncia por-guild (termo → substituição): add/remove/get. | `db` |
| `store/optout.ts` | Opt-out de auto-leitura por-utilizador: is/set/clear. | `db` |
| `textCleaning/clean.ts` | Funções puras de limpeza: URL→"link", emojis saltados, `@id`→nome, `#id`→nome, remover code blocks, colapsar repetições, truncar a `maxChars`. Nomes resolvidos via callbacks. | — |
| `textCleaning/pronunciation.ts` | `applyPronunciation(texto, dict)`: aplica o dicionário de pronúncia da guild ao texto limpo. | — |
| `language/detect.ts` | `detectLang(texto)` → código ISO 639-3 (ex. `por`, `eng`) ou `''` se desconhecido/curto. | `franc` |
| `language/voiceMap.ts` | `pickVoice(lang, available, fallback)`: mapeia a língua ao modelo Piper disponível por prefixo de locale; senão devolve o fallback. | — |
| `tts/engine.ts` | Interface `TTSEngine { synth(req): Promise<audioPath> }` e tipo `SynthRequest`. | — |
| `tts/factory.ts` | `createEngine(config, cache)`: seleciona o motor (Piper default; Neural atrás de flag). | `config`, `cache`, `piper`, `neural` |
| `tts/piper.ts` | `PiperEngine`: faz `spawn` do Piper → WAV, com timeout e tratamento de erro/EPIPE. Cache-first. | `cache`, `node:child_process` |
| `tts/neural.ts` | `NeuralEngine` (OpenAI tts-1) atrás de flag; síntese real é verificação ao vivo pendente. | `cache` |
| `tts/cache.ts` | `AudioCache`: chave `sha1(texto+modelo+velocidade)`, namespaces por motor, eviction por mtime. Conta hits/misses em `metrics`. | `metrics`, `node:fs` |
| `voice/queue.ts` | `PlayQueue`: fila FIFO com cap (descarta ao exceder). | — |
| `voice/player.ts` | `GuildVoicePlayer` por guild: `VoiceConnection` + `AudioPlayer` + fila + `skip()` + timer de inatividade + auto-reconexão com backoff. | `@discordjs/voice`, `queue`, `metrics`, `logging` |
| `moderation/filter.ts` | `isBlocked(texto, blocklist)`: verifica a blocklist (pré-síntese). | — |
| `moderation/rateLimiter.ts` | `RateLimiter` (token bucket) por-utilizador. | — |
| `commands/index.ts` | Definições dos slash commands (`commandDefs`) e `handleInteraction` (join, leave, tts, skip, voice, config, stats). | tudo acima |
| `commands/messageHandler.ts` | `handleMessage`: pipeline de auto-leitura/menção/reply em `messageCreate`. | store, textCleaning, moderation, resolveSynth |
| `commands/resolveSynth.ts` | `resolveSynth`: resolve `SynthRequest` (precedência de voz + deteção de língua). | `language` |
| `bot/client.ts` | `createClient` (intents + partials) e `bindEvents` (eventos do gateway + handlers globais `unhandledRejection`/`uncaughtException`). | `discord.js`, `commands` |
| `bot/deps.ts` | Tipo `BotDeps` (injeção de dependências) e helpers `getPlayer`/`removePlayer`/`getLimiter`. | — |
| `bot/registerCommands.ts` | Regista os slash commands na API REST do Discord. | `discord.js`, `commands` |
| `bot/shutdown.ts` | `shutdown` (destrói players + fecha DB, idempotente) e `installSignalHandlers` (SIGINT/SIGTERM). | `logging` |
| `logging/logger.ts` | Logger estruturado com níveis e timestamps (`LOG_LEVEL`). | — |
| `metrics.ts` | Singleton de contadores em memória (`messagesSpoken`, `cacheHits`, `cacheMisses`, `synthErrors`). | — |
| `index.ts` | Entry point: `loadConfig` → `initDb` → `AudioCache` → `createEngine` → descobre modelos → cria cliente + `BotDeps` → `bindEvents` + `installSignalHandlers` → regista comandos → login. | tudo acima |

### Comandos

`/join`, `/leave`, `/tts <texto>`, `/skip`,
`/voice set|list|reset|optout|optin|preview`,
`/config` (admin: tts-channel, autoread, max-chars, rate-limit, role, enabled,
default-voice, show, reset, + subgrupos `blockword` e `pronunciation`),
`/stats` (admin).

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
8. **Limpeza** (`cleanText`, inclui truncar a `maxChars`) → se ficar vazio → descarta.
9. **Pronúncia** (`applyPronunciation`): aplicada **depois** do `cleanText` e **antes**
   da blocklist, para que o texto realmente falado seja o que é verificado e guardado.
10. **Blocklist** (`isBlocked`) → se bater, bloqueia (sem falar).
11. **Resolver voz** (`resolveSynth`): ver "Precedência de voz" abaixo.
12. **`player.say(req)`** → enfileira FIFO; a síntese acontece no worker (`playNext`),
    não no `say`, para preservar a ordem de chegada.
13. **Fila → player**: toca em sequência; `/skip` corta a atual.
14. **Inatividade**: sem fila e sem nada a tocar durante `inactivityMs` (default 5 min)
    → callback `onIdle` remove o player e sai do canal de voz.

`/tts` e `/voice preview` reutilizam o mesmo sub-pipeline
(rate-limit → cleanText → pronúncia → blocklist → resolveSynth → `say`), **mas não**
estão sujeitos a gating por role nem a opt-out: são ações explícitas do utilizador
(escreve o comando), não leitura passiva.

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

## Fiabilidade

A robustez é requisito do wedge, não um extra:

- **Auto-reconexão à voz com backoff.** Ao entrar em
  `VoiceConnectionStatus.Disconnected`, o player espera a renegociação soft do gateway
  (`Signalling`/`Connecting` → `Ready`); se não recuperar, tenta `rejoin()` manual até
  3 vezes com espera crescente. Só destrói a ligação e sai se nada disto recuperar.
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

## Observabilidade

- **Logger estruturado** (`logging/logger.ts`): níveis `debug < info < warn < error`,
  com timestamp ISO e nível por linha; o nível mínimo lê-se de `LOG_LEVEL` (default
  `info`). `warn`/`error` vão para `stderr`, o resto para `stdout`.
- **Métricas** (`metrics.ts`): singleton de contadores em memória — `messagesSpoken`,
  `cacheHits`, `cacheMisses`, `synthErrors`. Expostas pelo comando **`/stats`** (admin),
  junto com players ativos, nº de servidores e uptime do processo.

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
- **Mobile.** Limitação estrutural da plataforma Discord (clientes móveis não tocam o
  áudio de bots de voz de forma fiável); fora de âmbito.
