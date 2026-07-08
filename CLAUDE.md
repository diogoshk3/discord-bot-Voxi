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
