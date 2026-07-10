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
- **Encriptação em repouso (ToS §5(c)) — LACUNA ABERTA.** O disco do VPS **não** é cifrado
  (ext4 puro, verificado). A BD e os `.wav` de clones estão em claro. Plano e runbook de
  incidentes em `docs/INCIDENT-RESPONSE.md` + COMPL·5; a migração da BD de produção precisa
  de **aprovação explícita** do operador (é o passo mais arriscado). Alvo prioritário: os
  `.wav` biométricos.
- **Regra permanente (NOVO).** `CLAUDE.md` tem uma secção "Discord compliance is mandatory"
  que toda a feature futura respeita.
- **Portal (pendente do Diogo):** preencher Privacy/ToS URL; confirmar elegibilidade de
  Premium Apps no separador Monetization (COMPL·1) — desbloqueia a decisão de monetização.
