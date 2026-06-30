# Política de Privacidade — Voxi

> _type it, hear it._

**Última atualização:** 2026-06-30

O Voxi é um bot de Text-to-Speech (TTS) para Discord, **open-source** e **self-host**: cada operador corre a sua própria instância no seu próprio computador ou servidor (VPS). Esta política descreve **fielmente** que dados a instância guarda, onde, e como removê-los.

Como o Voxi é self-host, o **responsável pelo tratamento de dados é o operador da instância** (a pessoa ou entidade que corre o bot), não os autores do projeto. O operador controla diretamente o ficheiro de base de dados e a pasta de cache no seu sistema.

---

## 1. Que dados são guardados

O Voxi guarda os dados abaixo numa base de dados local **SQLite** (por defeito `tts.db`, configurável em `DB_PATH`). **Todos** os registos são identificados apenas por **IDs numéricos do Discord** (snowflakes) — `guild_id` (servidor) e `user_id` (utilizador). O Voxi **não** guarda informação pessoal identificável (PII) como email, nome real, número de telefone ou morada. Não guarda o nome de utilizador nem o avatar do Discord.

| Dado | Tabela | Colunas guardadas | A que se refere |
|---|---|---|---|
| **Preferência de voz por utilizador** | `user_voice` | `guild_id`, `user_id`, `voice_model`, `speed` | A voz (modelo) e a velocidade que um utilizador fixou para si num servidor (`/voice set`). |
| **Configuração por servidor** | `guild_config` | `guild_id`, `tts_channel_id`, `autoread`, `default_voice`, `max_chars`, `rate_per_min`, `enabled`, `tts_role_id` | Definições do servidor: canal de auto-leitura, on/off da auto-leitura, voz default, limite de caracteres, limite de mensagens/minuto, kill-switch e role autorizado. |
| **Blocklist** | `blocklist` | `guild_id`, `word` | Palavras que o servidor bloqueou de serem lidas (`/config blockword`). |
| **Dicionário de pronúncia** | `pronunciation` | `guild_id`, `term`, `replacement` | Substituições de pronúncia definidas pelo servidor (`/config pronunciation`). |
| **Opt-out de TTS** | `tts_optout` | `guild_id`, `user_id` | Registo de que um utilizador pediu para **não** ser lido automaticamente (`/voice optout`). |

Nota sobre o opt-out: pedir `/voice optout` **cria** um registo com o teu `user_id` (para o bot se lembrar da preferência). `/voice optin` remove esse registo. Não é guardada mais nenhuma informação a teu respeito.

---

## 2. Conteúdo das mensagens

Para sintetizar voz, o Voxi **lê o conteúdo de texto** das mensagens nos casos em que age: o comando `/tts`, a auto-leitura de um canal configurado, e menções/respostas (replies) ao bot.

**O texto das mensagens NÃO é guardado em nenhuma tabela da base de dados.** É processado de forma **transitória** em memória: limpeza do texto → aplicação do dicionário de pronúncia → verificação da blocklist → síntese de voz → reprodução. Após a reprodução, o texto em claro não é persistido em lado nenhum.

### 2.1 Cache de áudio

Para evitar re-sintetizar frases repetidas, o Voxi guarda os **ficheiros de áudio gerados** (`.wav`) numa pasta de cache local (`audio-cache/`, ao lado da base de dados). É importante perceber exatamente o que isto implica:

- **A chave (nome do ficheiro) é um hash** `SHA-1` calculado a partir de `texto_limpo + modelo_de_voz + velocidade`. O texto em claro **não** aparece no nome do ficheiro nem na base de dados, e o hash **não** é reversível para recuperar o texto.
- **No entanto, o ficheiro `.wav` em si é o áudio falado da mensagem limpa.** Quem tiver acesso ao sistema de ficheiros da instância pode reproduzir esse ficheiro e ouvir o conteúdo. Isto não é um "esconderijo" do conteúdo — é apenas o áudio gerado, guardado para reutilização.
- A cache é **limitada e regenerável**: por defeito mantém no máximo ~500 ficheiros por motor (política LRU — os mais antigos são apagados primeiro). **Persiste no disco** entre reinícios do bot até ser expulsa pela política de limite, ou até o operador apagar a pasta. Se for apagada, o áudio é simplesmente re-sintetizado quando necessário.

Em resumo: **não guardamos o texto original**, apenas o áudio gerado por hash, que é limitado, regenerável e apagável.

### 2.2 Registos (logs)

