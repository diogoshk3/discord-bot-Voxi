# Privacy Policy — Vozen

> _type it, hear it._

**Last updated:** 2026-07-07

Vozen is an **open-source**, **self-hosted** Text-to-Speech (TTS) bot for Discord: each operator runs their own instance on their own computer or server (VPS). This policy describes **faithfully** what data the instance stores, where, and how to remove it.

Because Vozen is self-hosted, the **data controller is the instance operator** (the person or entity running the bot), not the project authors. The operator directly controls the database file and the cache folder on their system.

---

## 1. What data is stored

Vozen stores the data below in a local **SQLite** database (by default `tts.db`, configurable via `DB_PATH`). **All** records are identified only by **numeric Discord IDs** (snowflakes) — `guild_id` (server) and `user_id` (user). Vozen **does not store** personally identifiable information (PII) such as email, phone number, or address, and does not store your Discord username or avatar. Two narrow exceptions: (1) the **spoken nickname** (`/voice nickname`) — free text the user writes, may contain a first name, removable at any time (see section 3); and (2) if you buy Premium via **Ko-fi**, its purchase webhook includes the buyer's email — Vozen stores only a **one-way keyed hash** of it (never the email in plaintext), used solely to link subscription renewals to your Discord account (see the `kofi_supporter` row below).

| Data                          | Table               | Columns stored                                                                                                                                                                                                 | What it refers to                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-user voice preference** | `user_voice`        | `guild_id`, `user_id`, `voice_model`, `speed`, `engine`                                                                                                                                                        | The voice (model), speed, and engine (Google/Piper) a user set for themselves in a server (`/voice set`).                                                                                                                                                                          |
| **Per-server configuration**  | `guild_config`      | `guild_id`, `tts_channel_id`, `autoread`, `default_voice`, `max_chars`, `rate_per_min`, `enabled`, `tts_role_id`, `locale`, `xsaid`, `autojoin`, `read_bots`, `text_in_voice`, `greet_on_join`, `greet_locale` | Server settings: auto-read channel, auto-read on/off, default voice, limits, kill-switch, authorized role, interface language, and the toggles for announcing who spoke (xsaid), auto-joining the call, reading other bots, reading the text-in-voice chat, and the join greeting. |
| **Spoken nickname**           | `user_nickname`     | `guild_id`, `user_id`, `nickname`                                                                                                                                                                              | The name a user chose to be **called out loud** by xsaid (`/voice nickname`). It is free text set by the user themselves; it may or may not match their real name.                                                                                                                 |
| **Personal abbreviations**    | `user_abbreviation` | `user_id`, `term`, `replacement`                                                                                                                                                                               | Personal text substitutions (global — they follow the person across servers) set by the user themselves (`/voice abbrev`).                                                                                                                                                         |
| **Voice effect**              | `user_effect`       | `guild_id`, `user_id`, `effect`                                                                                                                                                                                | The voice filter (e.g. robot, echo) the person chose for themselves (`/voice effect`).                                                                                                                                                                                             |
| **Blocklist**                 | `blocklist`         | `guild_id`, `word`                                                                                                                                                                                             | Words the server blocked from being read (`/config blockword`).                                                                                                                                                                                                                    |
| **Pronunciation dictionary**  | `pronunciation`     | `guild_id`, `term`, `replacement`                                                                                                                                                                              | Pronunciation substitutions set by the server (`/config pronunciation`).                                                                                                                                                                                                           |
| **TTS opt-out**               | `tts_optout`        | `guild_id`, `user_id`                                                                                                                                                                                          | A record that a user asked **not** to be read automatically (`/voice optout`).                                                                                                                                                                                                     |
| **Game scores**               | `game_score`        | `guild_id`, `user_id`, `points`, `wins`                                                                                                                                                                        | Minigame leaderboard (`/game`): accumulated points and matches won.                                                                                                                                                                                                                |
| **"Top speakers"**            | `talk_stats`        | `guild_id`, `user_id`, `spoken_count`, `streak`, `best_streak`, `last_date`                                                                                                                                    | How many of each person's messages the bot read + daily streaks, for `/topspeakers`.                                                                                                                                                                                               |
| **Birthday**                  | `user_birthday`     | `guild_id`, `user_id`, `month`, `day`                                                                                                                                                                          | **Only month and day** (never the year), set by the user themselves, so the bot can wish them a happy birthday in the call (`/birthday`).                                                                                                                                          |
| **Per-server Premium**        | `premium_guild`     | `guild_id`, `expires_at`, `source`                                                                                                                                                                             | A server's Premium status: when it expires and the source (e.g. a redeem code).                                                                                                                                                                                                    |
| **Per-user Premium (Plus)**   | `premium_user`      | `user_id`, `expires_at`, `source`                                                                                                                                                                              | A person's Plus status (perks that follow them across servers).                                                                                                                                                                                                                    |
| **Vote reward cooldown**      | `vote_reward`       | `user_id`, `rewarded_at`                                                                                                                                                                                       | When you last earned **24h of Plus** by voting for Vozen on top.gg, so the reward is limited to **once every 30 days**. Just a timestamp — no other data.                                                                                                                          |
| **Redeem codes**              | `redeem_code`       | `code`, `kind`, `days`, `used_by`, `used_at`, `created_at`                                                                                                                                                     | Premium codes generated offline; `used_by`/`used_at` are only filled in when the code is redeemed (`/redeem`).                                                                                                                                                                     |
| **Ko-fi renewal link**        | `kofi_supporter`    | `email_hash`, `discord_id`, `updated_at`                                                                                                                                                                       | Links a Ko-fi purchase to your Discord account so subscription **renewals** keep working. Vozen **never stores your email** — only a one-way keyed hash (HMAC-SHA256) of it; the plaintext email is never written to disk.                                                         |
| **Voice clone**               | `user_clone`        | `user_id`, `sample_path`, `consent_at`, `enabled`                                                                                                                                                              | **See section 2.3 — this is the most sensitive data.** Points to the sample's `.wav` file and records the consent timestamp.                                                                                                                                                       |

