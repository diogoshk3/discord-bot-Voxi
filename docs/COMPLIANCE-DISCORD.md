# Conformidade com a Política de Desenvolvedor do Discord — Vozen

> Estudo feito a 2026-07-07 cruzando a [Política de Desenvolvedor do Discord](https://support-dev.discord.com/hc/articles/8563934450327-Discord-Developer-Policy)
> (versão em vigor, atualizada pelo Discord em 2026-07-07) e a Política/Requisitos de
> Monetização (incorporados por referência) com um inventário do código do bot.
> **Veredito: o Vozen não viola nenhuma regra de forma ativa.** Havia 4 pontos amarelos;
> a Fase 1 (transparência) fechou os de texto. Os restantes têm plano abaixo.

## 1. O que já está conforme

| Regra da política | Estado no Vozen |
|---|---|
| 15/20/21 — usar Dados da API só para a função declarada; não minerar; não treinar IA com conteúdo de mensagens | ✅ Texto processado em memória para TTS, **nunca persistido**; sem scraping; sem treino de IA. |
| 16–19 — não perfilar, não vender, não partilhar com data brokers/ads | ✅ Só IDs numéricos + preferências; nada vendido/partilhado; sem analytics/trackers. |
| 5–7 — não contactar utilizadores sem permissão; sem DMs/anúncios não solicitados | ✅ O bot **nunca envia DMs**; todas as mensagens são respostas funcionais em canais. |
| 1–3 — não modificar contas sem permissão; respeitar opt-out/remoção | ✅ `/voice optout` respeitado; bot `selfDeaf`; kill-switch e remoção por admins. |
| 4, 8, 10–13 — sem credenciais, atividades ilegais, conteúdo violento/adulto, impersonação, manipulação de engajamento | ✅ Jogos limpos; wordlists com profanidade filtrada; sem NSFW. |
| 9 — não dirigido a menores de 13 | ✅ Idade mínima 13+ declarada nos Termos e na Privacidade (Fase 1). |
| Denúncia/suporte + disponibilidade | ✅ Servidor de suporte no `/help`, na Privacidade e nos Termos (Fase 1). |
| Política de privacidade + Termos publicados | ✅ `PRIVACY.md`, `TERMS.md`, `site/privacy.html`, `site/terms.html`. |

## 2. Pontos amarelos e plano

### 2.1 Monetização (a regra mais importante — "Requisitos de Monetização") — CÓDIGO PRONTO
Quem vende features pagas é obrigado a (i) vendê-las **também via Premium Apps do Discord**
e (ii) com **price parity** (não mais caro no Discord). O Vozen vende via Ko-fi/códigos.
**Ainda não é violação** porque a regra só se aplica "na medida em que os Premium Apps
suportem o locale e o tipo de oferta" — e os Premium Apps exigem app **Verificada** + Team,
o que o Vozen ainda não é. Portugal está nos locales suportados.
- **Fase 3 (feito no código):** `src/premium/entitlements.ts` + `syncDiscordEntitlements()`
  mapeiam subscrições Premium Apps ativas para as tabelas `premium_*` (`source='discord'`),
  reconciliando no ClientReady e em cada evento `Entitlement*`. **INERTE** até
  `PREMIUM_GUILD_SKU_ID`/`PREMIUM_USER_SKU_ID` estarem definidos (hoje é no-op). Paridade de
  preços documentada em `docs/MONETIZATION.md` (SKU USD ≤ preço externo).
- **Passos manuais (só o Diogo, no Developer Portal):** criar Team → verificar a app (~75
  servidores) → onboarding de monetização → criar SKUs (USD) → definir `PREMIUM_*_SKU_ID` na
  env (a sync ativa-se sozinha). Taxa do Discord: 15% (Growth Tier até $1M).

**Atualização 2026-07-11 (estado do portal):** o separador Monetization mostra o onboarding
"Monetize seu aplicativo" com "Comece agora" — ou seja, a app **pode iniciar** o onboarding
de Premium Apps (não está bloqueada). Mas **completá-lo** exige preencher requisitos legais,
**verificar a app + Team**, e configurar pagamentos/impostos (Discord fica com ~15%). É uma
decisão de **negócio**, não só um checkbox. **Decisão (interim):** manter a venda via Ko-fi;
vender só por Ko-fi é um **risco residual baixo** (não uma violação clara) enquanto o
onboarding de Premium Apps não estiver **completo**. **Gate:** completar o onboarding + criar
SKUs com **preço ≤ Ko-fi** quando se formalizar o negócio (ou naturalmente ao verificar a app
aos ~75 servidores). O `.env` já documenta `PREMIUM_GUILD_SKU_ID`/`PREMIUM_USER_SKU_ID`.

### 2.2 Transparência dos dados — FECHADO na Fase 1
`PRIVACY.md` estava desatualizado (faltavam tabelas, em especial o **clone de voz**).
Corrigido: todas as tabelas documentadas, secção 2.3 dedicada ao clone (WAVs, consentimento,
`/voice clone delete`), contacto do operador preenchido, idade 13+.

### 2.3 Canal de denúncia — FECHADO na Fase 1
Existe servidor de suporte (`discord.gg/V6PZYZmhcQ`). Ligado ao `/help` (env `SUPPORT_URL`),
à Privacidade e aos Termos.

### 2.4 Voice clone — FECHADO (Fases 1 e 2)
O consent flow é sólido (botão Permitir/Recusar que só o alvo carrega; grava só o SSRC do
alvo; `consent_at`). A amostra fica atribuída a quem correu o comando. Amostras de voz podem
ser "dados sensíveis/biométricos" (RGPD, regra 16).
- **Fase 1 (feito):** documentado com verdade em toda a política (a antiga dizia "só a
  própria voz" — falso).
- **Fase 2 (feito):** coluna `target_id` em `user_clone` (migração idempotente, backfill =
  auto-clone); `deleteClonesByTarget()`; `/voice clone delete` agora **também revoga** todos
  os clones que outras pessoas fizeram a partir da voz de quem corre o comando — a pessoa
  gravada pode sempre retirar o consentimento (RGPD, direito ao apagamento).

## 3. Notas

- **Licença:** o site dizia "MIT" — corrigido para **AGPL-3.0** (a licença real do repo).
- **gTTS não-oficial:** a instância pública usa o endpoint não-oficial do Google Translate
  TTS. Em regra com o Discord, mas em tensão com os termos da Google; o `router` já cai para
  Piper se a Google fechar a porta. (Risco de terceiros, não do Discord.)
- **Breach:** o ToS de developer (§5) obriga a notificar o Discord e os afetados em caso de
  acesso não autorizado a Dados da API. Documentar o processo antes de escalar.
- **Recompensa por voto (growth loop):** um voto no top.gg dá **24h de Vozen Plus** grátis
  (`source='vote'`, `vote_reward`), limitado a **1× a cada 30 dias** por conta. Conforme com
  o top.gg — que **permite** incentivar VOTOS (nunca REVIEWS/ratings, que ficam de fora por
  design; a copy pede sempre "votar"). Sem DM (hard rule). Dados: só `{user_id, rewarded_at}`,
  disclosado no PRIVACY.md e apagável por `/privacy erase`.
- **Rever:** o artigo da política foi atualizado em 2026-07-07 — reavaliar periodicamente.

## Atualização 2026-07-11 (re-auditoria + novo trabalho)

Re-auditados os 3 documentos (ToS de Desenvolvedor, Política, Termos do SDK Social). O
**SDK Social não se aplica** (é para integrações em jogos). Confirmado o veredito: sem
violações ativas. Plano completo em `docs/PLAN-DISCORD-COMPLIANCE.md`. Deltas fechados:

- **Direito ao esquecimento — `/privacy erase` (NOVO).** Um comando apaga TODOS os dados
  pessoais do utilizador em qualquer servidor, com confirmação por botão. Revoga também os
  clones da voz dele feitos por outros. Retém o premium pago + histórico financeiro (exceção
  de contrato/retenção legal). `store/dataLifecycle.ts::eraseUser` (testado). Antes a
  eliminação estava espalhada por vários comandos; agora há o "apagar tudo".
- **Retenção limitada — purga de servidores saídos (NOVO).** Os dados de um servidor que
  remove o bot são apagados 30 dias depois se não houver re-convite (`store/guildDeparted.ts`,
  marcado no `GuildDelete` REAL — o guard de outage já existia). Fecha o ToS §5(b)
  ("não reter além do necessário"). Financeiro/entitlement retido.
- **Rot-guard de conformidade (NOVO).** As tabelas apagadas por purga/erase são listas
  explícitas com um teste (`tests/dataLifecycle.test.ts`) que FALHA se uma tabela nova com
  `guild_id`/`user_id` não for categorizada — mantém a purga/erase completas no futuro.
- **Encriptação em repouso (ToS §5(c)) — clones CIFRADOS; BD em defer.** Os `.wav` de clone
  (dado biométrico, o mais sensível) passam a ser cifrados em repouso com AES-256-GCM
  (`tts/cloneCrypto`, testado); `CLONE_KEY` ativo em produção (verificado por round-trip).
  Retrocompatível. **Ainda em claro:** a BD SQLite (Discord IDs, prefs, hashes de email) —
  cifrá-la via SQLCipher é o passo mais arriscado do plano e fica em **defer deliberado**
  (spike + backup + aprovação numa sessão dedicada). O disco do VPS não é cifrado ao nível
  do volume (ext4 puro, verificado). Caveat: a `CLONE_KEY` vive no `.env` na mesma máquina.
- **Regra permanente (NOVO).** `CLAUDE.md` tem uma secção "Discord compliance is mandatory"
  que toda a feature futura respeita.
- **Portal (pendente do Diogo):** preencher Privacy/ToS URL; confirmar elegibilidade de
  Premium Apps no separador Monetization (COMPL·1) — desbloqueia a decisão de monetização.

## 4. DISCORD-03 — recomendação sobre a intent privilegiada `GuildMembers` (plano 032)

`src/bot/client.ts:35` pede `GatewayIntentBits.GuildMembers` (privilegiada — sujeita a
revisão manual no gate de verificação dos ~75 servidores, junto com Message Content).
Auditoria (2026-07-14): não há NENHUM handler `GuildMember*` no código nem qualquer
`members.fetch()` em massa. O ÚNICO consumidor é a resolução de nome para TTS —
`cleanText.resolveUser` em `messageHandler.ts:241-244` e `handlers/core.ts:132` — que
lê `message.guild.members.cache.get(id)?.displayName`, com fallback em cascata para
`users.cache.get(id)?.username` e depois para o literal `'alguem'`. Ou seja: **já degrada
bem sem a intent** — nunca rebenta, só passa a dizer o username (ou "alguem") em vez do
nickname do servidor quando o membro mencionado não está em cache.

**Trade-off:**
- **Manter a intent:** nomes falados mais corretos (nickname do servidor) mesmo para
  membros que a cache ainda não viu interagir; custo = mais um item a justificar na
  revisão de verificação (a intent tem de aparecer coerente com a funcionalidade
  declarada — "ler o nome de quem é mencionado numa mensagem lida em voz alta" é uma
  justificação simples e verdadeira).
- **Largar a intent:** footprint de privilégios menor, história de verificação mais
  limpa (menos uma intent privilegiada para o revisor escrutinar); custo = nomes
  mencionados de gente fora da cache passam a sair como username (ou "alguem"), nunca
  o nickname do servidor — uma pequena perda de qualidade percebida no TTS, não uma
  quebra funcional.

**Recomendação: MANTER por agora.** O custo real de a ter é só administrativo (mais uma
linha a justificar no formulário de verificação), o benefício (nickname certo em vez de
username) é visível a cada leitura de mensagem com menção, e não há nenhum uso indevido
no código a limpar primeiro. Reavaliar no momento da verificação real (~75 servidores):
se o formulário/revisor tornar esta intent especificamente onerosa de justificar, larga-la
é uma mudança pequena e isolada (`client.ts` + um teste a confirmar que a menção cai no
fallback de username/"alguem"), documentada aqui como decisão explícita a essa altura.
**Sem mudança de código nesta entrada** (plano 032, item E — decisão do maintainer, não
uma correção de código).
