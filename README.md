# SkyLedger

**Satellites see the leaks. Companies report the numbers. SkyLedger is an AI agent team that checks one against the other.**

Open Agent Hackathon 2026 · **Track 1: Solving Fragmented Intelligence**

Methane plumes observed from aircraft and satellites (Carbon Mapper: Tanager, EMIT, AVIRIS-NG, GAO), facility self-reports to the US EPA Greenhouse Gas Reporting Program (GHGRP), and corporate ownership records share **no keys, no units and no clocks**. A plume is a point with a rate in kg/h on one morning. A report is a facility ID with CO₂e tonnes for a year. An owner is a free-text string like `TARGA RESOURCES (73%); PIONEER NATURAL RESOURCES USA INC (27%)`. SkyLedger joins them in place through **Zetaris**, resolves owners on the **Meterless World Model**, reads the plume image with **NVIDIA Nemotron** through **Meterless Nightshift**, and makes a **Skeptic** agent rule out five rival explanations before anything is reported. Every finding is a draft until an analyst signs it.

**Who it's for:** ESG and credit analysts, and regulators, who must judge whether a company's reported emissions are plausible. One example is an analyst reviewing California SB 253 Scope 1 disclosures due **Nov 10, 2026**. EPA has delayed RY2025 GHGRP reporting and proposed ending most of the program, which leaves satellite data as one of the few independent checks.

**Links:** slide deck [docs/deck/SkyLedger-deck.pdf](docs/deck/SkyLedger-deck.pdf) (also served at `/deck`) · submission text [docs/SUBMISSION.md](docs/SUBMISSION.md)

