# Eval results

Generated 2026-10-27T00:19:58.109Z from `npm run eval` (sample data, 60 plumes, Permian Basin (TX/NM), GHGRP RY2023).

## Against hand labels (`eval/labels.csv`)

**No labels yet.** Label plumes in the UI ("Your label" in each dossier), then rerun `npm run eval`.

## Label-free diagnostic (not a substitute for labels)

- Nearest-facility matching names a facility **more than 1000 m from the plume head** in **18 of 60** plumes. Carbon Mapper places the plume coordinate at the estimated emission origin, so those attributions are physically implausible.
- Naive annualization (all-time persistence, no time window, no rival tests) flags **34** discrepancies; SkyLedger flags **8** after the Skeptic.
