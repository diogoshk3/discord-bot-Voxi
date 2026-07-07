# Vozen — Monetization Plan

> Status: **plan / decided pricing**. Nothing is gated yet unless a commit says so.
> Guiding rule: **never take anything out of Free that already exists.** The site says
> "core free forever" — Premium sells *new* value (better voices, higher limits, extras),
> never ransoms features people already use. Free is marketing; Premium funds the servers.

## Pricing (decided)

| Tier | Price | Scope | Notes |
|------|-------|-------|-------|
| **Vozen Premium** | **€4.00 / month** | per **server** | A touch under TTS Bot Premium (~$4.99). Pitch: "cheaper — and our games are free." |
| **Vozen Premium (annual)** | **€40 / year** | per server | 2 months free (€48 → €40) |
| **Vozen Plus** | **€1.99 / month** | per **user** | Personal perks that follow you across servers |

Payment: ideally Discord **App Subscriptions** (native, in-app) — requires a **verified**
bot (~75 servers) + team-owned app. Until then: **Ko-fi / Patreon + `/redeem` codes**.

---

## 🆓 FREE — everything that exists today stays free, forever

- **Core TTS:** auto-read channel, `/tts`, "Speak" context menu, 34 languages, automatic
  language detection, mixed-language synthesis in one sentence.
- **Voices:** all 38 current voices (Google + Piper), speed control, `/voice preview`.
- **Personalization:** spoken nickname, the 5 personas (pirate, uwu, Yoda, cowboy,
  medieval), 10 personal abbreviations.
- **Fun:** `/joke`, `/laugh`, `/8ball`, `/fortune`, `/fact`, `/wyr`, birthday shout-outs,
  `/topspeakers`.
- **Games:** **all 13 minigames + leaderboard — 100% free, always.** These drive invites
  and engagement; paywalling them would kill growth.
  - **Leaderboard: weekly reset is FREE too** (decided). Premium only adds *automatic
    roles for the weekly top players*.
- **Admin:** blocklist, pronunciation dictionary, rate-limit, role gating, kill-switch,
  join greetings, xsaid — all of it.

---

## 💎 PREMIUM — new, exclusive value

| Feature | Why it's Premium |
|---------|------------------|
| **Premium voices (Kokoro / top neural)** | ⭐ The anchor. Already on the roadmap ("hybrid engine phase 2: Kokoro"). Visibly better voices are what TTS competitors charge for, and they cost real CPU/infra. |
| **24/7 in the call** | Free bot leaves after 5 min alone; Premium stays. Classic voice-bot perk, cheap to build. |
| **Custom join greeting** | Server writes its own line instead of the fixed "Hello {name}". |
| **Multiple read channels** | Free: 1 tts-channel; Premium: several. |
| **Priority synthesis queue** | Under load, Premium servers synthesize first. |
| **Full soundboard + uploads** | Server's own custom sounds (⚠️ uploads = moderation risk, decide later). |
| **Custom game-winner announcement** | Cosmetic: Vozen announces the winner with the server's own line. |
| **Automatic roles for weekly top** | The Premium slice of the (otherwise free) leaderboard. |

---

## ⚖️ BOTH tiers, Premium gets an upgrade

| Feature | Free | Premium |
|---------|------|---------|
| Personal abbreviations | 10 | 50 |
| Pronunciation dictionary | 25 entries | 250 |
| Max characters / message | 2000 | 4000 |
| Personas | 5 current | +5 new (robot, baby, villain, DJ, grandpa) |
| **Voice effects** *(new)* | 2 samples (robot, echo) | all 8 (deep, chipmunk, radio, phone, underwater, demon…) |
| **Soundboard `/sfx`** *(new)* | 5 sounds | 25+ and uploads |
| **Keyword sound triggers** *(new)* | 2 triggers | 20 |
| **`/translate` + speak** *(new)* | 10 / day | unlimited |

---

## 🆕 New features to build (and where they land)

- **For Free (growth):** lite voice effects, mini soundboard, limited triggers,
  `/translate` with a daily quota — each gives the taste that converts.
- **For Premium (revenue):** the full version of each + Kokoro + 24/7 + custom greetings.
- **Growth loop:** vote reward — `/vote` on top.gg unlocks **12h of one premium voice**.
  Free for us, addictive for them, boosts our ranking.

---

## ⚠️ Honest notes (read before flipping the switch)

1. **Site copy:** currently "Free forever · No paywall". Before monetizing, change to
   "Core free forever" / "Everything you know stays free" — transparency avoids backlash.
2. **gTTS is an unofficial endpoint** — can't sell reliability on top of it. Premium must
   run on Piper/Kokoro (local, controlled). Revenue pays for serious infra.
3. **The bot runs on a home PC.** Before charging, it needs a VPS (~€5–10/mo). First goal
   of revenue is to cover that.
4. **Timing:** grow first (site, top.gg, votes), monetize at ~50–100 active servers.
   Charging 3 servers doesn't pay for the effort.

---

## Technical rollout (small, additive — nobody loses anything)

1. `premium_guild` / `premium_user` tables + `redeem_code` table (SQLite).
2. `isGuildPremium()` / `isUserPremium()` helpers (expiry-based).
3. `/redeem <code>` command + `/premium` status; offline code-gen script for Ko-fi/Patreon.
4. Gate only the **new** features (voice effects, soundboard, translate…) — existing free
   features are never gated.
