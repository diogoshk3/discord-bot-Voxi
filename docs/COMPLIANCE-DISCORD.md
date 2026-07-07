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

### 2.1 Monetização (a regra mais importante — "Requisitos de Monetização")
Quem vende features pagas é obrigado a (i) vendê-las **também via Premium Apps do Discord**
e (ii) com **price parity** (não mais caro no Discord). O Vozen vende via Ko-fi/códigos.
**Ainda não é violação** porque a regra só se aplica "na medida em que os Premium Apps
suportem o locale e o tipo de oferta" — e os Premium Apps exigem app **Verificada** + Team,
o que o Vozen ainda não é. Portugal está nos locales suportados.
- **Plano (Fase 3, ~75 servidores):** criar Team → verificar a app → onboarding de Premium
  Apps → SKUs em USD (user sub ≙ Plus €1.99, guild sub ≙ Premium €4) com price parity face
  ao Ko-fi. Taxa do Discord: 15% no Growth Tier até $1M. O Ko-fi pode continuar desde que o
  preço no Discord não seja superior.

### 2.2 Transparência dos dados — FECHADO na Fase 1
`PRIVACY.md` estava desatualizado (faltavam tabelas, em especial o **clone de voz**).
Corrigido: todas as tabelas documentadas, secção 2.3 dedicada ao clone (WAVs, consentimento,
`/voice clone delete`), contacto do operador preenchido, idade 13+.

### 2.3 Canal de denúncia — FECHADO na Fase 1
Existe servidor de suporte (`discord.gg/V6PZYZmhcQ`). Ligado ao `/help` (env `SUPPORT_URL`),
à Privacidade e aos Termos.

### 2.4 Voice clone — zona cinzenta (parcialmente aberta)
O consent flow é sólido (botão Permitir/Recusar que só o alvo carrega; grava só o SSRC do
alvo; `consent_at`). Mas a amostra fica atribuída a **quem correu o comando**, e **só essa
pessoa a pode apagar** — a pessoa gravada não consegue revogar. Amostras de voz podem ser
"dados sensíveis/biométricos" (RGPD, regra 16).
- **Fase 1 (feito):** documentado com verdade em toda a política (a antiga dizia "só a
  própria voz" — falso).
- **Plano (Fase 2, código):** guardar `target_id` em `user_clone` e permitir que a pessoa
  gravada apague a amostra a qualquer momento; guardar metadados do consentimento.

## 3. Notas

- **Licença:** o site dizia "MIT" — corrigido para **AGPL-3.0** (a licença real do repo).
- **gTTS não-oficial:** a instância pública usa o endpoint não-oficial do Google Translate
  TTS. Em regra com o Discord, mas em tensão com os termos da Google; o `router` já cai para
  Piper se a Google fechar a porta. (Risco de terceiros, não do Discord.)
- **Breach:** o ToS de developer (§5) obriga a notificar o Discord e os afetados em caso de
  acesso não autorizado a Dados da API. Documentar o processo antes de escalar.
- **Rever:** o artigo da política foi atualizado em 2026-07-07 — reavaliar periodicamente.