Note on opt-out: running `/voice optout` **creates** a record with your `user_id` (so the bot remembers the preference). `/voice optin` removes that record. No other information about you is stored.

### 1.1 Website login (vozen.org)

When you log in on **vozen.org** with Discord (the account page and the server dashboard), Vozen uses Discord OAuth2 and requests only:

- **`identify`** — your Discord ID, username and avatar, to show your account and to verify that a request is really yours.
- **`guilds`** (server dashboard only) — the **list of servers you belong to**, used solely to show which servers you can configure (those where you have **Manage Server** and Vozen is present). Vozen never posts, leaves, or changes anything about those servers from this list.

This login data is used **transiently** to answer the request and is **not stored** in the database — it is held in memory for at most ~60 seconds (a short cache) and then discarded. The access token stays in **your browser** (`sessionStorage`), is sent only to Vozen's own API over HTTPS, and is never written to disk on our side. The dashboard only changes the same per-server settings you could change with `/config` in Discord.

---

## 2. Message content

To synthesize speech, Vozen **reads the text content** of messages in the cases where it acts: the `/tts` command, auto-reading a configured channel, and mentions/replies to the bot.

**Message text is NOT stored in any database table.** It is processed **transiently** in memory: text cleaning → applying the pronunciation dictionary → checking the blocklist → speech synthesis → playback. After playback, the plain text is not persisted anywhere.

### 2.1 Audio cache

To avoid re-synthesizing repeated phrases, Vozen stores the **generated audio files** (`.wav`) in a local cache folder (`audio-cache/`, next to the database). It is important to understand exactly what this implies:

- **The key (file name) is a** `SHA-1` **hash** computed from `cleaned_text + voice_model + speed`. The plain text does **not** appear in the file name or in the database, and the hash is **not** reversible to recover the text.
- **However, the `.wav` file itself is the spoken audio of the cleaned message.** Anyone with access to the instance's file system can play that file and hear the content. This is not a "hiding place" for the content — it is simply the generated audio, stored for reuse.
- The cache is **limited and regenerable**: by default it keeps at most ~500 files per engine (a count-based limit — the oldest by creation date are deleted first). It **persists on disk** across bot restarts until evicted by the limit policy, or until the operator deletes the folder. If deleted, the audio is simply re-synthesized when needed.

In short: **we do not store the original text**, only the generated audio keyed by hash, which is limited, regenerable, and deletable.

### 2.2 Logs

Vozen writes **operational logs** to the console/terminal and (in the production runner) to the file `logs/vozen.log` next to the executable, with size-based rotation. The logs contain operational information: level, timestamp, command names, and error messages. **The logs do NOT include the content of users' messages.** Log retention is controlled by the instance operator (the system where the bot runs).

### 2.3 Voice clone (sensitive data — opt-in)

Voice cloning (`/voice clone`, a Premium feature) is the **most sensitive** data an instance stores: a **real recording of a person's voice**. It is strictly **opt-in** — the instance only has a sample if someone runs `/voice clone record`. (The `/voice clone` command needs a GPU/RAM-capable host; on the official hosted instance it is **not offered**, so no samples are collected there. If you ever have a legacy sample, `/privacy erase` deletes it.) How it works:

- **Consent first.** You can record **your own** voice, or another person's voice **only after they grant explicit on-screen consent** — an Allow/Deny button that **only that person** can press. Without that "yes", nothing is recorded. `consent_at` records the moment of consent.
- **Only the target is recorded.** Outside the recording window the bot is always `selfDeaf` (deafened); it uncovers its ears **only during the window** and records **only** the chosen person, never the rest of the channel. Afterwards it deafens again.
- **Where it lives.** The sample is a `.wav` at `voice-clones/{user_id}-{timestamp}.wav` (next to the database); the `user_clone` table stores the path. The folder is local and deletable.
- **Encrypted at rest.** If the operator sets `CLONE_KEY`, the sample file is **encrypted on disk** (AES-256-GCM) and only decrypted momentarily for synthesis. **The official public instance has this enabled.**
- **Who controls it.** The sample is associated with whoever **ran the command** (that is the person who will speak with the voice), and it is that person who can delete it with `/voice clone delete` (removes the `.wav` and the row immediately).
- **Synthesis.** The clone is generated **locally** (Python sidecar on the instance's machine) — the sample audio **is not sent anywhere external**.

> Compliance note: a voice sample may be treated as **sensitive/biometric data** in certain jurisdictions (e.g. GDPR). The instance operator is responsible for only allowing clones with proper consent and for responding to removal requests.

### 2.4 Speech-to-text / transcription (consent-first)

Transcription (`/transcribe`, a Premium feature) turns the speech in a voice channel into text messages. Like the voice clone, it is strictly **consent-first** and processes audio **locally** (a Whisper sidecar on the instance's machine — nothing is sent to an external service, nothing is used to train AI). How it works:

- **Consent first, per speaker.** Only people who have **explicitly consented** in that server are transcribed — an on-screen Allow button that **only that person** can press. Consent is asked **once per server** and remembered (`stt_consent` stores your user ID, the server ID and `consent_at`); people who never consent are simply **not transcribed** while the rest of the call continues. Revoking consent stops future transcription of you.
- **No audio is ever stored.** The voice audio is processed in memory to produce text and then discarded; the bot never writes an audio file for transcription.
- **The bot announces transcription** in the channel when it **starts and stops**, and **auto-stops** when nobody consented remains in the call.
- **Transcriptions are normal Discord messages — and therefore permanent.** The text the bot posts lives in the channel like any other message. This means it is **outside `/privacy erase`** (which only removes data from the bot's own database, not messages already posted to Discord). Revoking consent stops new transcriptions but does **not** retroactively delete messages already posted; to remove those, delete the messages in Discord (or ask a server moderator to). Only the **consent record** (`stt_consent`) is bot-side data, and that is removed by `/privacy erase`.

> Compliance note: transcribing a person's speech acts on that person, so it requires their explicit prior consent (handled above). The instance operator is responsible for honoring consent and removal requests.

---

## 3. Data retention and deletion

Because Vozen is self-hosted, **the instance operator directly controls** the SQLite file (`DB_PATH`) and the cache folder (`audio-cache/`) — both are local files that can be deleted at any time. On a Docker deployment, deleting everything is `docker compose down -v` (removes the volume with the database and the cache).

For users and server administrators, the bot's commands allow data to be removed:

| To remove...                 | Use...                           | Notes                                                                                                                                   |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Your voice preference        | `/voice reset`                   | Deletes your record in `user_voice`.                                                                                                    |
| Your spoken nickname         | `/voice nickname` (with no name) | Deletes your record in `user_nickname`.                                                                                                 |
| Your opt-out (be read again) | `/voice optin`                   | Deletes your record in `tts_optout`.                                                                                                    |
| Your cloned voice sample     | `/voice clone delete`            | Deletes the row in `user_clone` **and** the sample's `.wav` file, immediately.                                                          |
| Your transcription consent   | `/transcribe revoke`             | Deletes your row in `stt_consent`; you stop being transcribed. Messages already posted are normal Discord messages (delete in Discord). |
| Server configuration         | `/config reset`                  | Restores `guild_config` to its default values. **Note:** the reset does **NOT** clear the blocklist or the pronunciation dictionary.    |
| A word from the blocklist    | `/config blockword remove`       | Removed individually (not by `/config reset`).                                                                                          |
| A pronunciation term         | `/config pronunciation remove`   | Removed individually (not by `/config reset`).                                                                                          |
| **All your personal data**   | `/privacy erase`                 | One command (asks you to confirm). Deletes everything tied to your user ID across **all** servers.                                      |

> **To delete everything at once, use `/privacy erase`** — it asks you to confirm, then removes all data tied to your user ID across every server (`user_voice`, `user_nickname`, `user_abbreviation`, `pronunciation_user`, `user_effect`, `tts_optout`, `user_clone` including its `.wav`, `stt_consent`, `game_score`, `talk_stats`, `user_birthday`). It also revokes any clone made from **your** voice by other people. (Transcription text already posted to a channel is a normal Discord message, not bot-side data — see section 2.4.) Your **paid Premium/Plus and its purchase history are intentionally kept** — they belong to you and to legally-required financial records; to stop Premium, let it expire or contact the operator (see section 5).

The audio cache is regenerable and self-limiting (see section 2.1); deleting it loses no configuration.

**Automatic retention limit (servers).** When Vozen is removed from a server, that server's data (configuration, blocklist, pronunciations, stats, scores, per-user voice settings for that server, etc.) is **automatically deleted 30 days later** if the bot is not re-invited. The 30-day grace period exists so an accidental kick or a short outage does not wipe everything immediately; re-inviting the bot within that window cancels the deletion. Paid records (a server's premium status and the payment ledger) are kept, as they belong to the purchaser and to legally-retained financial history.

---

## 4. Third parties

### 4.1 Speech synthesis engine (where the text goes)

To generate the audio, the **cleaned text to be synthesized** is handed to a TTS engine. Which one depends on the instance's `TTS_ENGINE` configuration:

| `TTS_ENGINE` | Where the text goes                                                                                                                        | Note                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `piper`      | **Stays local** — runs on the instance's machine, **sends nothing external**.                                                              | Code default.                                                      |
| `gtts`       | **Sent to Google** (`translate.google.com`) to generate the audio. [Google's Privacy Policy](https://policies.google.com/privacy) applies. | **This is the engine used on the official public Vozen instance.** |
| `router`     | By default uses **gTTS (Google)** and falls back to **Piper (local)** if Google fails — that is, the text **may** be sent to Google.       | —                                                                  |
| `neural`     | **Sent to OpenAI** (`api.openai.com`). Requires the operator's API key.                                                                    | Opt-in.                                                            |

> In every case, **only the text to be read** (already cleaned) is sent, not user IDs or history. The external engine returns audio; Vozen does not store the text↔user association.

### 4.2 Other services

- **Discord.** Vozen connects to Discord's API/gateway to work (receiving messages, joining voice channels, responding). Use of Discord is governed by [Discord's Privacy Policy](https://discord.com/privacy).
- **Bot lists (opt-in, e.g. top.gg).** If `TOPGG_TOKEN` is set, **only the server count** is published periodically — no personal data, no message content.
- **Error webhook (opt-in).** If `ERROR_WEBHOOK_URL` is set, technical error reports (stack traces) are sent to a private **operator** channel for monitoring. They are not designed to include message content.

**No data sale. No third-party analytics. No trackers.** Vozen does not sell, rent, or share data with third parties for marketing purposes, and does not integrate external analytics services.

---

## 5. Contact / Responsible party

The **responsible party** for a Vozen instance is the **operator** who runs it. For questions about your data on a specific server, to report a problem/abuse, or to request the removal of your data, contact that server's administrator or the bot's operator.

> **Official public Vozen instance:**
>
> - Support / reports / data requests: **[support server](https://discord.gg/V6PZYZmhcQ)** (`discord.gg/V6PZYZmhcQ`)
> - Source code: <https://github.com/Rexy40407/discord-bot-Vozen>
>
> **Running your own instance?** Replace the contact above with your own before making the bot public.

The Vozen project authors provide only the software (open-source); each operator of a third-party instance is responsible for the data that instance processes.

---

## Nota / Note (EN)

_Vozen is a self-hosted, open-source Discord TTS bot (AGPL-3.0). The instance operator is the data controller. The bot stores only Discord numeric IDs (`guild_id`, `user_id`) plus per-user voice preferences (voice/engine/speed/effect), spoken nickname (free text the user chooses), personal abbreviations, per-server config, blocklist, pronunciation dictionary, opt-out records, game scores, talk stats, optional birthday (month/day, no year), Premium status, and a vote-reward timestamp (when you last earned 24h of Plus by voting on top.gg, kept only to limit the reward to once every 30 days) in a local SQLite database — no PII beyond the optional nickname. **Voice clone (opt-in, Premium)** additionally stores a real voice recording as a `.wav` in `voice-clones/` plus a consent timestamp (`user_clone`): you may record your own voice, or another person's voice only after they grant explicit on-screen consent (a button only they can press); the bot is deafened except during the recording window and records only the chosen person; delete with `/voice clone delete` (removes the row and the `.wav`). Message text is processed transiently to synthesize speech and is **not** stored in any table; only generated `.wav` audio is cached on disk, named by an SHA-1 hash of (cleaned text + voice + speed), capped (~500 files/engine, LRU), regenerable and deletable. Logs contain operational data, **not** message content. Where the text goes depends on `TTS_ENGINE`: **Piper** runs locally (no external send); **gTTS** (the public instance's engine) sends the text to Google; **router** may send to Google (falls back to local Piper); **neural** sends to OpenAI. Voice clones are synthesized locally and never leave the machine. Opt-in extras: server-count to top.gg (`TOPGG_TOKEN`, no personal data) and error reports to the operator's webhook (`ERROR_WEBHOOK_URL`). No data sale, no third-party analytics, no using message content to train AI. Support / reports / data requests: the [support server](https://discord.gg/V6PZYZmhcQ). Removal: `/voice reset`, `/voice nickname` (empty), `/voice optin`, `/voice clone delete`, `/config reset` (does not clear blocklist/pronunciation — use `/config blockword remove` / `/config pronunciation remove`); the operator can delete the SQLite file and cache folder directly._
