# Voxi

> type it, hear it.

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Docker ready](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![made with Piper](https://img.shields.io/badge/made%20with-Piper-5a4fcf)

**Voz neural (não robótica) que não cai do canal — e cuja qualidade nunca fica atrás de paywall.** O Voxi é um bot de Text-to-Speech para Discord que lê texto em canais de voz com voz **neural** (Piper): comando `/tts`, auto-leitura de um canal configurado e leitura de menções/replies ao bot. Deteta a língua de cada mensagem e escolhe a voz sozinho, e cada utilizador pode fixar a sua própria voz.

A maioria dos bots de TTS força-te a escolher: ou é grátis-mas-robótico, ou natural-mas-atrás de paywall — e o líder de mercado "desconecta durante horas". O Voxi tem tudo o que o líder tem (auto-leitura, `/setup` de um comando, deteta a língua sozinho) — e ainda os **dois** trunfos que o líder não reúne para línguas ocidentais (PT/EN/europeu):

- **Voz neural genuinamente natural, grátis** — Piper, não a voz robótica do gTTS/eSpeak do plano gratuito.
- **Qualidade NUNCA atrás de paywall** — sem vozes premium pagas, sem "vota para desbloquear". O líder esconde as boas vozes atrás de ~€5/mês; aqui a melhor voz é a de fábrica.
- **Não cai do canal de voz** — auto-reconexão à voz (mata o "desconecta durante horas" do líder).

Estes dois (voz neural grátis + fiabilidade) são o que distingue o Voxi. O resto é **paridade** — o líder também o faz, mas o Voxi não fica atrás: auto-leitura sem prefixo (lê um canal configurado e menções/replies, configurável em um passo com `/setup`) e deteção automática de língua por mensagem em PT, EN e línguas europeias.

A par disto: moderação (blocklist, rate-limit, limite de chars, gating por canal), fila FIFO com `/skip`, auto-saída por inatividade e cache de áudio.

> Estado: **v0** (núcleo competitivo). Motor neural pago, streaming e monetização estão **fora** deste v0. O Voxi é **self-host**: corre no teu PC ou podes **alojá-lo tu** num VPS via Docker (continua a exigir setup — não é um bot já alojado que se convida) — ver secção **Deploy em VPS (Docker)** no fim.

---

## Instalação em 3 linhas (quickstart)

Já tens o Node (>= 20), o binário do Piper e pelo menos um modelo de voz `.onnx`? Então o mínimo para arrancar é:

```bash
git clone https://github.com/diogoshk3/discord-bot-Voxi.git voxi && cd voxi
npm install                       # deps + bindings nativos
cp .env.example .env              # edita: DISCORD_TOKEN, CLIENT_ID, PIPER_PATH, MODELS_DIR; depois: npm run register && npm run dev
```

Este é só o resumo. Para o passo-a-passo (binário do Piper, modelos de voz, todas as variáveis do `.env`), **[ver setup completo →](#1-pré-requisitos)**.

## Níveis: Easy · Normal · Hard

Três caminhos para o mesmo bot — escolhe pelo controlo/esforço que queres, não há um "mais fácil que convidar". Self-host exige sempre setup.

| Nível | Para quem | Como | Secção |
|---|---|---|---|
| **Easy** | Quem quer o bot sempre online sem instalar Node à mão | Alojas tu numa VPS Linux com `docker compose` | [§5 Deploy em VPS (Docker)](#5-deploy-em-vps-docker) |
| **Normal** | Quem corre no próprio PC para testar ou usar pontualmente | Node + Piper local, `npm install` → `npm run dev` | [§1 Pré-requisitos](#1-pré-requisitos) e [§2 Setup](#2-setup) |
| **Hard** | Quem quer afinar vozes/motor ou experimentar TTS neural por API | Motor neural (`TTS_ENGINE=neural` + OpenAI) e tweaks de modelos/locale | [§1.5 Modelos](#15-modelos-de-voz-línguas) e [§5.4 `.env`](#54-ficheiro-env) |

## Demo

<!-- TODO: GIF demo — gravar ~10s a mostrar /tts a ler uma frase PT e uma EN com voz Piper, e colocar o GIF aqui (ex.: docs/demo.gif). -->

_(demo em breve — GIF de ~10s a ler PT + EN com voz neural Piper.)_

---

## 1. Pré-requisitos

### 1.1 Software

- **Node.js LTS** (>= 20). Verifica com:
  ```
  node -v
  npm -v
  ```
- **ffmpeg** — já vem incluído via `ffmpeg-static` (dependência npm). Não precisas de instalar nada à mão.
- **Sistema**: Windows (alvo principal). Em Windows certifica-te que tens as **Build Tools** para compilar `better-sqlite3`/`sodium-native` se o npm pedir (normalmente os prebuilds bastam).

### 1.2 Binário do Piper

1. Vai a https://github.com/rhasspy/piper/releases e descarrega o build para **Windows** (`piper_windows_amd64.zip` ou equivalente).
2. Extrai para uma pasta tua, por exemplo `C:\piper\`. Confirma que existe `C:\piper\piper.exe`.
3. Esse caminho é o que vais pôr em `PIPER_PATH` no `.env`.

### 1.3 Modelos de voz (.onnx)

O Piper precisa de **modelos de voz**. Cada modelo são 2 ficheiros: `<voz>.onnx` e `<voz>.onnx.json`.

1. Cria a pasta `models/` na raiz do projeto:
   ```
   mkdir models
   ```
2. Descarrega **1 ou 2 vozes** de https://huggingface.co/rhasspy/piper-voices (ou dos releases do Piper). Sugestão para começar:
   - Português: `pt_PT-tugão-medium` (ou `pt_BR-faber-medium`)
   - Inglês: `en_US-amy-medium`
3. Coloca **ambos** os ficheiros de cada voz dentro de `models/`. Exemplo:
   ```
   models/
     en_US-amy-medium.onnx
     en_US-amy-medium.onnx.json
     pt_PT-tugão-medium.onnx
     pt_PT-tugão-medium.onnx.json
   ```
4. O nome do modelo (sem extensão) — p.ex. `en_US-amy-medium` — é o que usas como `DEFAULT_VOICE` e em `/voice set`.

### 1.4 Ficheiro de ambiente

Copia o exemplo e preenche:

```
copy .env.example .env
```

Edita `.env`:

| Variável | O que pôr |
|---|---|
| `DISCORD_TOKEN` | Token do bot (Discord Dev Portal → Bot → Reset Token) |
| `CLIENT_ID` | Application ID (Dev Portal → General Information) |
| `PIPER_PATH` | Caminho para o executável, p.ex. `C:\piper\piper.exe` |
| `MODELS_DIR` | Caminho para a pasta de modelos, p.ex. `./models` |
| `DB_PATH` | Caminho do SQLite, p.ex. `./tts.db` |
| `DEFAULT_VOICE` | Nome de um modelo presente em `models/`, p.ex. `en_US-amy-medium` |
| `DEFAULT_SPEED` | Velocidade base, p.ex. `1.0` |
| `INACTIVITY_MS` | Auto-saída por inatividade em ms, p.ex. `300000` (5 min) |
| `QUEUE_CAP` | Tamanho máximo da fila, p.ex. `20` |
| `MAX_CHARS` | Máximo de caracteres por mensagem, p.ex. `300` |
| `RATE_PER_MIN` | Mensagens por minuto por utilizador, p.ex. `5` |

### 1.5 Modelos de voz (línguas)

O Voxi **deteta a língua de cada mensagem** e escolhe automaticamente um modelo cujo nome começa pelo **prefixo de locale** dessa língua. Basta colocares o modelo certo em `models/`.

**Onde obter modelos.** Todos os modelos Piper vivem em **https://huggingface.co/rhasspy/piper-voices** (pasta por língua/país/voz). Cada voz são sempre **2 ficheiros**: `<voz>.onnx` + `<voz>.onnx.json`. Descarrega **ambos** e põe-nos em `models/`.

**Como o nome do ficheiro mapeia para a deteção.** O Voxi olha apenas para o **prefixo de locale** no início do nome do ficheiro (`pt_`, `en_`, `es_`, ...). Por isso `pt_PT-tugão-medium` **e** `pt_BR-faber-medium` contam ambos como Português — se só tiveres um, é esse que toca; se tiveres os dois, toca o primeiro por ordem. Se não houver nenhum modelo da língua detetada, o Voxi cai no `DEFAULT_VOICE`.

Línguas mapeadas (código de deteção → prefixo do nome de ficheiro):

| Língua | Prefixo | Exemplo de modelo |
|---|---|---|
| Português (PT **e** BR) | `pt_` | `pt_PT-tugão-medium`, `pt_BR-faber-medium` |
| Inglês | `en_` | `en_US-amy-medium`, `en_GB-alan-low` |
| Espanhol | `es_` | `es_ES-davefx-medium` |
| Francês | `fr_` | `fr_FR-siwis-medium` |
| Alemão | `de_` | `de_DE-thorsten-medium` |
| Italiano | `it_` | `it_IT-riccardo-x_low` |
| Neerlandês | `nl_` | `nl_NL-mls-medium` |
| Russo | `ru_` | `ru_RU-dmitri-medium` |
| Polaco · Ucraniano · Turco · Checo · Catalão | `pl_` · `uk_` · `tr_` · `cs_` · `ca_` | — |
| Sueco · Finlandês · Dinamarquês · Romeno · Grego · Húngaro | `sv_` · `fi_` · `da_` · `ro_` · `el_` · `hu_` | — |

> Não precisas de **todas** as línguas: põe só os modelos que queres servir. As que não tiverem modelo caem no `DEFAULT_VOICE`.

**`DEFAULT_VOICE` regional.** O default de fábrica é `en_US-amy-medium`, mas podes pôr **qualquer** modelo presente em `models/` — incluindo um regional — diretamente no `.env`. Exemplos: `DEFAULT_VOICE=pt_PT-tugão-medium`, `pt_BR-faber-medium`, `es_ES-davefx-medium`, `fr_FR-siwis-medium`, `de_DE-thorsten-medium`. É a voz usada quando a língua detetada não tem modelo correspondente (e o ponto de partida para servidores maioritariamente PT/europeus).

---

## 2. Setup

```
npm install
npm run register
npm run dev
```

- `npm install` — instala dependências e compila os bindings nativos.
- `npm run register` — regista os slash commands na aplicação Discord (usa `DISCORD_TOKEN` + `CLIENT_ID`). Corre isto **uma vez** e sempre que mudares definições de comandos.
- `npm run dev` — arranca o bot. Esperado no terminal: `[client] online como <nome-do-bot>#0000`.

Para build de produção: `npm run build` e depois `npm start` (ou `node dist/index.js`).

---

## 3. Checklist de teste manual (ao vivo)

Faz esta checklist com o bot a correr (`npm run dev`) e tu num servidor Discord de testes onde és admin. Marca cada item.

### 3.1 Criar e configurar a aplicação Discord

- [ ] Em https://discord.com/developers/applications → **New Application** → dá o nome **Voxi** (recomendado para consistência de marca).
- [ ] Separador **Bot** → **Reset Token** → copia o token para `DISCORD_TOKEN` no `.env`.
- [ ] **General Information** → copia o **Application ID** para `CLIENT_ID` no `.env`.
- [ ] Separador **Bot** → secção **Privileged Gateway Intents** → ativa:
  - [ ] **MESSAGE CONTENT INTENT** (obrigatório para ler texto das mensagens e autoread).
  - [ ] **SERVER MEMBERS INTENT** (para resolver nomes de menções).
- [ ] **Save Changes**.

### 3.2 Convidar o bot

- [ ] **OAuth2 → URL Generator** → scopes: `bot` + `applications.commands`.
- [ ] Bot Permissions: `Connect`, `Speak`, `Send Messages`, `Read Message History`, `View Channels`.
- [ ] Abre o URL gerado, escolhe o teu servidor de testes, autoriza.
- [ ] Confirma que o bot aparece **offline** na lista de membros (vai ficar online no passo 3.3).

### 3.3 Arranque

- [ ] `npm run register` correu sem erros (esperado: `[register] N comandos registados globalmente.`).
- [ ] `npm run dev` mostra `[client] online como ...` e o bot aparece **online** no servidor.

### 3.4 Voz básica

- [ ] Entra num canal de voz do servidor.
- [ ] Escreve `/join` num canal de texto. Esperado: o bot entra no teu canal de voz e confirma.
- [ ] Escreve `/tts texto:ola`. Esperado: ouves "ola" sintetizado pelo Piper.
- [ ] Escreve `/leave`. Esperado: o bot sai do canal de voz.

### 3.5 Autoread

- [ ] `/join` outra vez.
- [ ] Configura o canal de autoread: `/config tts-channel canal:#geral` e `/config autoread ativo:true`.
- [ ] Escreve uma frase normal nesse canal (sem comando). Esperado: o bot lê a frase em voz.
- [ ] Escreve uma frase noutro canal **não** configurado. Esperado: o bot **não** lê.

### 3.6 Limpeza de texto

Com autoread ligado, escreve cada um e confirma o comportamento ouvido:

- [ ] **Emoji**: `ola 😀 mundo` → ouves "ola mundo" (emoji saltado, sem ler o nome).
- [ ] **URL**: `vê isto https://exemplo.com agora` → ouves "vê isto link agora".
- [ ] **Menção a user**: `olá @TeuNome` → ouves "olá " seguido do **nome** (não do ID numérico).
- [ ] **Menção a canal**: `vai a #geral` → ouves "vai a geral" (nome do canal).
- [ ] **Code block**: uma mensagem com ` ```bloco``` ` → o bloco de código é removido, não é lido.
- [ ] **Repetições**: `aaaaaaaaaa` → colapsado (não ouves 10 "a").
- [ ] **Mensagem longa**: escreve um texto acima de `MAX_CHARS` → é truncado, o bot não bloqueia.

### 3.7 Menções e replies ao bot

- [ ] Faz `@NomeDoBot olá` num canal qualquer. Esperado: o bot lê "olá".
- [ ] Faz **reply** a uma mensagem do bot com texto. Esperado: o bot lê o teu texto.

### 3.8 Deteção de língua e voz por-utilizador

- [ ] Escreve uma frase claramente em **inglês** → ouves uma voz EN (se tiveres modelo EN).
- [ ] Escreve uma frase claramente em **português** → ouves uma voz PT (se tiveres modelo PT).
- [ ] `/voice set model:en_US-amy-medium speed:1.0` (usa um modelo que tens em `models/`). Esperado: confirmação de voz guardada.
- [ ] Escreve agora **em português** → ouves a voz EN que fixaste (a voz do utilizador tem **prioridade** sobre a deteção de língua).
- [ ] `/voice reset` → volta ao comportamento por deteção de língua.

### 3.9 Fila e skip

- [ ] Cola **várias** mensagens seguidas rapidamente (ou vários `/tts`). Esperado: tocam por ordem (FIFO), uma de cada vez.
- [ ] Durante uma leitura longa, escreve `/skip`. Esperado: salta para o item seguinte da fila imediatamente.
- [ ] Enche a fila acima de `QUEUE_CAP`. Esperado: novas entradas são recusadas com aviso, o bot **não** crasha.

### 3.10 Moderação

- [ ] Adiciona uma blockword: `/config blockword add palavra:palavrao`.
- [ ] Escreve uma frase que contém essa palavra (ou faz `/tts texto:palavrao`). Esperado: **não** é sintetizada (filtrada antes do TTS, tanto em autoread como em `/tts`).
- [ ] `/config blockword remove palavra:palavrao` → a frase volta a ser lida.
- [ ] Envia mensagens muito rápido (mais de `RATE_PER_MIN` num minuto). Esperado: a partir do limite, as extra são ignoradas/avisadas (rate-limit por-utilizador).

### 3.11 Cache

- [ ] `/tts texto:teste de cache` → repara no tempo até ouvir.
- [ ] Repete **exatamente** `/tts texto:teste de cache` com a mesma voz. Esperado: toca mais depressa (servido da cache por hash de texto+voz, sem re-sintetizar).

### 3.12 Fiabilidade — reconexão e inatividade

- [ ] Com o bot a tocar, **desconecta-o à força**: clica com o botão direito no bot no canal de voz → **Disconnect** (ou move-o para outro canal). Esperado: o bot **reconecta-se automaticamente** ao canal e retoma, sem crashar.
- [ ] Deixa o bot em silêncio (sem leituras) por mais de `INACTIVITY_MS`. Esperado: o bot sai sozinho do canal de voz por inatividade.
- [ ] Ao longo de toda a sessão: confirma no terminal que **não houve crash** (sem stack trace que mate o processo). Erros pontuais devem ser apanhados e registados, mas o bot continua vivo.

---

## 4. Resolução de problemas

- **O bot não lê texto / autoread não funciona**: confirma **MESSAGE CONTENT INTENT** ativado no Dev Portal.
- **Menções saem como IDs**: confirma **SERVER MEMBERS INTENT** e que o bot vê os membros do servidor.
- **`piper` não encontrado / erro a sintetizar**: confirma `PIPER_PATH` aponta para o `.exe` certo e que os `.onnx`/`.onnx.json` estão em `MODELS_DIR`.
- **Comandos não aparecem**: corre `npm run register` outra vez; comandos globais podem demorar a propagar.
- **Sem áudio**: confirma que o bot tem permissões `Connect` e `Speak` no canal de voz.

---

## 5. Deploy em VPS (Docker)

Caminho **hosted / invite-and-go**: corres o Voxi numa VPS Linux com `docker compose`, sem instalar Node nem build tools à mão. O bot é um cliente websocket de saída — **não** expõe portas nem precisa de domínio/reverse-proxy.

> Estado: o build da imagem e a síntese real do Piper são **(verificação ao vivo pendente)** — não foram corridos neste ambiente.

### 5.1 Pré-requisitos

- Uma VPS Linux (ex.: Ubuntu/Debian) com **Docker** e o plugin **docker compose v2** instalados (`docker --version`, `docker compose version`).
- O código do projeto na VPS (ex.: `git clone` do repositório).

### 5.2 Binário do Piper (Linux)

O Piper para Linux **não** é um executável solto: é uma pasta com o binário **mais** bibliotecas partilhadas (`libonnxruntime`, `libespeak-ng`, etc.) e a pasta `espeak-ng-data/`. Tens de montar a **pasta inteira** e apontar `PIPER_PATH` para o binário lá dentro.

1. Vai a https://github.com/rhasspy/piper/releases e descarrega o build **Linux x86_64** (ex.: `piper_linux_x86_64.tar.gz`).
2. Extrai para `./piper/` na raiz do projeto (ao lado do `docker-compose.yml`). Deve ficar:
   ```
   piper/
     piper                  # o binário (sem extensão em Linux)
     libpiper_phonemize.so* # + outras .so
     espeak-ng-data/
   ```
   O `docker-compose.yml` monta `./piper` em `/opt/piper` (read-only) e define `PIPER_PATH=/opt/piper/piper`.

### 5.3 Modelos de voz (.onnx)

1. Cria a pasta `./models/` na raiz do projeto.
2. Coloca lá **pelo menos uma** voz — cada voz são 2 ficheiros (`<voz>.onnx` + `<voz>.onnx.json`), de https://huggingface.co/rhasspy/piper-voices. Sugestão para começar: `en_US-amy-medium`.
   ```
   models/
     en_US-amy-medium.onnx
     en_US-amy-medium.onnx.json
   ```
   O `docker-compose.yml` monta `./models` em `/models` (read-only) e define `MODELS_DIR=/models`.
3. Garante que `DEFAULT_VOICE` no `.env` corresponde a um modelo presente em `./models/`.

### 5.4 Ficheiro `.env`

```
cp .env.example .env
```

Preenche **apenas** os segredos e tunables — **não** definas `DB_PATH`, `MODELS_DIR` nem `PIPER_PATH` no `.env`: esses vêm já fixos do `docker-compose.yml` com os caminhos do container (`/data/tts.db`, `/models`, `/opt/piper/piper`).

| Variável | Obrigatória? | O que pôr |
|---|---|---|
| `DISCORD_TOKEN` | **Sim** | Token do bot (Dev Portal → Bot → Reset Token) |
| `CLIENT_ID` | **Sim** | Application ID (Dev Portal → General Information) |
| `DEFAULT_VOICE` | Não | Modelo presente em `./models/`, p.ex. `en_US-amy-medium` |
| `DEFAULT_SPEED` | Não | Velocidade base (default `1.0`) |
| `INACTIVITY_MS` | Não | Auto-saída por inatividade em ms (default `300000`) |
| `QUEUE_CAP` | Não | Tamanho máximo da fila (default `20`) |
| `MAX_CHARS` | Não | Máx. de caracteres por mensagem (default `300`) |
| `RATE_PER_MIN` | Não | Mensagens por minuto por utilizador (default `5`) |
| `LOG_LEVEL` | Não | `debug` \| `info` \| `warn` \| `error` (default `info`) |
| `TTS_ENGINE` | Não | `piper` (default) ou `neural` |
| `OPENAI_API_KEY` | Só se `TTS_ENGINE=neural` | Chave da API OpenAI |

### 5.5 Arranque

```
docker compose up -d --build   # constrói a imagem e arranca em background
docker compose logs -f voxi    # segue os logs (esperado: [client] online como ...)
docker compose down            # pára e remove o container (os dados persistem no volume)
```

- Os **slash commands são registados automaticamente** no arranque — **não** precisas de correr `npm run register` no deploy Docker.
- A base de dados, o WAL/SHM e a cache de áudio vivem no volume nomeado `data` (`/data` no container) e **persistem** entre `up`/`down`. Para apagar também os dados: `docker compose down -v`.
- Atualizar para uma versão nova: `git pull` e `docker compose up -d --build`.

### 5.6 Resolução de problemas (Docker)

- **`Missing required env var: DISCORD_TOKEN` / `CLIENT_ID`**: preenche-os no `.env` (secção 5.4).
- **Piper falha a arrancar / erro a carregar bibliotecas (`error while loading shared libraries` ou similar)**: confirma que montaste a **pasta inteira** do Piper (não só o binário). Se faltarem libs de sistema do runtime, instala-as na imagem (ex.: `apt-get install -y libgomp1 libstdc++6`) — a base `-slim` pode não as trazer.
- **`/voice list` vazio / sem áudio**: confirma que há `.onnx` (+ `.onnx.json`) em `./models/` e que `DEFAULT_VOICE` corresponde a um deles.

---

## 6. Privacidade e Termos

- [**Política de Privacidade** (`PRIVACY.md`)](PRIVACY.md) — que dados a instância guarda (apenas IDs do Discord + preferências/config), o que acontece ao conteúdo das mensagens, retenção e apagamento, e terceiros (Discord; OpenAI só se `TTS_ENGINE=neural`).
- [**Termos de Serviço** (`TERMS.md`)](TERMS.md) — uso aceitável, ausência de garantias, limitação de responsabilidade e licença (MIT).

> **Nota para o registo/verificação no Discord.** O Discord Developer Portal pede um **Privacy Policy URL** e um **Terms of Service URL** (ex.: para *Public Bot* / verificação). Quando este repositório for **público**, os URLs a colar nesses campos são os ficheiros aqui no repo:
>
> - Privacy Policy URL: `https://github.com/diogoshk3/discord-bot-Voxi/blob/main/PRIVACY.md`
> - Terms of Service URL: `https://github.com/diogoshk3/discord-bot-Voxi/blob/main/TERMS.md`
>
> O repositório está **privado** por agora, por isso estes links só ficam acessíveis (e válidos para o Discord) depois de o tornares público. Antes de publicar, preenche o campo de contacto/responsável no fim de `PRIVACY.md`.

---

## GitHub Topics

Topics a aplicar ao repositório (para descoberta no GitHub), quando for público:

<!-- topics: discord-tts-bot tts text-to-speech piper piper-tts self-hosted neural-tts -->

`discord-tts-bot` · `tts` · `text-to-speech` · `piper` · `piper-tts` · `self-hosted` · `neural-tts`
