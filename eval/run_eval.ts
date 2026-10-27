// Eval: SkyLedger vs baselines on hand-labelled plume -> facility attributions (eval/labels.csv,
// written by the labelling buttons in the UI). Labels: <GHGRP facility_id> | none | ambiguous.
//   Baseline A: nearest oil & gas GHGRP facility within 2 km; flags a discrepancy if the naive
//               all-time annualization exceeds its report (no Skeptic, no wind, no time window).
//   Baseline B: one LLM call per plume with the same facts, no image, no Skeptic (only when Nightshift is live).
//   SkyLedger:  the full agent team.
// Usage: npm run eval   -> eval/results.md + eval/results.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, config, hasMeterless, hasNvidiaDirect } from "../app/config.ts";
import { run } from "../app/orchestrator.ts";
import { discover, parseJsonReply } from "../app/adapters/meterless.ts";
import { textChat } from "../app/adapters/llm.ts";
import type { PlumeCase } from "../app/state.ts";

type Pred = string; // facility_id | "none" | "abstain"

function readLabels(): Map<string, string> {
  const f = join(ROOT, "eval", "labels.csv");
  if (!existsSync(f)) return new Map();
  return new Map(readFileSync(f, "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(",")).filter((r) => r[0]).map((r) => [r[0], r[1]]));
}

function baselineA(c: PlumeCase) {
  const near = c.candidates.filter((k) => k.dist_m <= config.settings.attribution.rival_radius_m)[0];
  const pred: Pred = near ? String(near.facility_id) : "none";
  let flag = false;
  if (near && near.reported_ch4_t && c.plume.emission_kgph) {
    const naive = c.plume.emission_kgph * 8.76 * c.plume.persistence; // all-time persistence, no uncertainty
    flag = naive > near.reported_ch4_t;
  }
  return { pred, flag, dist: near?.dist_m ?? null };
}

function skyledger(c: PlumeCase) {
  if (c.verdict === "attribution_uncertain") return { pred: "abstain", flag: false };
  const pred: Pred = c.attributed ? String(c.attributed.facility_id) : "none";
  return { pred, flag: c.verdict === "inconsistent_with_report" };
}

async function baselineB(c: PlumeCase): Promise<Pred> {
  const facts = { wind_from_deg: c.plume.wind_direction_deg, wind_speed_ms: c.plume.wind_speed_ms, candidates: c.candidates.slice(0, 5).map((k) => ({ id: k.facility_id, name: k.facility_name, dist_m: k.dist_m, bearing_deg: k.bearing_from_plume_deg, type: k.reported_industry_types })) };
  const r = await textChat("general", [{ role: "user", content: `A methane plume was detected. Which facility is its source? Facts: ${JSON.stringify(facts)}. Reply JSON {"source_facility_id": id or null}.` }], { maxTokens: 80 });
  const id = parseJsonReply(r.text)?.source_facility_id;
  return id == null ? "none" : String(id);
}

function score(rows: { label: string; pred: Pred; flag: boolean }[]) {
  const n = rows.length;
  const correct = rows.filter((r) => r.pred === r.label).length;
  const wrongBlame = rows.filter((r) => r.pred !== "none" && r.pred !== "abstain" && r.pred !== r.label).length;
  const abstain = rows.filter((r) => r.pred === "abstain").length;
  const flags = rows.filter((r) => r.flag);
  const falseFlags = flags.filter((r) => r.pred !== r.label).length;
  const pct = (x: number) => (n ? Math.round((100 * x) / n) : 0);
  return { n, accuracy_pct: pct(correct), wrong_blame_pct: pct(wrongBlame), abstain_pct: pct(abstain), flags: flags.length, false_flags: falseFlags };
}

async function main() {
  const t0 = Date.now();
  const r = await run(`eval-${Date.now().toString(36)}`, { max_plumes: 60 }, { sample_mode: true, echo: false });
  const cases = r.output.dossiers as PlumeCase[];
  const labels = readLabels();
  const useB = config.provider === "nvidia" ? hasNvidiaDirect() : config.provider === "nightshift" && hasMeterless() && (await discover()).status === "online";

  // Label-free diagnostic: how often does nearest-facility matching blame a facility far from the plume head?
  const a = cases.map((c) => ({ c, ...baselineA(c) }));
  const farM = config.settings.attribution.no_reporter_beyond_m;
  const farBlame = a.filter((x) => x.dist != null && x.dist > farM).length;
  const naiveFlags = a.filter((x) => x.flag).length;
  const slFlags = cases.filter((c) => c.verdict === "inconsistent_with_report").length;

  const labelled = cases.filter((c) => labels.has(c.plume.plume_id) && labels.get(c.plume.plume_id) !== "ambiguous");
  const rowsA = [], rowsS = [], rowsB = [];
  for (const c of labelled) {
    const label = labels.get(c.plume.plume_id)!;
    rowsA.push({ label, ...baselineA(c) });
    rowsS.push({ label, ...skyledger(c) });
    if (useB) rowsB.push({ label, pred: await baselineB(c).catch(() => "none"), flag: false });
  }
  const res = {
    generated_at: new Date().toISOString(),
    plumes: cases.length,
    labelled: labelled.length,
    ambiguous: [...labels.values()].filter((v) => v === "ambiguous").length,
    label_free: { nearest_blames_over_1km: farBlame, naive_discrepancy_flags: naiveFlags, skyledger_discrepancy_flags: slFlags },
    baseline_a: labelled.length ? score(rowsA) : null,
    baseline_b: useB && labelled.length ? score(rowsB) : null,
    skyledger: labelled.length ? score(rowsS) : null,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
  };
  writeFileSync(join(ROOT, "eval", "results.json"), JSON.stringify(res, null, 1));
  const row = (name: string, s: any) => (s ? `| ${name} | ${s.n} | ${s.accuracy_pct}% | ${s.wrong_blame_pct}% | ${s.abstain_pct}% | ${s.flags} | ${s.false_flags} |` : `| ${name} | – | not run | | | | |`);
  const md = `# Eval results

Generated ${res.generated_at} from \`npm run eval\` (sample data, ${res.plumes} plumes, ${config.region.name}, GHGRP RY${config.ghgrpYear}).

## Against hand labels (\`eval/labels.csv\`)

${labelled.length ? `${res.labelled} labelled plumes (${res.ambiguous} more marked ambiguous and excluded).

| System | n | Attribution accuracy | Wrong facility blamed | Abstained | Discrepancy flags | False flags |
|---|---|---|---|---|---|---|
${row(`Baseline A: nearest facility ≤ ${config.settings.attribution.rival_radius_m} m`, res.baseline_a)}
${row("Baseline B: single LLM, no Skeptic", res.baseline_b)}
${row("SkyLedger agent team", res.skyledger)}

A false flag is a reported discrepancy against a facility the labeller says is not the source.` : "**No labels yet.** Label plumes in the UI (\"Your label\" in each dossier), then rerun `npm run eval`."}

## Label-free diagnostic (not a substitute for labels)

- Nearest-facility matching names a facility **more than ${farM} m from the plume head** in **${farBlame} of ${res.plumes}** plumes. Carbon Mapper places the plume coordinate at the estimated emission origin, so those attributions are physically implausible.
- Naive annualization (all-time persistence, no time window, no rival tests) flags **${naiveFlags}** discrepancies; SkyLedger flags **${slFlags}** after the Skeptic.
`;
  writeFileSync(join(ROOT, "eval", "results.md"), md);
  console.log(md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
