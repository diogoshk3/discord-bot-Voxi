# Política de Privacidade — Vozen

> _type it, hear it._

**Última atualização:** 2026-07-07

O Vozen é um bot de Text-to-Speech (TTS) para Discord, **open-source** e **self-host**: cada operador corre a sua própria instância no seu próprio computador ou servidor (VPS). Esta política descreve **fielmente** que dados a instância guarda, onde, e como removê-los.

Como o Vozen é self-host, o **responsável pelo tratamento de dados é o operador da instância** (a pessoa ou entidade que corre o bot), não os autores do projeto. O operador controla diretamente o ficheiro de base de dados e a pasta de cache no seu sistema.

---

## 1. Que dados são guardados

O Vozen guarda os dados abaixo numa base de dados local **SQLite** (por defeito `tts.db`, configurável em `DB_PATH`). **Todos** os registos são identificados apenas por **IDs numéricos do Discord** (snowflakes) — `guild_id` (servidor) e `user_id` (utilizador). O Vozen **não recolhe** informação pessoal identificável (PII) como email, número de telefone ou morada, e não guarda o nome de utilizador nem o avatar do Discord. A única exceção é o **apelido falado** (`/voice nickname`): um texto que o próprio utilizador escreve livremente — pode conter o que quiser, incluindo um nome próprio, e é removível a qualquer momento (ver secção 3).

| Dado | Tabela | Colunas guardadas | A que se refere |
|---|---|---|---|
| **Preferência de voz por utilizador** | `user_voice` | `guild_id`, `user_id`, `voice_model`, `speed`, `engine` | A voz (modelo), a velocidade e o motor (Google/Piper) que um utilizador fixou para si num servidor (`/voice set`). |
| **Configuração por servidor** | `guild_config` | `guild_id`, `tts_channel_id`, `autoread`, `default_voice`, `max_chars`, `rate_per_min`, `enabled`, `tts_role_id`, `locale`, `xsaid`, `autojoin`, `read_bots`, `text_in_voice`, `greet_on_join`, `greet_locale` | Definições do servidor: canal de auto-leitura, on/off da auto-leitura, voz default, limites, kill-switch, role autorizado, idioma da interface, e os interruptores de anunciar quem falou (xsaid), auto-entrada na call, ler outros bots, ler o chat-em-voz e a saudação de entrada. |
| **Apelido falado** | `user_nickname` | `guild_id`, `user_id`, `nickname` | O nome que um utilizador escolheu para ser **chamado em voz alta** pelo xsaid (`/voice nickname`). É um texto livre definido pelo próprio; pode ou não corresponder ao nome real. |
| **Abreviaturas pessoais** | `user_abbreviation` | `user_id`, `term`, `replacement` | Substituições de texto pessoais (globais, seguem a pessoa entre servidores) definidas pelo próprio (`/voice abbrev`). |
| **Efeito de voz** | `user_effect` | `guild_id`, `user_id`, `effect` | O filtro de voz (ex.: robô, eco) que a pessoa escolheu para si (`/voice effect`). |
| **Deteção de língua por utilizador** | `tts_lang_detect_on` | `guild_id`, `user_id` | Registo de que um utilizador **ligou** a deteção automática de língua (voz nativa por língua). Sem registo = voz fixa (default). |
| **Blocklist** | `blocklist` | `guild_id`, `word` | Palavras que o servidor bloqueou de serem lidas (`/config blockword`). |
| **Dicionário de pronúncia** | `pronunciation` | `guild_id`, `term`, `replacement` | Substituições de pronúncia definidas pelo servidor (`/config pronunciation`). |
| **Opt-out de TTS** | `tts_optout` | `guild_id`, `user_id` | Registo de que um utilizador pediu para **não** ser lido automaticamente (`/voice optout`). |
| **Pontuações dos jogos** | `game_score` | `guild_id`, `user_id`, `points`, `wins` | Leaderboard dos minijogos (`/game`): pontos acumulados e partidas vencidas. |
| **"Tagarelas"** | `talk_stats` | `guild_id`, `user_id`, `spoken_count`, `streak`, `best_streak`, `last_date` | Quantas mensagens de cada pessoa o bot leu + streaks de dias, para o `/topspeakers`. |
| **Aniversário** | `user_birthday` | `guild_id`, `user_id`, `month`, `day` | **Só mês e dia** (nunca o ano), definidos pelo próprio, para o bot dar os parabéns na call (`/birthday`). |
| **Premium por servidor** | `premium_guild` | `guild_id`, `expires_at`, `source` | Estado Premium de um servidor: quando expira e a origem (ex.: código de resgate). |
| **Premium por utilizador (Plus)** | `premium_user` | `user_id`, `expires_at`, `source` | Estado Plus de uma pessoa (perks que a seguem entre servidores). |
| **Códigos de resgate** | `redeem_code` | `code`, `kind`, `days`, `used_by`, `used_at`, `created_at` | Códigos Premium gerados offline; `used_by`/`used_at` só ficam preenchidos quando o código é resgatado (`/redeem`). |
| **Clone de voz** | `user_clone` | `user_id`, `sample_path`, `consent_at`, `enabled` | **Ver secção 2.3 — é o dado mais sensível.** Aponta para o ficheiro `.wav` da amostra e regista o timestamp do consentimento. |

