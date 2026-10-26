# Eval results

Generated 2026-10-26T00:45:51.581Z from `npm run eval` (sample data, 60 Permian plumes, GHGRP RY2023).

## Against hand labels (`eval/labels.csv`)

**No labels yet.** Label plumes in the UI ("Your label" in each dossier), then rerun `npm run eval`.

## Label-free diagnostic (not a substitute for labels)

- Nearest-facility matching names a facility **more than 1 km from the plume head** in **19 of 60** plumes. Carbon Mapper places the plume coordinate at the estimated emission origin, so those attributions are physically implausible.
- Naive annualization (all-time persistence, no time window, no rival tests) flags **34** discrepancies; SkyLedger flags **8** after the Skeptic.
