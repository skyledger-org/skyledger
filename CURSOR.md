# cursor.md: standing instructions for any cursor session in this repo

**Project: SkyLedger** (working name in older docs: GroundTruth). Open Agent Hackathon 2026, Track 1. Repo: https://github.com/skyledger-org/skyledger

**New on Windows? Follow `docs/WINDOWS_SETUP.md` first.** Then read `HANDOFF.md`.

**Read `HANDOFF.md` first.** It holds the full context: the hackathon, the rules, the research, the decisions, the current status and the next steps. The product spec is `docs/GROUNDTRUTH_SPEC.md`.

## The user's standing rules (always follow them)
1. **Never add anyone as co-author** on commits, pushes or PRs, including yourself. No `Co-Authored-By:` trailers and no "Generated with cursor" lines. Plain commit messages only.
2. **Never create or publish Artifacts** (cursor.ai pages). Every doc, plan or report goes in this repo as a file.
3. **Never ask the user to paste secrets into chat.** Secrets go in `.env`, which the user fills in. Never print, log or commit secrets. Create no keys on the user's behalf; the official guide says the user must create their own.
4. **Confirm before outward-facing or irreversible actions:** the first push to a remote, making the repo public, deleting anything, or sending anything to external services beyond the documented data APIs.
5. The user wants **brutal honesty and thoroughness**. Verify claims against primary sources before stating them, say clearly when something is unverified, and never present guesses as facts.
6. When you finish a work session, **update `HANDOFF.md` → "Current status" and "Next steps"** so the next session can pick up cold.

## Project rules from the hackathon (non-negotiable)
- Zetaris and Meterless must both be **running on the user's machine** (eligibility rule).
- **Meterless Nightshift is the primary AI provider.** The NVIDIA key lives inside Nightshift's Providers tab, not in our app.
- At least one Meterless engine must be in a **working feature**, with conformance or eval evidence. We use World Model, H-MEM, Markovian and Scout Intent.
- Development happens in **Cursor**. The user must genuinely use it; keep evidence in `.cursor/rules/` and `CURSOR.md`.
- `SAMPLE_MODE=true` must run the whole app **with no credentials and no network**.
- No local GPU may be required for judges to run it. Docker, `POST /run`, JSONL traces in `logs/`, 3 input/output examples.
- Deadline: **Oct 27, 2026, 23:45 UTC. Our target is 12:00 UTC that day.**
