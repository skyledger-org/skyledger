# HackOS submission: text to paste

Everything below matches what the code does. Check the team details before submitting: **the team locks when the first submission is created.**

## Project name
SkyLedger

## One-sentence description
An AI agent team that checks satellite-observed methane plumes against what facilities report to the US EPA, and who owns them, for ESG and credit analysts and regulators.

## Short description
Satellites now detect methane plumes from oil and gas sites, companies report yearly emissions to the EPA, and ownership sits in free-text strings. The three sources share no keys, units or clock, so nobody checks one against the other. SkyLedger's eight agents join them in place through Zetaris, attribute each plume using wind and plume geometry (with NVIDIA Nemotron reading the image as a check), resolve owners into parent companies on the Meterless World Model, and convert kg/h into yearly ranges against the reported totals. A Skeptic agent must rule out five rival explanations, and can block or send work back, before a guarded draft is written by Nemotron through Meterless Nightshift. Nothing is shareable until an analyst signs an execution contract. On 60 Permian plumes, a naive nearest-facility approach flags 34 discrepancies; after the Skeptic, 8 remain, each with ranges, evidence and a hash-chained trace.

## Track
Track 1: Solving Fragmented Intelligence

## Links
- GitHub (public): https://github.com/skyledger-org/skyledger
- Demo video: *(add after upload)*
- Slide deck: `docs/deck/SkyLedger-deck.pdf` in the repo *(or upload the PDF)*

## Sponsor technology explanation

**Zetaris (the data layer).** The three Carbon Mapper and EPA GHGRP tables are registered as Zetaris Lightning filestore tables (`scripts/zetaris_register.ts`). GeoLinker runs one federated geo-join over the Zetaris REST SQL API: Carbon Mapper sources × GHGRP facilities × GHGRP CH₄ totals, with haversine distance and a bounding-box prefilter. The data is queried in place, not copied into our app. The SQL text and a hash of the returned rows go into every dossier as evidence, and SourceMapper discovers the sources and row counts at the start of each run. Verified live: the Zetaris result equals the offline cache for 60 of 60 plumes (`scripts/check_zetaris_parity.ts`).

**Meterless.**
- **Nightshift** is the primary AI provider. It's built to Meterless's "Add Meterless as a provider" contract: URL normalisation, `meterless-app` and `meterless-scope` headers, `/v1/models` discovery with an unauthorized state, `rt-local` rejection, a 180 s timeout and Auto Detect. `npm run check:meterless` passes the contract's done-criteria.
- **World Model** (the reference engine, unmodified) holds the facility → owner → parent graph. It merges messy owner strings (e.g. "TARGA RESOURCES CORP" and "TARGA RESOURCES"), keeps provenance on every write and a review queue. Its own conformance suite passes 8/8 against the engine we run (`docs/evidence/world-model-conformance.txt`).
- **Scout Intent's execution-contract format** is used at analyst sign-off: HMAC-SHA256 over canonical JSON, bound to the dossier hash and the trace head.

**Cursor.** *(Fill in from CURSOR.md: what you built or changed in Cursor, with dates.)*

**NVIDIA.**
- Nemotron 3.5 Lightning, through Nightshift, writes every dossier from unit-labelled facts. A guard rejects any number the code didn't compute.
- Nemotron 3.5 Super VL reads each plume image blind, without the wind or the candidates, and reports the plume's heading. The code compares that with the wind. We measured it: on 114-pixel quicklooks it agreed with the wind on 24 of 64 live readings (38%, against about 33% by chance), so vision is advisory and never downgrades a case on its own.
- Disclosure: Nightshift 1.2.7 refuses image requests to Nemotron VL models, so PlumeReader tries Nightshift first and, only then, calls NVIDIA's API directly, logging each fallback. Reported to Meterless (`docs/METERLESS_VISION_ISSUE.md`).

**What was unique.**
- Zetaris joins satellite and regulatory data in place, and the analyst sees the exact SQL.
- The Meterless World Model is used for corporate ownership resolution, the "company names alone are not enough to join records" gap.
- Agents check agents: a Skeptic with blocking and send-back power, visible in a hash-chained trace that streams live.
- Every number in the product, landing page and deck comes from the API.
- Sponsor capabilities are measured honestly rather than claimed.

## Pre-existing components
- `vendor/world-model/`: the Meterless World Model reference implementation and conformance suite (Apache-2.0), vendored unmodified.
- `vendor/scout-intent/`: the Scout Intent spec (Apache-2.0); only the contract format is used.
- Open-source npm packages: tsx, typescript, three, gsap, lenis, @fontsource fonts.
- Public data cached on 2026-10-26: Carbon Mapper, US EPA GHGRP RY2023.
- Planning documents (spec, research, handoff) were written from 2026-10-21 to 24. **All product code was written during the build window (22–27 Oct 2026).**

## Team
*(Confirm: names, HackOS emails, GitHub usernames, roles, primary contact.)*
