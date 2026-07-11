# Plano — Motor neural OpenAI como perk Premium (upgrade #2)

Escrito por Fable 5 a 2026-07-11, contra o HEAD atual de `main`. Execução: Opus, após "executa" do Diogo.

## Objetivo

Transformar o `NeuralEngine` já existente (OpenAI, `src/tts/neural.ts` — hoje só acessível via
`TTS_ENGINE=neural` global e nunca verificado ao vivo) num **4º motor por-utilizador**
(`/voice set engine: Neural`), **exclusivo de quem tem Vozen Plus ou Premium do servidor**,
com fallback seguro para o Google e salvaguardas de custo. É o primeiro perk Premium com
custo variável real — o gate tem de ser à prova de bala.

**Assunções:** (1) mantemos a API `audio/speech` da OpenAI; (2) o modelo passa a ser
configurável por env, default `gpt-4o-mini-tts` (mais recente e mais barato que `tts-1`);
(3) o Diogo cria/funda a OPENAI_API_KEY quando quiser ligar em produção — sem key, o motor
degrada para gTTS (mesmo padrão do Kokoro sem sidecar), por isso dá para fazer merge e deploy
antes de haver key.

## Scope

### In
- `'neural'` como valor de `UserEngine` (store), `SynthRequest.engine` e choice do `/voice set`.
- Gate Premium duplo: no `/voice set` (mensagem "locked" + upsell) E em runtime na síntese
  (Premium expirou → cai para Google em silêncio, sem quebrar a fala).
- Fallback por falha: neural → Google via `RouterEngine` (ninguém fica sem voz).
- Salvaguardas de custo: cap de chars por síntese + orçamento diário global de chars, ambos
  por env; métricas de uso.
- Cache: namespace próprio `neural` + `engine` na cacheKey (não cruzar áudio entre motores).
- i18n das mensagens novas (catálogo do bot, ~35 locales), `.env.example`, ARCHITECTURE.md.
- TDD em tudo (vitest).

### Out (deliberado)
- Escolha de voz OpenAI pelo user (alloy/nova/onyx…): v1 usa o `mapVoice` existente
  (default `alloy`). Expor pseudo-modelos `openai-*` fica para v2 se o motor pegar.
- Instructions/steerability do `gpt-4o-mini-tts` (tom, emoção) — v2.
- Ponto na matriz de preços do site (10 línguas i18n do site) — decidir com o Diogo depois
  de ouvir a qualidade real; não bloqueia o bot.
- Premium Apps/entitlements do Discord — já coberto noutro plano.

## Fases

### Fase 1 — Núcleo: neural como 4º motor por-user (TDD)
Deliverable: `PerUserEngineRouter` despacha `engine:'neural'` para um caminho
neural→Google; sem `OPENAI_API_KEY`, o caminho neural É o Google.
- [ ] `UserEngine` e `SynthRequest.engine`: `+ 'neural'` (userVoice.ts, engine.ts)
- [ ] cacheKey: `'neural'` junta-se a `'piper'|'kokoro'` como engine que entra na chave (cache.ts)
- [ ] `NeuralEngine`: modelo por env (`config.neuralModel`, default `gpt-4o-mini-tts`), resto igual
- [ ] factory `createPerUserEngine`: caminho `neural` = `RouterEngine([{neural, langs:null}, {google, langs:null}])` quando há key; sem key = `google` (padrão Kokoro)
- [ ] `PerUserEngineRouter`: 4º ramo + testes (despacho, fallback, sem-key)
- Done: `npx vitest run` verde; teste prova que sem key `neural === google` (identidade de rota)

### Fase 2 — Gate Premium + /voice set
Deliverable: só Premium/Plus consegue definir e usar o motor neural.
- [ ] definitions.ts: choice `💎 Neural (OpenAI)` no `engine` do `/voice set`
- [ ] voice.ts: ao definir `engine:'neural'` sem Premium → mensagem locked + upsell
      (padrão de `voice.effect.locked`, isUserPremium ∥ isGuildPremium)
- [ ] session.ts (runtime): ao construir o SynthRequest com `engine:'neural'`, revalidar
      Premium; expirado → `engine:'google'` para este pedido (sem tocar na escolha guardada)
- [ ] i18n: 2 chaves novas (`voice.engine.neuralLocked`, `voice.engine.neuralSet`) × ~35 locales
- Done: teste vitest do gate no set E do downgrade em runtime; suite verde

### Fase 3 — Salvaguardas de custo + observabilidade
Deliverable: impossível uma fatura surpresa — mesmo no pior caso matemático.
O risco central: o Premium vende-se POR SERVIDOR (€3.99/3), mas o custo neural é POR USO
de cada membro desses servidores. As médias protegem (modelo ginásio), mas os caps têm de
conter os outliers. **3 camadas**, todas com fallback silencioso para o Google (sem erro):
**Limites definidos pelo Diogo (2026-07-11), em caracteres/mês:**
- [ ] `NEURAL_MAX_CHARS` (default 500): pedido mais longo → Google direto
- [ ] **Plus (pessoal)**: `NEURAL_PLUS_MONTHLY_CHARS`, default **25 000 chars/MÊS por
      pessoa** (≈ €0.35 de custo máx; ≈ 500 msgs/mês; segue o user para qualquer servidor)
