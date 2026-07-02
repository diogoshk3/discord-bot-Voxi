# BENCHMARKS — Voxi (baseline)

Gerado por `npx tsx tools/bench.ts`. Piper real; cache temporária isolada.
Hoje NÃO há streaming: tempo-até-1.ª-palavra == tempo total de síntese abaixo.

- Piper: `C:\Users\diogo\piper_pkg\piper\piper.exe`
- Modelos: 38 em `C:\Users\diogo\piper_pkg\piper\models`
- Cap de concorrência (PIPER_MAX_CONCURRENCY / max(1,núcleos-1)): **15**

- Voz PT: `pt_PT-tugao-medium` · Voz EN: `en_US-amy-medium`

## Latência de síntese FRIO (cache miss)

| Tamanho | Voz | corridas | p50 (ms) | p95 (ms) | min | max |
|---|---|---:|---:|---:|---:|---:|
| curto (~6 palavras) | PT | 8 | 408 | 571 | 401 | 571 |
| curto (~6 palavras) | EN | 8 | 430 | 550 | 421 | 550 |
| médio (~30 palavras) | PT | 8 | 812 | 842 | 764 | 842 |
| médio (~30 palavras) | EN | 8 | 859 | 975 | 830 | 975 |
| longo (~90 palavras) | PT | 5 | 1850 | 1874 | 1791 | 1874 |
| longo (~90 palavras) | EN | 5 | 2109 | 2211 | 2066 | 2211 |

## Latência QUENTE (cache hit)

| Amostra | ms |
|---|---:|
| curto (~6 palavras) PT | 0.23 |
| curto (~6 palavras) EN | 0.09 |
| médio (~30 palavras) PT | 0.08 |
| médio (~30 palavras) EN | 0.08 |
| longo (~90 palavras) PT | 0.07 |
| longo (~90 palavras) EN | 0.07 |

## Overhead do spawn (síntese de 1 palavra)

- p50 **372 ms**, p95 506 ms (piso ≈ spawn + síntese mínima).

## Hit-rate da cache (replay sintético)

- 20/30 hits = **67%** neste replay (repetições típicas de chat).
> Se baixo em produção real (mensagens quase sempre únicas), a cache dá pouco — T2.3 decide com números.

## Recursos

- RSS antes: 74 MB · depois: 69 MB

---
_Baseline ANTES das otimizações da Fase 2 (pool/streaming). Re-correr no fecho (T5.1) para a tabela ANTES/DEPOIS._
