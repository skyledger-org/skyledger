// Skeptic: a discrepancy is only reported if all five rival explanations are ruled out or flagged.
// Every test is a query result or a geometric check; the Skeptic never decides on LLM judgement alone.
// It has role authority: it can send work back (GeoLinker, PlumeReader, Reconciler) or block the Reporter.
import { config } from "../config.ts";
import type { AgentContext } from "./context.ts";
import type { PlumeCase, Rival, Verdict } from "../state.ts";

// Thresholds come from config/skyledger.json (attribution.*, reconciliation.*).
const A = () => config.settings.attribution;
const R = () => config.settings.reconciliation;
export const maxRadiusM = () => A().max_search_radius_m;

export type SkepticDecision =
  | { action: "send_back"; target: "GeoLinker" | "PlumeReader" | "Reconciler"; reason: string; mode?: "no_annualization" }
  | { action: "decide"; verdict: Verdict };

const rival = (id: Rival["id"], name: string, status: Rival["status"], note: string): Rival => ({ id, name, status, note });

export function skepticReview(ctx: AgentContext, c: PlumeCase, iteration: { pr: number; gl: number; rc: number }): SkepticDecision {
  const p = c.plume;
  const log = (action: string, status: any, out: string, target?: string, conf?: number) =>
    ctx.tracer.log({ agent_name: "Skeptic", action, plume_id: p.plume_id, status, target_agent: target, output_summary: out, confidence: conf, retry_count: iteration.pr + iteration.gl + iteration.rc, input_summary: `${c.candidates.length} candidates, attributed ${c.attributed?.facility_name ?? "none"}` });
  const rivals: Rival[] = [];

  // R5 data quality
  const relUnc = p.emission_kgph && p.emission_uncertainty_kgph ? p.emission_uncertainty_kgph / p.emission_kgph : null;
  if (p.emission_kgph == null || p.emission_kgph <= 0) rivals.push(rival("R5", "Data quality", "failed", "no quantified emission rate for this source"));
  else if (relUnc != null && relUnc > R().max_relative_uncertainty) rivals.push(rival("R5", "Data quality", "failed", `uncertainty ${Math.round(relUnc * 100)}% of rate`));
  else if (p.wind_direction_deg == null) rivals.push(rival("R5", "Data quality", "flagged", "no wind estimate; attribution relies on distance only"));
  else rivals.push(rival("R5", "Data quality", "ruled_out", `rate ${Math.round(p.emission_kgph)} kg/h, uncertainty ${relUnc == null ? "n/a" : Math.round(relUnc * 100) + "%"}, wind present`));
  if (rivals[0].status === "failed") {
    c.rivals = rivals;
    log("test_rival_R5", "blocked", `Dropped: ${rivals[0].note}`, "Reporter", 0.9);
    return { action: "decide", verdict: "dropped_quality" };
  }

  // No candidate at all: widen the search before concluding anything.
  if (c.candidates.length === 0) {
    if (c.radius_m < maxRadiusM()) {
      log("request_wider_search", "needs_revision", `No oil & gas facility within ${c.radius_m} m; GeoLinker must widen to ${maxRadiusM()} m`, "GeoLinker", 0.5);
      return { action: "send_back", target: "GeoLinker", reason: `widen radius to ${maxRadiusM()} m` };
    }
    rivals.push(rival("R3", "Not a GHGRP reporter", "flagged", `no GHGRP oil & gas reporter within ${maxRadiusM()} m`));
    c.rivals = rivals;
    log("test_rival_R3", "blocked", `Unreported source: no GHGRP reporter within ${maxRadiusM()} m; no ratio possible`, "Reporter", 0.8);
    return { action: "decide", verdict: "unreported_source" };
  }

  const points = c.candidates.filter((k) => k.kind === "point");
  // R4 coverage: only basin-level reports nearby -> facility-level comparison is impossible.
  if (points.length === 0) {
    rivals.push(rival("R4", "Uncovered source category", "flagged", `only basin-level reports nearby (${c.candidates.map((k) => k.reported_industry_types).join(", ")}); their coordinates are representative, not the emitting site`));
    c.rivals = rivals;
    log("test_rival_R4", "blocked", "Coverage gap: plume falls under basin-aggregate W-ONSH/W-GB reporting; nearest-facility attribution would be spurious", "Reporter", 0.85);
    return { action: "decide", verdict: "coverage_gap" };
  }

  // R1 misattribution
  const pr = c.plume_reader!;
  const others = points.filter((k) => pr.consistent.includes(k.facility_id) && k.facility_id !== c.attributed?.facility_id && k.dist_m <= A().rival_radius_m);
  const canReread = pr.mode === "vision" && iteration.pr < 1;
  if (!c.attributed || pr.confidence < 0.5 || others.length) {
    const why = !c.attributed ? "no candidate consistent with plume origin and wind" : others.length ? `rival source ${others[0].facility_name} (${others[0].dist_m} m) also consistent` : `PlumeReader confidence ${pr.confidence.toFixed(2)}`;
    if (canReread) {
      log("test_rival_R1", "needs_revision", `Rival: ${why}. Sending back to PlumeReader for a second look`, "PlumeReader", 0.5);
      return { action: "send_back", target: "PlumeReader", reason: why };
    }
    // Nothing reporting sits at the plume head: blaming the nearest plant would be a false flag.
    const nearestPoint = points[0];
    if (!c.attributed && nearestPoint.dist_m > A().no_reporter_beyond_m) {
      rivals.push(rival("R1", "Misattribution", "ruled_out", `nearest reporting point facility ${nearestPoint.facility_name} is ${nearestPoint.dist_m} m from the plume head: not the source`));
      rivals.push(rival("R3", "Not a GHGRP reporter", "flagged", `no GHGRP point facility within ${A().no_reporter_beyond_m} m of the plume head; likely well-site or gathering equipment reported only at basin level, or not reported`));
      c.rivals = rivals;
      log("test_rival_R3", "blocked", `Unreported source: nearest reporting facility ${nearestPoint.dist_m} m away; a nearest-facility match would wrongly blame ${nearestPoint.facility_name}`, "Reporter", 0.8);
      return { action: "decide", verdict: "unreported_source" };
    }
    if (!c.attributed && c.radius_m < maxRadiusM()) {
      log("test_rival_R1", "needs_revision", `Rival: ${why}. Widening search to ${maxRadiusM()} m`, "GeoLinker", 0.45);
      return { action: "send_back", target: "GeoLinker", reason: why };
    }
    rivals.push(rival("R1", "Misattribution", "failed", why));
    c.rivals = rivals;
    log("test_rival_R1", "blocked", `Attribution uncertain: ${why}. Excluded from roll-up`, "Reporter", 0.7);
    return { action: "decide", verdict: "attribution_uncertain" };
  }
  const ruledOut = points.filter((k) => pr.inconsistent.includes(k.facility_id));
  // Wells and gathering lines report only at basin level, so they never appear as nearby points.
  // If the attributed facility isn't right at the origin, they stay a live rival: flag, don't rule out.
  const basinOps = c.candidates.filter((k) => k.kind === "basin_aggregate" && k.dist_m <= A().basin_rival_radius_m);
  const offOrigin = c.attributed.dist_m > A().at_origin_m;
  const r1Note = [
    ruledOut.length ? `${ruledOut.map((k) => `${k.facility_name} (${k.dist_m} m)`).join(", ")} ruled out by plume geometry (downwind of, or too far from, the plume head)` : `no other consistent point facility within ${A().rival_radius_m} m`,
    offOrigin && basinOps.length ? `origin is ${c.attributed.dist_m} m from ${c.attributed.facility_name}; well-site equipment reported only at basin level (${basinOps.map((k) => k.facility_name).join(", ")}) cannot be excluded` : "",
  ].filter(Boolean).join("; ");
  rivals.push(rival("R1", "Misattribution", offOrigin && basinOps.length ? "flagged" : "ruled_out", r1Note));
  log("test_rival_R1", "ok", `R1 ${rivals.at(-1)!.status === "flagged" ? "flagged" : "ruled out"}. ${r1Note}`, undefined, pr.confidence);

  const f = c.attributed;
  // R3 first if the facility is listed for the year but filed no subparts at all.
  if (!f.reported_subparts) {
    rivals.push(rival("R3", "Below reporting threshold", "flagged", `${f.facility_name} is listed for RY${ctx.state.input.year} with no reported subparts and no CH4 total`));
    c.rivals = rivals;
    log("test_rival_R3", "blocked", "Facility filed no subparts for the year; unreported source, not an under-report", "Reporter", 0.75);
    return { action: "decide", verdict: "unreported_source" };
  }
  // R4 coverage at the attributed facility: fugitive CH4 needs Subpart W.
  if (!/\bW\b/.test(f.reported_subparts)) {
    rivals.push(rival("R4", "Uncovered source category", "flagged", `${f.facility_name} reports subparts ${f.reported_subparts}, not W (oil & gas fugitives)`));
    c.rivals = rivals;
    log("test_rival_R4", "blocked", `Coverage gap: facility does not report the category a 1B2 plume falls under`, "Reporter", 0.8);
    return { action: "decide", verdict: "coverage_gap" };
  }
  rivals.push(rival("R4", "Uncovered source category", "ruled_out", `${f.facility_name} reports Subpart W (${f.reported_industry_types})`));

  // R3 below threshold / no CH4 reported
  if (!f.reported_ch4_t || f.reported_ch4_t <= 0) {
    rivals.push(rival("R3", "Below reporting threshold", "flagged", `no CH4 total reported for RY${ctx.state.input.year}`));
    c.rivals = rivals;
    log("test_rival_R3", "blocked", "Facility reports no CH4 for the year; unreported source, not an under-report", "Reporter", 0.75);
    return { action: "decide", verdict: "unreported_source" };
  }
  rivals.push(rival("R3", "Below reporting threshold", "ruled_out", `reports ${Math.round(f.reported_ch4_t)} t CH4 for RY${ctx.state.input.year}`));

  // R2 intermittency, measured only inside the reporting-year window
  const w = p.window;
  const seen = `seen on ${w.detections} of ${w.observations} overpass dates in ${w.from}..${w.to} (${p.detection_date_count} of ${p.observation_date_count} all-time)`;
  if (w.detections < R().min_detections_in_window) {
    rivals.push(rival("R2", "Intermittency", "failed", seen));
    c.rivals = rivals;
    if (c.implied_tch4 && iteration.rc < 1) {
      log("block_annualization", "blocked", `R2: ${seen}; Reconciler may not annualize`, "Reconciler", 0.9);
      return { action: "send_back", target: "Reconciler", reason: "too few sightings in reporting window", mode: "no_annualization" };
    }
    return { action: "decide", verdict: "insufficient_sightings" };
  }
  rivals.push(rival("R2", "Intermittency", "ruled_out", seen));
  c.rivals = rivals;

  const low = c.ratio?.[0] ?? 0;
  const verdict: Verdict = low > 1 ? "inconsistent_with_report" : "consistent_with_report";
  log("approve", "ok", verdict === "inconsistent_with_report" ? `All 5 rivals ruled out. Even the low bound is ${low}x the reported total` : `All rivals ruled out; low bound ${low}x reported: not inconsistent`, "Reporter", 0.8);
  return { action: "decide", verdict };
}