- [ ] **Premium (servidor)**: `NEURAL_GUILD_MONTHLY_CHARS`, default **50 000 chars/MÊS por
      servidor** (≈ 56 min de áudio; ≈ $0.75 máx; pool partilhado pelos membros)
- [ ] Precedência quando ambos se aplicam: o Plus do próprio gasta primeiro (bolso pessoal);
      sem Plus, gasta do pool do servidor Premium
- [ ] Contadores MENSAIS PERSISTENTES em SQLite (tabela `neural_usage(scope, key, month,
      chars)`, mês YYYY-MM UTC) — em memória um restart daria reset grátis ao orçamento
- [ ] Backstop GLOBAL/dia (`NEURAL_DAILY_CHAR_BUDGET`, default 300 000, em memória):
      disjuntor contra bugs/abuso — não é para se sentir em uso normal; 0 = desligado
- [ ] Contadores diários em memória (reset à meia-noite UTC; reinício do bot = reset — aceitável,
      o orçamento é proteção, não contabilidade)
- [ ] métricas: `neural_synths`, `neural_chars`, `neural_fallbacks` no /stats interno
- Done: testes dos 4 caps (por-pedido, user, guild, global) + reset diário + métricas; suite verde

### Fase 4 — Fecho e ativação
Deliverable: deploy em produção, inerte até haver key.
- [ ] `.env.example`: `OPENAI_API_KEY`, `NEURAL_MODEL`, `NEURAL_MAX_CHARS`, `NEURAL_DAILY_CHAR_BUDGET` documentados (nota de custo por modelo)
- [ ] ARCHITECTURE.md: secção do motor neural por-user
- [ ] Suite completa + typecheck + build + commit + push (deploy-bot.yml)
- [ ] **[needs Diogo]** criar OPENAI_API_KEY (com spending limit na OpenAI!), colar no `.env` do VPS, restart, e testar ao vivo `/voice set engine:Neural` num servidor Premium
- Done: fala neural ouvida ao vivo; sem key, bot comporta-se exatamente como hoje

## Riscos

- **Custo variável real, assimétrico ao preço** — o Premium vende acesso por servidor
  (€3.99/3) mas o custo é por uso de cada membro; um único servidor grande e ativo podia
  dar prejuízo (é o ponto fraco do modelo do TTS Bot: €10/5 servidores com uso ilimitado).
  Mitigação: gate Premium duplo + allowances MENSAIS por origem do acesso (Plus 25k/mês
  /pessoa ≈ €0.35 máx; Premium 50k/mês/servidor ≈ $0.75 máx — decisão do Diogo
  2026-07-11) + backstop global diário + hard limit na conta OpenAI (Fase 4).
- **Margem garantida por construção**: pior caso Plus = €0.35 de custo vs €1.99 de
  receita (≥82% de margem); pior caso Premium = 3×$0.75 = $2.25 vs €3.99 no deal de 3
  servidores, e 8×$0.75 = $6.00 vs €7.99 no de 8 (deal grande reduzido de 10 para 8 a
  2026-07-11) — positivo em TODOS os planos mesmo com todos os allowances esgotados.
  Nunca há prejuízo.
- **O allowance esgota-se e o resto do mês é Google**: 1h de áudio/servidor/mês é
  confortável para uso ocasional, curto para servidores que vivam no neural. Esperar
  feedback "acabou a voz boa" — a resposta é subir o número no `.env` quando a receita
  justificar, ou vender allowance extra como upsell futuro.
- **NeuralEngine nunca foi verificado ao vivo** (o próprio código o diz). A Fase 4 é a
  primeira síntese real; se a API responder diferente do esperado (formato wav, campos),
  ajusta-se aí — o fallback garante que os users não sentem nada entretanto.
- **Qualidade multilingue incerta**: as vozes OpenAI são boas em EN; noutras línguas podem
  ter sotaque. Decisão site/marketing só DEPOIS de ouvir (por isso o ponto da matriz está Out).
- **Latência**: +0.5–2s vs gTTS. Aceitável num perk opt-in; se incomodar, é argumento para
  restringir `langs` do route neural a um set curado em vez de apanha-tudo.

## MVP

Fases 1+2: motor neural selecionável, gated, com fallback — testável de imediato num
servidor com Premium (mesmo com budget/caps ainda por afinar). Fase 3 antes de anunciar.

Próxima ação concreta: Fase 1 — teste RED em `tests/perUserRouter.test.ts` para o despacho de `engine:'neural'`.
