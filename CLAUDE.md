# CLAUDE.md

Guidance for AI coding agents working on Vozen (Discord TTS bot).

## Commands

- Install: `npm install`
- Build (typecheck + emit): `npm run build` (tsc)
- Typecheck the tests too: `npm run typecheck` (tsc over `src/` + `tests/`, no emit)
- Tests: `npx vitest run` (suite in `tests/`)
- Dev (watch mode): `npm run dev`
- Production: `npm run start:prod` — NEVER plain `npm start` in production:
  it skips the supervisor `scripts/start-prod.mjs` (single-instance lock,
  native-module preheat, auto-restart with backoff, persistent logs).

## Hard rules

- **Discord compliance is mandatory** (Developer ToS + Developer Policy — audit
  2026-07-11 in `docs/PLAN-DISCORD-COMPLIANCE.md`). Every new feature must respect:
  - API data is used ONLY for the declared functionality; no profiling, no sale,
    no sharing with third parties (disclosed TTS engines excepted), no AI training
    on message content.
  - Any user-facing data the bot stores must be disclosed in PRIVACY.md AND have
    a user-accessible deletion path (command).
  - Anything acting on/about a user (recording, DMs, account changes) requires
    that user's explicit prior consent (see voice clone: consent-first pattern).
  - No unsolicited DMs, ever. No contacting users outside Discord with API data.
  - Paid features must support Discord Premium Apps purchase with price parity
    (≤ other channels) wherever Discord monetization is available to the app.
  - Suspected unauthorized data access → notify Discord and affected users
    immediately (see docs/INCIDENT-RESPONSE.md once it exists).
  - Growth gate: BEFORE ~75 servers, the app must pass verification + Message
    Content intent review.
- NEVER run `npm audit fix --force`. It would downgrade discord.js to v13 and
  @discordjs/opus across a major. Transitive CVEs are handled by the
  `overrides` block in `package.json` — read the `//overrides` comment there
  before touching any dependency version.
- Code comments in this repo are written in Portuguese. Write new comments in
  Portuguese too.
- Never read or commit `.env`. Use `.env.example` as the reference.
- NEVER edit file _content_ with PowerShell `Get-Content`/`Set-Content` (or
  `-replace` pipelines) on this repo. Windows PowerShell 5.1 reads UTF-8-without-BOM
  as Windows-1252 and rewrites it corrupted (mojibake: `€`→`â‚¬`, emojis/acentos
  broken). Use the Edit/Write tools instead. `tools/minify-site.mjs` has a
  mojibake guard that fails `npm run build:site` if this slips through.

## Environment

- Copy `.env.example` to `.env`; fill `DISCORD_TOKEN` and `CLIENT_ID`.
- The sharding variable is `BOT_SHARDS`, deliberately NOT `SHARDS` —
  `SHARDS`/`SHARD_COUNT` are read from the environment by the discord.js
  Client itself and would break single-process `npm start`. Do not rename it.
- `TTS_ENGINE=neural` requires `OPENAI_API_KEY` (the bot fails fast without
  it). The default engine is `piper` (self-hosted, free).

## Architecture

- Read `docs/ARCHITECTURE.md` — it reflects the code in `src/`. The historical
  design spec under `docs/superpowers/specs/` may diverge; the code wins.
- Optional voice-clone sidecar (Chatterbox, Python): installed by
  `tools/setup-clone.ps1` into `tools/clone-venv/` (gitignored). The bot
  auto-detects it — no `.env` change needed.
- Optional Kokoro TTS sidecar (`kokoro-onnx`, ONNX/CPU, no PyTorch): installed by
  `tools/setup-kokoro.ps1` into `tools/kokoro-venv/` (gitignored) + model/voices.
  Auto-detected. It is an **opt-in** per-user engine (`/voice set engine:Kokoro`);
  gTTS stays the default for everyone and without the sidecar Kokoro serves gTTS.

## Conventions

- TypeScript, `module: NodeNext`, `strict: true` (see `tsconfig.json`).
- Tests: vitest, flat files in `tests/` named after the module under test
  (e.g. `tests/playerFifo.test.ts` covers `src/voice/player.ts`).
- Commits: short conventional-ish one-liners in Portuguese (see `git log`).

## Testing — TDD is mandatory

Every code change goes through **test-driven development**: write the failing
test FIRST (RED), then the minimum code to pass it (GREEN), then refactor.
Never write production code before there is a test that fails without it.

- For logic covered by vitest (`src/**` TypeScript), this is literal: add/adjust
  the test in `tests/`, run it and see it fail, then implement.
- For code with no unit harness (static site in `site/`, browser JS), the
  executable acceptance test is the browser (preview): define the pass/fail
  criteria first, then verify against the running page — no CSP console errors,
  the flow works, etc. Don't ship site changes unverified.
- Always finish with the full suite green: `npx vitest run` + `npm run typecheck`.