**Contents:** [What a run finds](#what-a-run-finds-real-output-sample-data-60-permian-plumes) · [Requirements](#requirements-and-dependencies) · [Quick start](#quick-start-no-credentials-no-network-no-gpu) · [Using SkyLedger](#using-skyledger) · [Live mode](#live-mode-zetaris--meterless-nightshift--nemotron) · [How Zetaris, Meterless and NVIDIA are used](#how-zetaris-and-meterless-are-integrated-and-where-nvidia-contributes) · [Architecture](#architecture) · [Agents](#the-agents) · [Configuration](#configuration-nothing-hardcoded) · [Traces](#traces) · [API](#api) · [Eval](#eval) · [Limitations](#limitations-read-before-trusting-a-number) · [Pre-existing components](#pre-existing-components)

## What a run finds (real output, sample data, 60 Permian plumes)

From `output_examples/example_1.json`:

| Verdict | Plumes | Meaning |
|---|---|---|
| Inconsistent with report | 8 | Even the conservative lower bound of implied annual CH₄ exceeds the facility's RY2023 report |
| No reporter at origin | 31 | No GHGRP point facility within 1 km of the plume head. A nearest-facility match would blame the wrong plant |
| Too few sightings | 10 | Fewer than 2 detections in the reporting-year window, so no annualization |
| Attribution uncertain | 8 | Two plausible sources, or the geometry is inconclusive. Excluded from the roll-up |
| Coverage gap | 3 | The plume falls under basin-level reporting, or the facility doesn't report Subpart W |

Label-free diagnostic from `npm run eval`: nearest-facility matching names a facility **more than 1 km from the plume head in 18 of 60 plumes**. Naive annualization flags **34** discrepancies; SkyLedger flags **8** after the Skeptic.

Against **15 hand-labelled plumes** (5 more marked unsure and left out), the wrong facility was blamed in **33%** of cases by nearest-facility matching, **47%** by a single LLM call and **7%** by SkyLedger, which also raised **no false discrepancy flags** (nearest-facility: 1). This is a small sanity check labelled by the team, not expert ground truth; see [Eval](#eval) for the caveats.

## Requirements and dependencies

- **Node.js 22 or newer** and npm (or Docker instead: the image is based on `node:22-slim`). No Python, no build step, no GPU.
- **npm packages** (installed by `npm ci`): `tsx` runs the TypeScript directly; `three`, `gsap` and `lenis` draw the landing page; `@fontsource` packages provide the fonts, served locally. Dev only: `typescript` and `@types/node` for `npm run typecheck`.
- **Vendored, no install needed:** the Meterless World Model reference engine (`vendor/world-model/`) and the Scout Intent spec (`vendor/scout-intent/`).
- **Optional, for live mode only:** a local Zetaris platform with the three tables registered, Meterless Nightshift with an NVIDIA provider, and optionally `NVIDIA_API_KEY` for the vision fallback. See [Live mode](#live-mode-zetaris--meterless-nightshift--nemotron).

## Quick start (no credentials, no network, no GPU)

```bash
npm ci
npm start                       # http://localhost:8000 (landing page), /app (analyst console), POST /run
# or one CLI run:
npx tsx run.ts --once input_examples/example_2.json
```

Docker:

```bash
docker build -t skyledger .
docker run --rm -p 8000:8000 skyledger
curl -s -X POST localhost:8000/run -H "Content-Type: application/json" -d @input_examples/example_2.json
```

`SAMPLE_MODE=true` is the default. SQL is answered from the cached files in `data/sample/`, and model steps use their deterministic fallbacks. Every trace line and evidence item records which engine answered (`zetaris` or `sample-cache`, `vision` or `geometry`).

## Using SkyLedger

1. **Landing page** (http://localhost:8000/): the problem, one plume followed through the agents, and the evidence numbers. Every figure on it comes from `/api/stats`.
2. **Analyst console** (`/app`):
   - Pick a **region**, a **reporting year** and **Offline sample** or **Live engines**, then press **Run the agents**, or click one of the three scenarios. The agent trace streams on the right as it is written.
   - Click a plume on the left (or on the map) to open its **dossier**: the verdict in plain language, observed rate, sightings in the window, the implied yearly range against the reported total, the plume image, the Skeptic's five tests, the owner and parent companies, nearby facilities, and the evidence (the exact SQL, the rows hash, the model calls).
   - **Verify hash chain** checks that the trace has not been edited. **Approve & sign** issues the execution contract; until then every dossier is "draft, not shareable".
   - The **Parent companies** tab rolls inconsistent facilities up to their parents.
3. **Labelling page** (`/label`): one plume at a time, with the picture, lettered facilities and one question. SkyLedger's answers are never shown there. Answers go to `eval/labels.csv`, and `npm run eval` scores SkyLedger and two baselines against them.
4. **Slide deck** (`/deck`): the pitch deck, with its numbers read from the same API.
5. **Headless:** `POST /run` (see [API](#api)) or `npx tsx run.ts --once <input.json>`. Each run writes `logs/run-<id>.json` and a hash-chained `logs/trace-<id>.jsonl`.

| npm script | What it does |
|---|---|
| `npm start` | Serves the landing page, console, labelling page, deck and API on port 8000 |
| `npm run run -- <input.json>` | One run from the command line |
| `npm run eval` | Scores SkyLedger and the baselines against `eval/labels.csv` → `eval/results.md` |
| `npm run verify -- <trace.jsonl>` | Checks a trace's hash chain |
| `npm run cache -- <region>` | Fetches and caches a region's public data |
| `npm run export:zetaris` / `npm run register:zetaris` | Exports the cache as CSV for Zetaris / registers the three Zetaris tables |
| `npm run check:meterless` | Meterless provider done-criteria against the running Nightshift |
| `npm run typecheck` | TypeScript check |

## Live mode (Zetaris + Meterless Nightshift + Nemotron)

1. Run Zetaris locally and register the three sources (`npm run export:zetaris`, then follow `docs/ZETARIS_SETUP.md`).
2. Run Meterless Nightshift, add the NVIDIA key under **Setup → Providers**, and pin the Nemotron lanes.
3. `cp .env.example .env`, then fill in `METERLESS_BASE_URL` and `METERLESS_RUNTIME_TOKEN` (from Nightshift → Console), `ZETARIS_REST_URL`, `ZETARIS_ORG_ID` and `ZETARIS_API_KEY` (from the Zetaris UI), optionally `NVIDIA_API_KEY` (vision fallback, see the disclosure below), and `SAMPLE_MODE=false`. Secrets stay in `.env`, which is git-ignored.
4. `npm start`, open http://localhost:8000/app, pick **Live engines** and press **Run with live engines**. The status bar at the top shows which engines are live.

`AI_PROVIDER` chooses where model calls go: `nightshift` (default), `nvidia` (NVIDIA's API directly, e.g. for a hosted copy with no Nightshift on the machine) or `none`.

If Zetaris or Nightshift is unreachable, the run doesn't fail. SourceMapper logs a `fallback` and the run continues on the cache.

## Architecture

```mermaid
flowchart TD
  U[Analyst / judge<br/>POST /run or UI] --> ORC[Orchestrator<br/>state machine over shared RunState]
  ORC --> TR[(logs/trace-run_id.jsonl<br/>hash-chained)]
  ORC --> SM[SourceMapper]
  SM --> GL[GeoLinker<br/>federated SQL]
  GL --> PR[PlumeReader<br/>Nemotron vision + wind geometry]
  PR --> OR[OwnershipResolver<br/>Meterless World Model]
  OR --> RC[Reconciler<br/>units + time window, ranges]
  RC --> SK{Skeptic<br/>R1-R5}
  SK -- "no candidate: widen radius" --> GL
  SK -- "rival source: look again" --> PR
  SK -- "too few sightings: block annualization" --> RC
  OR -- "near-duplicate owners" --> RQ[Review queue]
  SK -- verdict --> RP[Reporter<br/>Nemotron + wording guard]
  RP --> SO[SignOff<br/>Scout-shaped signed execution contract]
  subgraph Z[Zetaris: queried in place]
    Z1[Carbon Mapper sources]
    Z2[GHGRP facilities]
    Z3[GHGRP CH4 by subpart]
  end
  GL & SM --> Z
```

Design rules:
- **Numbers come from SQL and code, never from the LLM.** That covers distances, unit conversion and ratios. Models only interpret images and word findings.
- **Every claim carries evidence:** the SQL text and a rows hash, the image, and the computation.
- **Bounded loops:** at most 4 Skeptic review loops per plume. A sample run of 60 plumes takes under 1 s.

## The agents

| Agent | Job | Can block or send back |
|---|---|---|
| SourceMapper | Checks which sources are reachable (Zetaris or cache) and whether Nightshift is online (`GET /v1/models`) | Falls back to the cache and logs it |
| GeoLinker | One federated query: Carbon Mapper source × GHGRP facilities × CH₄ totals, haversine within radius | — |
| PlumeReader | Wind and plume geometry decide; Nemotron vision reads the plume image blind as an advisory check | Can **overturn** GeoLinker's nearest pick |
| OwnershipResolver | Owner strings → canonical parents on the World Model; review queue for near-duplicates | Escalates to the review queue |
| Reconciler | kg/h × 8.76 × persistence → t CH₄/yr as a range; CO₂e ÷ GWP → t CH₄ | — |
| **Skeptic** | Five rival tests; decides the verdict | **Blocks** the Reporter; **sends back** to GeoLinker, PlumeReader or Reconciler |
| Reporter | Draft dossier in guarded language; a deterministic guard rejects accusatory wording | — |
| SignOff | Analyst approval issues a signed execution contract | Nothing is "shareable" without it |

### The Skeptic's rival tests

| # | Rival | Test (always data, never LLM opinion) |
|---|---|---|
| R1 | Misattribution | Another point facility consistent with plume origin and wind within 2 km? Is the nearest reporter more than 1 km from the plume head? Basin-level well operators nearby while the attributed plant is more than 400 m away? (flagged) |
| R2 | Intermittency | At least 2 detections within the reporting-year window (RY ± 6 months), or no annualization |
| R3 | Not required to report | Facility filed no subparts or no CH₄ for the year, or no GHGRP reporter at the plume head |
| R4 | Uncovered source category | Only basin-level `W-ONSH`/`W-GB` reports nearby, or the facility doesn't report Subpart W |
| R5 | Data quality | No quantified rate, uncertainty above 100% of the rate, no wind |

**The physics PlumeReader uses.** Carbon Mapper places the plume coordinate at the estimated emission origin, and the plume extends downwind. A facility lying downwind of the origin is in the plume's path, not at its head. So is a facility more than 1 km away. Neither can be the source. Carbon Mapper's wind direction is the meteorological "from" direction; we checked this in the data (see `data/README.md`).

**Reconciliation math.** Implied annual CH₄ runs from (rate − 1σ) × 8.76 × (detections / overpasses in the window) up to (rate + 1σ) × 8.76 × 1.0. Reported CH₄ = GHGRP CO₂e ÷ 25 (the AR4 GWP used for RY2023; verified in the data). "Inconsistent" means even the **low** bound exceeds the report.

## How Zetaris and Meterless are integrated, and where NVIDIA contributes

**Zetaris: the data layer.** The three public sources (Carbon Mapper methane sources, EPA GHGRP facilities, GHGRP CH₄ totals by subpart) are registered in Zetaris as Lightning filestore tables (`scripts/zetaris_register.ts`). SkyLedger never copies them into its own store. At the start of each run, SourceMapper asks Zetaris which tables are reachable and how many rows they hold. For every plume, GeoLinker sends **one federated geo-join** through the Zetaris REST SQL API: sources × facilities × CH₄ totals, with a bounding-box prefilter and a haversine distance, so the join happens where the data lives. The exact SQL text and a hash of the returned rows go into the plume's dossier as evidence, so an analyst can rerun the query. Verified live: the Zetaris answer equals the offline cache for 60 of 60 plumes (`scripts/check_zetaris_parity.ts`), and the queries appear in the Zetaris SQL Workspace history.

**Meterless: the AI provider and the engines.**
- **Nightshift is the primary AI provider.** Every text model call (the Reporter's dossier wording, the single-LLM eval baseline) goes to Nightshift's OpenAI-compatible endpoint, built to Meterless's "Add Meterless as a provider" contract: URL normalisation, `meterless-app`/`meterless-scope` headers, `/v1/models` discovery with an unauthorized state, `rt-local` rejection, a 180 s timeout and Auto Detect. The NVIDIA key lives inside Nightshift's Providers tab; the app holds only the Nightshift runtime token. `npm run check:meterless` passes the contract's done-criteria.
- **World Model** (the reference engine, vendored unmodified) holds the facility → owner → parent graph. OwnershipResolver writes every GHGRP owner string with provenance, the engine merges near-duplicate spellings (`TARGA RESOURCES CORP` and `TARGA RESOURCES`) and queues uncertain merges for review, and the parent roll-up reads the alias-following graph view. Meterless's own conformance suite passes **8/8** against the engine we run (`docs/evidence/world-model-conformance.txt`).
- **Scout Intent's execution-contract format** is used at sign-off: HMAC-SHA256 over canonical JSON, bound to the dossier hash and the trace head.

**NVIDIA: where Nemotron contributes.**
- **Nemotron 3.5 Lightning, through Nightshift,** writes every dossier from unit-labelled facts computed by the code. A guard rejects any number the code did not compute and any accusatory wording.
- **Nemotron 3.5 Super VL** reads each plume image **blind** (no wind, no candidate facilities) and reports which way the plume runs; PlumeReader compares that with the wind. On the 60-plume live run it agreed with the wind 24 of 64 times (38%, against about 33% by chance), so vision is **advisory**: agreement adds confidence, and disagreement is recorded but never downgrades a case.
- Nightshift 1.2.7 refuses image requests to Nemotron VL, so the vision call tries Nightshift first and only then calls the same model on NVIDIA's API, logging every fallback (see the disclosure below).

## Sponsor technology

| Sponsor | Where | What it does in SkyLedger |
|---|---|---|
| **Zetaris** | `app/adapters/zetaris.ts`, `app/agents/geo_linker.ts`, `scripts/zetaris_register.ts` | The federated geo-join across Carbon Mapper and GHGRP sources, queried in place through the REST SQL API (`/sql-editor/sqls/run`) against three Lightning filestore tables (`CREATE LIGHTNING FILESTORE TABLE … FORMAT CSV`); source discovery and row counts in SourceMapper. The SQL text and rows hash go into every dossier's evidence. **Verified live on 2026-10-26:** `scripts/check_zetaris_parity.ts` returns identical results to the cache for 60 of 60 plumes, about 0.5 s per query |
| **Meterless Nightshift** | `app/adapters/meterless.ts` | Primary AI provider, built to the "Add Meterless as a provider" contract: `<host>/v1` normalisation, `meterless-app` and `meterless-scope` headers, `GET /v1/models` discovery (401/403 means unauthorized), `rt-local` rejection, 180 s timeout, Auto Detect over ports 8088/8090/8787/11434. The token is never logged. **Verified live:** `npm run check:meterless` passes the contract's done-criteria (wrong token is unauthorized, discovery online, plain text returns a string) |
| **Meterless World Model** | `app/engines/world_model.ts`, `app/agents/ownership.ts`; engine at `vendor/world-model/reference` (unmodified, Apache-2.0) | The facility → owner → parent graph: content-derived entity IDs, provenance on every write (the GHGRP row URL), alias auto-merge of near-duplicate owner names, operator review queue, audit log |
| **Meterless Scout Intent** (contract format) | `app/agents/signoff.ts` | Sign-off issues an `ExecutionContract` in Scout's documented shape (`vendor/scout-intent/docs/execution-contract.md`), HMAC-SHA256 over canonical JSON, with an `operator-review` approval record. Only the contract format is used; Scout has no published implementation |
| **NVIDIA Nemotron** | `app/agents/plume_reader.ts`, `app/agents/reporter.ts` | **Nemotron 3.5 Lightning through Nightshift** words every dossier from unit-labelled facts; a guard rejects any number the code did not compute. **Nemotron 3.5 Super VL** reads each plume image *blind* (no wind, no candidates) and reports its heading; the code compares that with the wind. **Measured on the 60-plume live run: 24 of 64 readings agreed with the wind (38%), against about 33% for a random guess** on these 114-pixel quicklooks, so vision is **advisory**: agreement adds confidence, disagreement is recorded but never downgrades a case on its own (`config/skyledger.json` > `vision.advisory`). See the vision note below |
| **Cursor** | `.cursor/rules/`, `CURSOR.md` | Development environment |

| Meterless engine service | SkyLedger feature |
|---|---|
| World Model `upsertEntity` (resolver bands 0.85 / 0.82) | Merging `TARGA RESOURCES CORP` and `TARGA RESOURCES` into one parent |
| World Model `relate` (bitemporal edge with attrs) | `facility -owned_by-> company` with ownership % |
| World Model `mergeQueue` | Ownership review queue in the dossier |
| World Model `view("graph")` | Alias-following lookups for the parent roll-up |
| World Model `audit()` | Audited write count in the trace |

### Disclosure: the vision route

Nightshift 1.2.7 refuses image requests to both Nemotron Super VL models (NVIDIA-hosted and the OpenRouter free route), returning `no_vision_model`. Both models are kept out of its automatic routing, and its image check runs before a named model is honoured; text requests are unaffected. We reported it to Meterless, with the code location and a suggested fix: [docs/METERLESS_VISION_ISSUE.md](docs/METERLESS_VISION_ISSUE.md).

So PlumeReader **tries Nightshift first** and, only when Nightshift refuses the image, sends the same request to the same Nemotron VL model on NVIDIA's API (`NVIDIA_API_KEY`, optional). Every such call is logged in the trace as `PlumeReader / vision_route / fallback`, with Nightshift's refusal quoted, and the dossier evidence names the route (`nvidia-direct`). All text calls go through Nightshift. If a Nightshift build fixes the gate, the first attempt succeeds and nothing changes in our code. NVIDIA's hosted endpoint echoes the model as `private/nvidia/nemotron-3.5-super-120b-a12b`, a known NVIDIA quirk; the evidence records both the requested id and the echo.

## Configuration (nothing hardcoded)

| Where | What |
|---|---|
| `config/skyledger.json` | Every threshold with its rationale: attribution distances and wind cone, reporting window, minimum sightings, uncertainty limits, run caps, concurrency, CH₄ GWP by reporting year, model ids per provider. Each can be overridden by the environment variable named next to it |
| `config/regions/<id>.json` | One file per region: bounding box, states, reporting year, cache sizes, Zetaris tables. `npm run cache -- <id>` fetches and caches a region; the app and console list every region file |
| `.env` | Deployment values and secrets only (see `.env.example`) |

## Traces

Each run writes `logs/trace-<run_id>.jsonl` (one JSON object per line, also printed to stdout) with `timestamp, run_id, trace_id, seq, agent_name, action, input_summary, output_summary, target_agent, confidence, retry_count, status, plume_id, prev_hash, hash`. Each `hash` is sha256(prev_hash + line), so editing any line breaks the chain. Check one with `npm run verify -- output_examples/trace-example-2.jsonl` or the UI's "Verify hash chain" button. Statuses include `needs_revision` (send-back), `blocked`, `escalated` and `fallback`.

## API

`POST /run` takes `{"run_id"?, "input": {"question"?, "region"?, "year"?, "max_plumes"?, "plume_ids"?}, "options": {"sample_mode"?}}` and returns `{run_id, status, output: {summary, dossiers, rollup, review_queue, sources}, agents, trace_id, log_file, execution_time_seconds}`. Errors come back as `{"status":"error","error":{"code","message"}}`. Other endpoints: `GET /health`; `GET /api/status` (engine status, never secrets), `/api/stats`, `/api/geo`, `/api/examples`; `GET /api/run/stream` (server-sent events with trace lines and progress while a run executes, one run at a time); `GET /api/runs`, `/api/runs/:id`, `/api/runs/:id/trace`, `/api/runs/:id/verify`; `POST /api/signoff`; `GET|POST /api/labels`, `GET /api/label/queue`. Pages: `/`, `/app`, `/label`, `/deck`.

## Eval

`npm run eval` reruns all 60 plumes and scores three systems against hand labels in `eval/labels.csv`, made on the labelling page (`/label`). That page shows one plume at a time with its satellite picture and nearby facilities, and never SkyLedger's answers:
- **Baseline A:** nearest oil and gas facility within 2 km, with naive annualization
- **Baseline B:** a single LLM call with the same facts and no Skeptic (runs only when Nightshift is online)
- **SkyLedger**

Metrics are attribution accuracy, wrong facility blamed, abstentions and false discrepancy flags. Results go to `eval/results.md`.

Current result (15 labelled plumes, 5 more marked unsure and excluded):

| System | Attribution accuracy | Wrong facility blamed | Abstained | Discrepancy flags | False flags |
|---|---|---|---|---|---|
| Nearest facility ≤ 2 km | 67% | 33% | 0% | 7 | 1 |
| Single LLM, no Skeptic | 53% | 47% | 0% | 0 | 0 |
| **SkyLedger** | **73%** | **7%** | 7% | 4 | **0** |

How to read it honestly:
- **Small and not expert.** 15 plumes, labelled by the team, not by remote-sensing specialists.
- **Not fully independent.** The labelling page shows each facility's distance from the plume origin, and SkyLedger uses distance too, so agreement is partly expected. The clearer signal is the gap to the baselines, which see the same distances.
- **Baseline B varies.** It is a live model call (40% and 53% accuracy on two runs of the same labels).
- **Where SkyLedger and the labels disagree:** one plant 72 m from the origin that SkyLedger attributes but the labeller rejected from the image, two plants 1.1–1.2 km away that the labeller picked and SkyLedger left as "no reporter at the source", and one SkyLedger abstention.

## Examples

`input_examples/example_{1,2,3}.json` produce `output_examples/example_{1,2,3}.json` and `trace-example-{1,2,3}.jsonl`. These are real outputs from sample mode:
1. The full 60-plume Permian sweep
2. The three strongest candidate discrepancies
3. A trap set: plumes a nearest-facility match would pin on the wrong company

## Limitations (read before trusting a number)

- **Snapshots aren't annual totals.** Annualizing kg/h from a handful of overpasses is uncertain. That's why results are ranges, the low bound uses observed persistence, and R2 blocks sources with fewer than 2 sightings in the window.
- The rate is Carbon Mapper's **source-level average across all its plumes** (2019–2026). The reporting window only controls persistence.
- The dossier image is the source's most recent plume, which may postdate the reporting year.
- GHGRP coordinates can sit hundreds of metres from the emitting equipment. We allow 400 m (1 km if upwind).
- Basin-level `W-ONSH`/`W-GB` reports can't be compared at the facility level. SkyLedger says so (coverage gap) instead of guessing.
- Facility-level CH₄ totals include all subparts. Subpart W is estimated with emission factors in many cases, so a gap can reflect methodology, not misreporting. **SkyLedger says "inconsistent with available data", never "fraud".**
- The sample covers 60 sources in one basin and one reporting year.
- Live Zetaris and live Nightshift/Nemotron were tested on 2026-10-26 (see `output_examples/live/`). The Docker image was tested from a fresh clone with no `.env` and no network: `/health`, `/`, `/app` and `POST /run` all succeed.
- Vision is checked against the wind, but the plume quicklooks are small (about 114×113 px), so a disagreement may come from the image as much as from the wind estimate. SkyLedger treats a disagreement as a reason for doubt, never as proof.

## Data and licences

See `data/README.md`. Carbon Mapper data is used under its non-commercial terms with attribution. EPA GHGRP and SEC EDGAR data are US Government public data.

## Evidence

- `docs/evidence/world-model-conformance.txt`: Meterless's own World Model conformance suite, run against the engine SkyLedger uses: **8/8 checks pass**.
- `npm run check:meterless`: the provider done-criteria from Meterless's "Add Meterless as a provider" contract (wrong token is unauthorized, discovery online, plain text returns a string).
- `npx tsx scripts/check_zetaris_parity.ts`: the federated geo-join answered by Zetaris equals the cached sample engine for every plume (60/60 on 2026-10-26).
- `npx tsx scripts/check_vision.ts`: runs the vision step on real quicklooks through the configured route.

## Pre-existing components

- `vendor/world-model/`: the Meterless World Model reference implementation and conformance suite (Apache-2.0), vendored unmodified with `degit` from github.com/meterless/meterless.
- `vendor/scout-intent/`: Scout Intent spec (Apache-2.0), used for the contract format only.
- Open-source npm packages: `tsx`, `typescript`, `@types/node`, `three`, `gsap`, `lenis` and `@fontsource` fonts.
- Public data cached on 2026-10-26: Carbon Mapper and US EPA GHGRP RY2023 (see `data/README.md`).
- Planning documents were written from Oct 21 to 24, 2026. All SkyLedger product code was written during the build window (Oct 22–27, 2026).

## Repo layout

```text
app/
  agents/        geo_linker, plume_reader, ownership, reconciler, skeptic, reporter, signoff
  adapters/      zetaris.ts, meterless.ts, llm.ts (provider routing), sample_data.ts
  engines/       world_model.ts (wraps the vendored Meterless World Model)
  orchestrator.ts  state.ts  tracing.ts  config.ts  geo.ts
web/landing/     landing page (/): a 3D view of the real plume and facility data, and the story of one plume
web/app/         analyst console (/app): engine status, live streaming runs, basin map, dossier, trace, sign-off
web/label/       labelling page (/label): one plume at a time, builds eval/labels.csv without showing SkyLedger's answers
config/          skyledger.json (thresholds, models, limits) and regions/<id>.json
data/sample/     cached public data + images (data/README.md)
eval/            run_eval.ts, labels.csv, results.md
scripts/         cache_data.ts, export_zetaris_csv.ts, verify_trace.ts
docs/            setup guides, deck PDF, submission text, evidence, Meterless vision issue report
vendor/          Meterless World Model reference engine and Scout Intent spec (unmodified)
input_examples/  output_examples/  logs/
run.ts  Dockerfile  metadata.json  .env.example
```

## Team

- **Kaustubh Pardeshi**: [@Kaustubh-404](https://github.com/Kaustubh-404)
- **Atharva Waghachoure**: [@AtharvaWaghchoure](https://github.com/AtharvaWaghchoure)