O Voxi escreve **logs operacionais** para a consola/terminal (stderr/stdout — em Docker, visíveis via `docker compose logs`). Os logs contêm informação operacional: nível, timestamp, nome de comandos, e mensagens de erro. **Os logs NÃO incluem o conteúdo das mensagens dos utilizadores.** A retenção dos logs é controlada pelo operador da instância (o terminal/sistema onde o bot corre).

---

## 3. Retenção e apagamento de dados

Como o Voxi é self-host, **o operador da instância controla diretamente** o ficheiro SQLite (`DB_PATH`) e a pasta de cache (`audio-cache/`) — ambos são ficheiros locais que podem ser apagados a qualquer momento. No deploy Docker, apagar tudo é `docker compose down -v` (remove o volume com a base de dados e a cache).

Para os utilizadores e administradores de servidor, os comandos do bot permitem remover dados:

| Para remover... | Usa... | Notas |
|---|---|---|
| A tua preferência de voz | `/voice reset` | Apaga o teu registo em `user_voice`. |
| O teu opt-out (voltar a ser lido) | `/voice optin` | Apaga o teu registo em `tts_optout`. |
| Configuração do servidor | `/config reset` | Repõe a `guild_config` aos valores por defeito. **Atenção:** o reset **NÃO** apaga a blocklist nem o dicionário de pronúncia. |
| Uma palavra da blocklist | `/config blockword remove` | Removida individualmente (não pelo `/config reset`). |
| Um termo de pronúncia | `/config pronunciation remove` | Removido individualmente (não pelo `/config reset`). |

> **Não existe um comando único de "apagar todos os meus dados".** Os dados por utilizador vivem em `user_voice` e `tts_optout`, e removem-se com `/voice reset` e `/voice optin`. Em alternativa, o operador da instância pode apagar registos diretamente na base de dados ou apagar os ficheiros locais.

A cache de áudio é regenerável e auto-limitada (ver secção 2.1); apagá-la não perde nenhuma configuração.

---

## 4. Terceiros

- **Discord.** O Voxi liga-se à API/gateway do Discord para funcionar (receber mensagens, entrar em canais de voz, responder). A utilização do Discord rege-se pela [Política de Privacidade do Discord](https://discord.com/privacy).
- **OpenAI (opcional, desligado por defeito).** O motor de TTS por defeito é o **Piper**, que corre **localmente** na máquina da instância — **não envia nada para fora**. Apenas se o operador definir `TTS_ENGINE=neural` é que o **texto limpo a sintetizar** é enviado para a API de TTS da OpenAI (`api.openai.com`) para gerar o áudio. Isto é **opcional**, exige uma chave de API do operador, e está **desligado por defeito**. Quando usado, aplica-se a política de dados da OpenAI.
- **Sem venda de dados. Sem analytics de terceiros. Sem trackers.** O Voxi não vende, aluga nem partilha dados com terceiros para fins de marketing, e não integra serviços de analítica externos.

---

## 5. Contacto / Responsável

O **responsável** por uma instância do Voxi é o **operador** que a corre. Para questões sobre os teus dados num servidor específico, contacta o administrador desse servidor ou o operador do bot.

> **Operador:** preenche aqui o teu contacto antes de tornares o bot público.
>
> - Responsável: `_______________________`
> - Email / contacto: `_______________________`

Os autores do projeto Voxi fornecem apenas o software (open-source); não operam uma instância partilhada nem têm acesso aos dados das instâncias de terceiros.

---

## Nota / Note (EN)

_Voxi is a self-hosted, open-source Discord TTS bot. The instance operator is the data controller. The bot stores only Discord numeric IDs (`guild_id`, `user_id`) plus per-user voice preferences, per-server config, blocklist, pronunciation dictionary and opt-out records in a local SQLite database — no PII (email, real name). Message text is processed transiently to synthesize speech and is **not** stored in any table; only generated `.wav` audio is cached on disk, named by an SHA-1 hash of (cleaned text + voice + speed). The cache is capped (~500 files/engine, LRU), regenerable and deletable. Logs (console/stderr) contain operational data, **not** message content. Piper runs locally; only if `TTS_ENGINE=neural` (opt-in, off by default) is text sent to OpenAI's TTS API. No data sale, no third-party analytics. Removal: `/voice reset`, `/voice optin`, `/config reset` (note: reset does not clear blocklist/pronunciation — use `/config blockword remove` and `/config pronunciation remove`); the operator can delete the SQLite file and cache folder directly._
