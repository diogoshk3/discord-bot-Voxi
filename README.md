# Voxi

> type it, hear it.

Bot de Text-to-Speech para Discord com **voz neural gratuita** (Piper, self-host) e foco em **fiabilidade**. O Voxi lê texto em canais de voz: comando `/tts`, auto-leitura de um canal configurado, e leitura de menções/replies ao bot. Deteta a língua por mensagem e escolhe a voz; cada utilizador pode fixar a sua própria voz. Inclui moderação (blocklist, rate-limit, limite de chars, gating por canal), fila FIFO com `/skip`, auto-reconexão à voz, auto-saída por inatividade e cache de áudio.

> Estado: **v0** (núcleo competitivo). Motor neural pago, streaming, dicionário de pronúncia, monetização e Docker/VPS estão **fora** deste v0.

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
     pt_PT-tugao-medium.onnx
     pt_PT-tugao-medium.onnx.json
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
