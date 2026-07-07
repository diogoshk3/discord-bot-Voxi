# Plan 016: Hybrid engine Phase 2 — add Kokoro (kokoro-onnx) to the RouterEngine as the top-quality engine for its languages

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat HEAD -- src/tts/factory.ts src/tts/router.ts src/tts/engine.ts src/tts/cloneEngine.ts src/config/index.ts`
> The "Current state" excerpts below were captured after plans 001–015 landed
> (commit with plan 015 DONE). If any in-scope file changed since, compare the
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition. The `router` branch of `createEngine` already carries a
> comment reserving Kokoro's slot — that is EXPECTED, not drift.

## Status

- **Priority**: P2 (product differentiator: free-voice quality)
- **Effort**: L
- **Risk**: MED (new Python sidecar + CPU-latency unknown, fully behind fallback)
- **Depends on**: plan 015 (commands split — landed). Builds on the RouterEngine
  from "Vaga 2 Fase 1" (gTTS→Piper), already shipped.
- **Category**: feature
- **Decisions locked (by the operator)**:
  1. **Runtime = `kokoro-onnx`** (ONNX Runtime, CPU-only, no PyTorch/CUDA). A
     NEW, isolated Python sidecar — do NOT reuse the Chatterbox clone venv.
  2. **Free for everyone**: Kokoro is the top router engine for the languages it
     supports; every user gets better voices. NO premium gating in this plan.

## Goal / Objetivo

Add a `KokoroEngine` (implements `TTSEngine`) backed by a `kokoro-onnx` Python
sidecar, and slot it as the FIRST route in the `router` engine for the ~8
languages Kokoro supports. Reliability and coverage are unchanged: if the
sidecar is absent or a synth throws, the router falls through to gTTS→Piper
exactly as today. Zero behavior change when `TTS_ENGINE !== 'router'` or when the
sidecar is not installed.

## Why this matters

`docs/RESEARCH-TTS-BOT-VS-VOXI.md` and `docs/MONETIZATION.md` both name
Kokoro-quality free voices as the product's core differentiator. The
`RouterEngine` (`src/tts/router.ts`) was explicitly designed for a third,
higher-priority engine — `src/tts/factory.ts:76-77` already reads *"O Kokoro
(Fase 2) entrará ANTES do gTTS para as suas ~8 línguas, sem perder cobertura."*
This plan fills that reserved slot with the smallest possible, fully-isolated,
fallback-guarded change.

## Current state (verify before editing)

- **`src/tts/engine.ts`** — the contract every engine implements:
  `interface TTSEngine { synth(req: SynthRequest): Promise<string> }` (returns an
  absolute `.wav` path). `SynthRequest` has `text`, `model`, `speed`,
  `leadSilenceMs?`, `singleVoice?`, `segments?`, `engine?`, `effect?`,
  `cloneRef?`.
- **`src/tts/router.ts`** — `RouterEngine` (`synth`, lines 44-65): computes
  `key = langKeyOfModel(req.model)` (from `../language/spokenPhrases`), filters
  `routes` to those with `langs === null || langs.has(key)`, tries each in
  order, and **on `throw` falls to the next**; the last route MUST be catch-all
  (`langs: null`). `EngineRoute = { engine: TTSEngine; langs: Set<string> | null;
  label: string }`.
- **`src/tts/factory.ts`** — `createEngine`, the `router` branch (lines 72-90)
  builds `routes = [ {gtts, langs:null}, {piper, langs:null} ]` and returns
  `new RouterEngine(routes)`. `makePiper` (48-56) and the per-user engine (28-46)
  are OUT of scope. The reserved-slot comment is at 76-77.
- **`src/tts/cloneEngine.ts`** — the REFERENCE Python-sidecar pattern to mirror:
  `spawn`ed `ChildProcess`, a warmup→`{ready}` handshake, an internal FIFO
  `queue`/`active` job model, a per-synth timeout (`SYNTH_TIMEOUT_MS`) and a
  ready-deadline (`READY_TIMEOUT_MS`, added by plan 001), and
  `resolveCloneCmd(explicit)` which auto-detects `tools/clone-venv/Scripts/
  python.exe` + `tools/clone_server.py`, returning `null` when nothing is
  installed (engine stays inert). Kokoro mirrors this MINUS the single-GPU
  serialization (Kokoro is CPU; use a bounded concurrency cap instead) and,
  crucially, **KokoroEngine.synth THROWS on any failure** (the router needs the
  throw to fall through) — it does NOT swallow-to-normal like CloneEngine.
- **`tools/setup-clone.ps1` + `tools/requirements-clone.txt`** — the install
  template: a PowerShell script that creates a gitignored venv and
  `pip install -r` the pinned requirements. Mirror as `setup-kokoro.ps1` +
  `requirements-kokoro.txt` into `tools/kokoro-venv/` (add to `.gitignore`).
- **`src/config/index.ts`** — env helpers already exist:
  `numEnvPositive(name, default, {integer})`, `boolEnvDefaultOff(name)`, and
  string env reads. `AppConfig.ttsEngine` is one of
  `piper|neural|gtts|router`. Add Kokoro config fields here (see Phase 3).
- **`.env.example`, `CLAUDE.md`, `docs/ARCHITECTURE.md`** — document the optional
  clone sidecar; add a parallel Kokoro note (Phase 4).
- **`src/tts/gtts.ts`** — `mapWithConcurrency<T,R>(items, limit, fn)` (added by
  plan 009) is a ready-made bounded-concurrency helper if the sidecar needs one.

Conventions: comments in Portuguese; TS `NodeNext`, `strict`; tests are flat
files in `tests/` named after the module (`tests/kokoroEngine.test.ts`); the full
suite is the primary gate (**1349 passing** at plan-015 DONE). CI runs
`build` + `typecheck` + `lint` + `format:check` + `vitest` — new files must pass
all five.

## Commands you will need

| Purpose             | Command                                          | Expected                              |
| ------------------- | ------------------------------------------------ | ------------------------------------- |
| Install (node)      | `npm install`                                    | exit 0                                |
| Build               | `npm run build`                                  | exit 0                                |
| Typecheck tests     | `npm run typecheck`                              | exit 0                                |
| Lint / format       | `npm run lint` && `npm run format:check`         | 0 errors / all formatted              |
| Tests (primary gate)| `npx vitest run`                                 | **≥1349 pass, 0 fail** (never down)   |
| Sidecar install     | `pwsh tools/setup-kokoro.ps1`                    | venv built, `pip` ok                  |
| Sidecar smoke       | `echo '<json line>' \| tools/kokoro-venv/.../python tools/kokoro_server.py` | prints a `.wav` path |

## Scope

### In

- `tools/requirements-kokoro.txt`, `tools/setup-kokoro.ps1`,
  `tools/kokoro_server.py` (new sidecar).
- `src/tts/kokoroEngine.ts` (new; implements `TTSEngine`).
- `src/tts/factory.ts` — ONLY the `router` branch: prepend the Kokoro route
  (gated on the sidecar being present).
- `src/config/index.ts` — new Kokoro config fields + env reads.
- `tests/kokoroEngine.test.ts` (new) + `tests/factory.test.ts` (extend the
  route-order assertion).
- Docs: `.env.example`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `.gitignore`.

### Out (do NOT touch)

- `src/tts/router.ts` — the engine is generic; it needs NO change (Kokoro is
  just another route). If you find yourself editing it, stop.
- `src/tts/cloneEngine.ts`, `piper.ts`, `piperPool.ts`, `gtts.ts`, `neural.ts`,
  `perUserRouter.ts`, `circuitBreaker.ts`, `multiSegment.ts` — read as
  references, do not modify.
- Per-user engine selection (`createPerUserEngine`), `/voice` UI, premium
  gating/entitlements — explicitly deferred; Kokoro is transparent (same model
  ids, better rendering).
- Any change to the caching keys or the `SynthRequest` shape.

## Phases

Ordered so the biggest unknown (does kokoro-onnx run acceptably on this box, and
does it sound good?) is killed FIRST, before any integration cost.

### Phase 0 — Spike: prove kokoro-onnx runs + sounds good (throwaway)

- [ ] In a scratch venv, `pip install kokoro-onnx` (+ its model/voices assets),
      synthesize one English and one Brazilian-Portuguese sentence to WAV via a
      ~15-line throwaway script.
- [ ] Measure cold-start and warm per-utterance latency on this machine; play the
      WAVs.
- **Deliverable**: two WAVs + a latency note in the PR/handoff.
- **Done**: WAVs exist and play; operator confirms quality is clearly better
  than Piper for en + pt. **STOP and report if** warm latency per short
  utterance is > ~2.5 s (too slow for live TTS — needs a different runtime/box
  decision, out of this plan) or quality is not better than Piper.

### Phase 1 — Sidecar install tooling + server

- [ ] `tools/requirements-kokoro.txt`: pin `kokoro-onnx==<spike version>` and any
      direct deps (verify exact names/versions from Phase 0).
- [ ] `tools/setup-kokoro.ps1`: create `tools/kokoro-venv/`, `pip install -r`,
      download/place the model + voices assets. Mirror `setup-clone.ps1`.
- [ ] `tools/kokoro_server.py`: stdin line protocol IDENTICAL in spirit to
      `clone_server.py` — read one JSON line per request
      (`{text, out, lang, voice, speed}`), synth to `out`, print the out path on
      a line; print `{"ready":true}` after model load (warmup handshake). One
      request at a time on the Python side is fine; Node caps concurrency.
- [ ] Add `tools/kokoro-venv/` to `.gitignore`.
- **Deliverable**: a working sidecar.
- **Done**: `pwsh tools/setup-kokoro.ps1` succeeds and a hand-fed JSON line
  produces a valid WAV whose path is printed.

### Phase 2 — `KokoroEngine` (TS), implements `TTSEngine`

- [ ] `src/tts/kokoroEngine.ts`: mirror `CloneEngine`'s process management
      (spawn, warmup→ready with a ready-deadline, FIFO queue with per-job
      timeout, clean teardown) MINUS GPU serialization; allow a small bounded
      concurrency (default 2, config-driven) — or serialize if the spike shows
      CPU contention hurts. `resolveKokoroCmd(explicit)` auto-detects
      `tools/kokoro-venv` + `tools/kokoro_server.py`, returns `null` when absent.
- [ ] A `langKey → { kokoroLang, voice }` mapping table (e.g. `en→af_heart`,
      `pt→pf_dora`, … using the exact Kokoro voice ids from Phase 0). Cache
      namespace `'kokoro'` via `cache.withNamespace('kokoro')`.
- [ ] **`synth` THROWS** on: sidecar unavailable, timeout, non-zero/err line, or
      an unmapped language. The router relies on the throw to fall through — do
      NOT swallow to a normal voice.
- [ ] `tests/kokoroEngine.test.ts`: drive it with a FAKE child process (like the
      voice/session and clone tests) — assert (a) a ready→synth happy path
      returns the WAV path, (b) a sidecar error throws (so the router will fall
      through), (c) `resolveKokoroCmd` returns `null` when the venv is absent.
- **Done**: `npm run build` + `npm run typecheck` clean; new tests green;
  `npx vitest run` still ≥1349.

### Phase 3 — Wire into the RouterEngine + config (the MVP)

- [ ] `src/config/index.ts`: add `kokoroCmd?: string` (env `KOKORO_CMD`, like
      `CLONE_CMD`), `kokoroLangs: Set<string>` (env `KOKORO_LANGS`, default the
      supported set — verify the exact keys `langKeyOfModel` produces, e.g.
      `en,es,fr,hi,it,pt,ja,zh`), and `kokoroChunkConcurrency` (numEnvPositive,
      default 2).
- [ ] `src/tts/factory.ts` `router` branch ONLY: build the Kokoro route via
      `resolveKokoroCmd(config.kokoroCmd)`; if it resolves (sidecar installed),
      PREPEND `{ engine: new KokoroEngine(...), langs: config.kokoroLangs,
      label: 'kokoro' }` so routes become `kokoro → gtts → piper`. If it returns
      `null`, routes stay `gtts → piper` (today's behavior, byte-identical). Keep
      the log line listing the active chain.
- [ ] `tests/factory.test.ts`: extend to assert (a) with the sidecar present the
      route order is `kokoro,gtts,piper` and `kokoro.langs` equals the configured
      set, (b) with it absent the order is unchanged `gtts,piper`. Inject
      presence via a stubbed `resolveKokoroCmd` / a config flag — do NOT require a
      real venv in CI.
- **Done (MVP reached)**: `TTS_ENGINE=router` with the sidecar installed routes
  its languages through Kokoro and everything else + any failure through
  gTTS→Piper; suite ≥1349 green.

### Phase 4 — Discovery + docs (transparent, no new UI)

- [ ] `.env.example`: document `KOKORO_CMD` / `KOKORO_LANGS` (English comments,
      vars only — mirror the clone/TOPGG entries).
- [ ] `CLAUDE.md` Architecture: add the optional Kokoro sidecar note (parallel to
      the clone one). `docs/ARCHITECTURE.md`: add Kokoro to the router
      description. If the site lists an engine count/feature, bump it.
- **Done**: docs mention Kokoro; `.env.example` vars are byte-consistent with
  `src/config/index.ts`.

### Phase 5 — Verification: fallback matrix + bench + full suite

- [ ] Live matrix (manual, sidecar installed): en/pt message → heard in Kokoro
      (logs show `kokoro`); a Kokoro-unsupported language → `gtts`/`piper`;
      sidecar killed mid-run → clean fall-through, no silence; multi-segment
      message (flag on) still routes each segment correctly.
- [ ] Optional: extend `tools/bench.ts` to include Kokoro latency p50/p95.
- **Done**: matrix passes; `npm run build && npm run typecheck && npm run lint &&
  npm run format:check && npx vitest run` all green (suite ≥1349).

## Git workflow

- Commit per phase (Portuguese one-liners), e.g.
  `feat(tts): sidecar kokoro-onnx (setup + server) (plano 016)`,
  `feat(tts): KokoroEngine implements TTSEngine (plano 016)`,
  `feat(tts): kokoro no topo do router p/ as suas línguas (plano 016)`.
- Stage ONLY in-scope files by explicit path (never `git add -A`). Do NOT touch
  `.env`, `docs/RESEARCH-TTS-BOT-VS-VOXI.md`, or any untracked `docs/*`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT push or open a PR unless told to.

## Test plan

- New: `tests/kokoroEngine.test.ts` (fake-child happy path, throw-on-failure,
  `resolveKokoroCmd===null` when venv absent).
- Extended: `tests/factory.test.ts` route-order assertions (present vs absent).
- CI does NOT install the Python sidecar — every test must run with the sidecar
  ABSENT (that is the default CI path and it must keep the `gtts→piper` order).
- Primary gate unchanged: `npx vitest run` never drops below the pre-plan count.

## Done criteria (machine-checkable)

- [ ] `npm run build` && `npm run typecheck` && `npm run lint` &&
      `npm run format:check` all exit 0.
- [ ] `npx vitest run` ≥ 1349 pass, 0 fail.
- [ ] `ls src/tts/kokoroEngine.ts tools/kokoro_server.py tools/setup-kokoro.ps1 tools/requirements-kokoro.txt` — all exist.
- [ ] `grep -n "kokoro" src/tts/factory.ts` — the router branch prepends the
      Kokoro route.
- [ ] With the sidecar ABSENT, `factory.test.ts` proves the route order is
      unchanged (`gtts,piper`); with it present (stubbed), `kokoro,gtts,piper`.
- [ ] `git diff --stat -- src/tts/router.ts` empty (the router was not modified).
- [ ] `.env.example` KOKORO_* vars match `src/config/index.ts`.
- [ ] `plans/README.md` status row updated.

## Risks

- **CPU latency** (biggest): kokoro-onnx per-utterance time may be too high for
  live speech. → Front-loaded to Phase 0 (kill switch); mitigated by a
  persistent sidecar, a concurrency cap, and the existing AudioCache.
- **Asset/licensing/offline install**: model + voices download size and
  redistribution. → Pin + document in Phase 1; keep venv gitignored.
- **Uneven per-language quality** (ja/zh especially). → Phase 0 checks; ship only
  the languages that pass in `KOKORO_LANGS` (the set is env-configurable, so you
  can start with en/pt/es and grow).
- **Windows Python sidecar flakiness**. → Mirror the battle-tested CloneEngine
  process management (ready-deadline, timeouts, teardown) rather than inventing a
  new one.
- **Fallthrough correctness**: if `synth` swallowed instead of throwing, a
  Kokoro outage would produce silence/wrong voice. → Explicit test (b) in Phase 2
  asserts it throws.

## MVP

**Phase 3.** With the sidecar installed and `TTS_ENGINE=router`, Kokoro renders
its languages and everything else (and any failure) falls through to gTTS→Piper —
testable end-to-end. Phases 4–5 are docs and verification polish.

## STOP conditions

- Phase 0 shows warm latency > ~2.5 s/utterance or quality not better than Piper.
- Making Kokoro work requires editing `src/tts/router.ts` or the `SynthRequest`
  shape (means the abstraction is being bent — re-plan, don't force it).
- `npx vitest run` count drops below the pre-plan baseline at any step.
- The sidecar cannot be made to run reliably on Windows within Phase 1 (report
  the exact error; do not paper over it with retries).

Próxima ação concreta: correr o spike da Phase 0 — `pip install kokoro-onnx` num venv de rascunho e sintetizar uma frase em inglês e outra em pt-BR para WAV, medir a latência a quente e confirmar a qualidade.
