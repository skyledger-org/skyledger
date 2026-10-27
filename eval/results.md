# Eval results

Generated 2026-10-27T10:09:59.687Z from `npm run eval` (sample data, 60 plumes, Permian Basin (TX/NM), GHGRP RY2023).

## Against hand labels (`eval/labels.csv`)

15 labelled plumes (5 more marked ambiguous and excluded).

| System | n | Attribution accuracy | Wrong facility blamed | Abstained | Discrepancy flags | False flags |
|---|---|---|---|---|---|---|
| Baseline A: nearest facility ≤ 2000 m | 15 | 67% | 33% | 0% | 7 | 1 |
| Baseline B: single LLM, no Skeptic | 15 | 53% | 47% | 0% | 0 | 0 |
| SkyLedger agent team | 15 | 73% | 7% | 7% | 4 | 0 |

A false flag is a reported discrepancy against a facility the labeller says is not the source.

**Read with care.** This is a small sanity check, not expert ground truth: the labels come from the team on the `/label` page, which hides SkyLedger's answers but shows each facility's distance from the plume origin, a cue SkyLedger also uses. Baseline B is a live model call, so its row can vary between runs.

## Label-free diagnostic (not a substitute for labels)

- Nearest-facility matching names a facility **more than 1000 m from the plume head** in **18 of 60** plumes. Carbon Mapper places the plume coordinate at the estimated emission origin, so those attributions are physically implausible.
- Naive annualization (all-time persistence, no time window, no rival tests) flags **34** discrepancies; SkyLedger flags **8** after the Skeptic.
