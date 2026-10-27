# How Cursor was used

## Setup
- Project opened in Cursor at the repository root. Project rules: `.cursor/rules/skyledger.mdc`.
- Cursor version: *(fill in: Cursor → About)*

## Sessions

### 2026-10-27: remove a hardcoded threshold from the landing page and the deck
**Prompt (Agent mode):**
> The landing page (web/landing/index.html) and the slide deck (web/deck/index.html) both say "more than 1 km" as fixed text, but the real threshold is config.settings.attribution.no_reporter_beyond_m in config/skyledger.json (used by eval/run_eval.ts). Please: 1. In app/public_api.ts, add that threshold to the statsPayload() response (for example eval.far_m, in metres). 2. In web/landing/main.js and the deck's script, read it from /api/stats and show it as km in place of the fixed "1 km" text. 3. Keep the current wording and styling. If the value is missing, fall back to hiding the number rather than showing a wrong one. Show me the diff before applying.

**What Cursor changed:**
- `app/public_api.ts`: `/api/stats` now returns `eval.far_m`, read from `config/skyledger.json` (`attribution.no_reporter_beyond_m`).
- `web/landing/index.html` and `web/landing/main.js`: the evidence counter's distance is a bound value, formatted by a new `fmtKm()`. If the value is missing, the counter is hidden.
- `web/deck/index.html`: the same for the evidence slide.

**Checked afterwards:** `npm run typecheck` passes; `/api/stats` returns `far_m: 1000`; the rendered landing page and deck both read "more than 1 km". Changing the config value now changes both pages, with no text edits.

**Screenshot:** `docs/cursor/cursor-1.png`
