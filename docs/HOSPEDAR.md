# Hospedar o Voxi (produção)

## Arranque num comando

```
npm run start:prod
```

Isto:

1. Faz `npm run build` (compila TypeScript → `dist/`).
2. **Pré-aquece a voz** (`@snazzah/davey`) — ver Smart App Control abaixo.
3. Arranca `node dist/index.js` com **auto-restart** (backoff 2s→60s) se o bot crashar.

Pára com **Ctrl-C** (SIGINT).

> Requer `.env` configurado (`DISCORD_TOKEN`, `PIPER_PATH`, `MODELS_DIR`, …). O
> `npm run dev` (`tsx watch`) é só para **desenvolvimento** — recarrega a cada
> alteração de ficheiro e pode crashar em edições a meio; NÃO usar para hospedar.

## Smart App Control (Windows) — o bloqueio do davey

Sintoma no arranque:

```
Error: Cannot find native binding … davey.win32-x64-msvc.node
Uma política de Controlo de Aplicações bloqueou este ficheiro. (ERR_DLOPEN_FAILED)
```

**Causa:** o Smart App Control do Windows 11 avalia binários nativos por *reputação
na cloud da Microsoft*. O `@snazzah/davey` (módulo de encriptação de voz DAVE) é
recente/raro; no **primeiro** load, enquanto a reputação não resolve, o SAC **bloqueia
por precaução**. Não é bug do bot — módulos populares (sodium, sqlite) passam por já
terem reputação.

**Solução (automática):** o `start:prod` já faz o pré-aquecimento com **até 5
tentativas** — normalmente à 1.ª/2.ª a reputação resolve e passa. Só volta a acontecer
se reinstalares `node_modules` ou atualizares o Node (binário novo → reputação
"desconhecida" outra vez).

**Se persistir** (bloqueia sempre, mesmo com internet): último recurso é **desligar o
Smart App Control** (Segurança do Windows → Controlo de aplicações e navegador →
Smart App Control → Desligado). ⚠️ É porta de sentido único — depois de OFF só se
volta a ligar reinstalando o Windows. Como o bot funciona com o SAC ligado (via
pré-aquecimento), **não é recomendado**.

## Concorrência de síntese

Cada síntese (cache miss) arranca um `piper.exe`. O nº máximo em simultâneo é limitado
(default `max(1, núcleos-1)`); ajusta com a env **`PIPER_MAX_CONCURRENCY`** (inteiro
positivo) se precisares de o baixar (máquina fraca) ou subir.

## Medir performance

```
npx tsx tools/bench.ts   # escreve/atualiza BENCHMARKS.md
```