Nota sobre o opt-out: pedir `/voice optout` **cria** um registo com o teu `user_id` (para o bot se lembrar da preferência). `/voice optin` remove esse registo. Não é guardada mais nenhuma informação a teu respeito.

---

## 2. Conteúdo das mensagens

Para sintetizar voz, o Vozen **lê o conteúdo de texto** das mensagens nos casos em que age: o comando `/tts`, a auto-leitura de um canal configurado, e menções/respostas (replies) ao bot.

**O texto das mensagens NÃO é guardado em nenhuma tabela da base de dados.** É processado de forma **transitória** em memória: limpeza do texto → aplicação do dicionário de pronúncia → verificação da blocklist → síntese de voz → reprodução. Após a reprodução, o texto em claro não é persistido em lado nenhum.

### 2.1 Cache de áudio

Para evitar re-sintetizar frases repetidas, o Vozen guarda os **ficheiros de áudio gerados** (`.wav`) numa pasta de cache local (`audio-cache/`, ao lado da base de dados). É importante perceber exatamente o que isto implica:

- **A chave (nome do ficheiro) é um hash** `SHA-1` calculado a partir de `texto_limpo + modelo_de_voz + velocidade`. O texto em claro **não** aparece no nome do ficheiro nem na base de dados, e o hash **não** é reversível para recuperar o texto.
- **No entanto, o ficheiro `.wav` em si é o áudio falado da mensagem limpa.** Quem tiver acesso ao sistema de ficheiros da instância pode reproduzir esse ficheiro e ouvir o conteúdo. Isto não é um "esconderijo" do conteúdo — é apenas o áudio gerado, guardado para reutilização.
- A cache é **limitada e regenerável**: por defeito mantém no máximo ~500 ficheiros por motor (limite por contagem — os mais antigos por data de criação são apagados primeiro). **Persiste no disco** entre reinícios do bot até ser expulsa pela política de limite, ou até o operador apagar a pasta. Se for apagada, o áudio é simplesmente re-sintetizado quando necessário.

Em resumo: **não guardamos o texto original**, apenas o áudio gerado por hash, que é limitado, regenerável e apagável.

### 2.2 Registos (logs)

O Vozen escreve **logs operacionais** para a consola/terminal e (no runner de produção) para o ficheiro `logs/vozen.log` ao lado do executável, com rotação por tamanho. Os logs contêm informação operacional: nível, timestamp, nome de comandos, e mensagens de erro. **Os logs NÃO incluem o conteúdo das mensagens dos utilizadores.** A retenção dos logs é controlada pelo operador da instância (o sistema onde o bot corre).

### 2.3 Clone de voz (dado sensível — opt-in)

O clone de voz (`/voice clone`, feature Premium) é o **dado mais sensível** que uma instância guarda: uma **gravação real da voz de uma pessoa**. É estritamente **opt-in** — a instância só tem uma amostra se alguém correr `/voice clone record`. Como funciona:

- **Consentimento primeiro.** Podes gravar a **tua própria** voz, ou a voz de **outra pessoa apenas depois de ela dar consentimento explícito no ecrã** — um botão Permitir/Recusar que **só essa pessoa** pode carregar. Sem esse "sim", não se grava nada. `consent_at` regista o momento do consentimento.
- **Só o alvo é gravado.** Fora da janela de gravação o bot está sempre `selfDeaf` (surdo); destapa os ouvidos **apenas durante a janela** e grava **apenas** a pessoa escolhida, nunca o resto do canal. No fim volta a ensurdecer.
- **Onde fica.** A amostra é um `.wav` em `voice-clones/{user_id}-{timestamp}.wav` (ao lado da base de dados); a tabela `user_clone` guarda o caminho. A pasta é local e apagável.
- **Quem controla.** A amostra fica associada a quem **correu o comando** (é essa pessoa que vai falar com a voz), e é essa pessoa que a pode apagar com `/voice clone delete` (remove o `.wav` e a linha imediatamente).
- **Síntese.** O clone é gerado **localmente** (sidecar Python na máquina da instância) — o áudio da amostra **não é enviado para fora**.

> Nota de conformidade: uma amostra de voz pode ser tratada como **dado sensível/biométrico** em certas jurisdições (ex.: RGPD). O operador da instância é o responsável por só permitir clones com o devido consentimento e por responder a pedidos de remoção.

---

## 3. Retenção e apagamento de dados

Como o Vozen é self-host, **o operador da instância controla diretamente** o ficheiro SQLite (`DB_PATH`) e a pasta de cache (`audio-cache/`) — ambos são ficheiros locais que podem ser apagados a qualquer momento. No deploy Docker, apagar tudo é `docker compose down -v` (remove o volume com a base de dados e a cache).

Para os utilizadores e administradores de servidor, os comandos do bot permitem remover dados:

| Para remover... | Usa... | Notas |
|---|---|---|
| A tua preferência de voz | `/voice reset` | Apaga o teu registo em `user_voice`. |
| O teu apelido falado | `/voice nickname` (sem nome) | Apaga o teu registo em `user_nickname`. |
| O teu opt-out (voltar a ser lido) | `/voice optin` | Apaga o teu registo em `tts_optout`. |
| A tua deteção de língua | `/voice detection active:false` | Apaga o teu registo em `tts_lang_detect_on`. |
| A tua amostra de voz clonada | `/voice clone delete` | Apaga a linha em `user_clone` **e** o ficheiro `.wav` da amostra, imediatamente. |
| Configuração do servidor | `/config reset` | Repõe a `guild_config` aos valores por defeito. **Atenção:** o reset **NÃO** apaga a blocklist nem o dicionário de pronúncia. |
| Uma palavra da blocklist | `/config blockword remove` | Removida individualmente (não pelo `/config reset`). |
| Um termo de pronúncia | `/config pronunciation remove` | Removido individualmente (não pelo `/config reset`). |

> **Não existe um comando único de "apagar todos os meus dados".** Os dados por utilizador vivem em várias tabelas (`user_voice`, `user_nickname`, `user_abbreviation`, `user_effect`, `tts_optout`, `tts_lang_detect_on`, `user_clone`, `game_score`, `talk_stats`, `user_birthday`, `premium_user`) e removem-se com os comandos acima (`/voice reset`, `/voice nickname` vazio, `/voice optin`, `/voice detection active:false`, `/voice clone delete`). Para uma remoção completa de qualquer dado ligado ao teu ID — incluindo estatísticas e pontuações — pede ao operador da instância (ver secção 5); ele pode apagar registos diretamente na base de dados ou os ficheiros locais.

A cache de áudio é regenerável e auto-limitada (ver secção 2.1); apagá-la não perde nenhuma configuração.

---

## 4. Terceiros

### 4.1 Motor de síntese de fala (para onde vai o texto)

Para gerar o áudio, o **texto limpo a sintetizar** é entregue a um motor de TTS. Qual, depende da configuração `TTS_ENGINE` da instância:

| `TTS_ENGINE` | Para onde vai o texto | Nota |
|---|---|---|
| `piper` | **Fica local** — corre na máquina da instância, **não envia nada para fora**. | Default do código. |
| `gtts` | **Enviado à Google** (`translate.google.com`) para gerar o áudio. Aplica-se a [Política de Privacidade da Google](https://policies.google.com/privacy). | **É o motor usado na instância pública oficial do Vozen.** |
| `router` | Por defeito usa o **gTTS (Google)** e cai no **Piper (local)** se a Google falhar — ou seja, o texto **pode** ser enviado à Google. | — |
| `neural` | **Enviado à OpenAI** (`api.openai.com`). Exige chave de API do operador. | Opt-in. |

> Em qualquer caso, é enviado **apenas o texto a ler** (já limpo), não IDs de utilizador nem histórico. O motor externo devolve áudio; o Vozen não guarda a associação texto↔utilizador.

### 4.2 Outros serviços

- **Discord.** O Vozen liga-se à API/gateway do Discord para funcionar (receber mensagens, entrar em canais de voz, responder). A utilização do Discord rege-se pela [Política de Privacidade do Discord](https://discord.com/privacy).
- **Listas de bots (opt-in, ex.: top.gg).** Se `TOPGG_TOKEN` estiver definido, é publicada periodicamente **apenas a contagem de servidores** — nenhum dado pessoal, nenhum conteúdo de mensagens.
- **Webhook de erros (opt-in).** Se `ERROR_WEBHOOK_URL` estiver definido, relatórios técnicos de erros (stack traces) são enviados a um canal privado do **operador** para monitorização. Não são desenhados para incluir conteúdo de mensagens.

**Sem venda de dados. Sem analytics de terceiros. Sem trackers.** O Vozen não vende, aluga nem partilha dados com terceiros para fins de marketing, e não integra serviços de analítica externos.

---

## 5. Contacto / Responsável

O **responsável** por uma instância do Vozen é o **operador** que a corre. Para questões sobre os teus dados num servidor específico, para reportar um problema/abuso, ou para pedir a remoção dos teus dados, contacta o administrador desse servidor ou o operador do bot.

> **Instância pública oficial do Vozen:**
>
> - Suporte / denúncia / pedidos de dados: **[servidor de suporte](https://discord.gg/V6PZYZmhcQ)** (`discord.gg/V6PZYZmhcQ`)
> - Código-fonte: <https://github.com/diogoshk3/discord-bot-Vozen>
>
> **Corres a tua própria instância?** Substitui o contacto acima pelo teu antes de tornares o bot público.

Os autores do projeto Vozen fornecem apenas o software (open-source); cada operador de uma instância de terceiros é responsável pelos dados que essa instância processa.

---

## Nota / Note (EN)

_Vozen is a self-hosted, open-source Discord TTS bot (AGPL-3.0). The instance operator is the data controller. The bot stores only Discord numeric IDs (`guild_id`, `user_id`) plus per-user voice preferences (voice/engine/speed/effect), spoken nickname (free text the user chooses), personal abbreviations, per-server config, blocklist, pronunciation dictionary, opt-out and language-detection records, game scores, talk stats, optional birthday (month/day, no year), and Premium status in a local SQLite database — no PII beyond the optional nickname. **Voice clone (opt-in, Premium)** additionally stores a real voice recording as a `.wav` in `voice-clones/` plus a consent timestamp (`user_clone`): you may record your own voice, or another person's voice only after they grant explicit on-screen consent (a button only they can press); the bot is deafened except during the recording window and records only the chosen person; delete with `/voice clone delete` (removes the row and the `.wav`). Message text is processed transiently to synthesize speech and is **not** stored in any table; only generated `.wav` audio is cached on disk, named by an SHA-1 hash of (cleaned text + voice + speed), capped (~500 files/engine, LRU), regenerable and deletable. Logs contain operational data, **not** message content. Where the text goes depends on `TTS_ENGINE`: **Piper** runs locally (no external send); **gTTS** (the public instance's engine) sends the text to Google; **router** may send to Google (falls back to local Piper); **neural** sends to OpenAI. Voice clones are synthesized locally and never leave the machine. Opt-in extras: server-count to top.gg (`TOPGG_TOKEN`, no personal data) and error reports to the operator's webhook (`ERROR_WEBHOOK_URL`). No data sale, no third-party analytics, no using message content to train AI. Support / reports / data requests: the [support server](https://discord.gg/V6PZYZmhcQ). Removal: `/voice reset`, `/voice nickname` (empty), `/voice optin`, `/voice detection active:false`, `/voice clone delete`, `/config reset` (does not clear blocklist/pronunciation — use `/config blockword remove` / `/config pronunciation remove`); the operator can delete the SQLite file and cache folder directly._
