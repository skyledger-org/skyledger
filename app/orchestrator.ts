// Orchestrator: a state machine over one shared RunState. Not a linear pipeline: the Skeptic decides
// what happens next and can send a case back to GeoLinker, PlumeReader or Reconciler (bounded loops).
// Limits, region and year come from config/ (see app/config.ts); nothing here is a magic number.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config, hasMeterless, hasZetaris, hasNvidiaDirect, regionById, LOG_DIR } from "./config.ts";
import { Tracer, type TraceLine } from "./tracing.ts";
import { OwnershipGraph } from "./engines/world_model.ts";
import { sampleData } from "./adapters/sample_data.ts";
import { listSources } from "./adapters/zetaris.ts";
import { connect } from "./adapters/meterless.ts";
import { geoLink } from "./agents/geo_linker.ts";
import { readPlume } from "./agents/plume_reader.ts";
import { buildOwnershipGraph, resolveOwnership } from "./agents/ownership.ts";
import { reconcile } from "./agents/reconciler.ts";
import { skepticReview, maxRadiusM } from "./agents/skeptic.ts";
import { report } from "./agents/reporter.ts";
import { AGENTS, type AgentContext } from "./agents/context.ts";
import type { PlumeCase, Plume, RunInput, RunState } from "./state.ts";

const R = () => config.settings.run;

/** RY window: `before` months before the reporting year starts to `after` months after it ends. */
function reportingWindow(year: number) {
  const { window_months_before_year: before, window_months_after_year: after } = config.settings.reconciliation;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(new Date(Date.UTC(year, -before, 1))), to: iso(new Date(Date.UTC(year + 1, after, 0))) };
}

function loadPlumes(input: RunState["input"]): Plume[] {
  const d = sampleData(input.region, input.year);
  const bySource = new Map(d.sources.map((s: any) => [s.source_name, s]));
  let rows = d.plumes;
  if (input.plume_ids?.length) rows = rows.filter((p: any) => input.plume_ids!.includes(p.plume_id));
  const { from, to } = reportingWindow(input.year);
  const inWin = (x: string) => x >= from && x <= to;
  return rows.slice(0, input.max_plumes).map((p: any) => {
    const s: any = bySource.get(p.source_name) ?? {};
    const det: string[] = s.detection_dates ?? [];
    const obs: string[] = s.observation_dates ?? [];
    return {
      ...p,
      // Attribution uses the Carbon Mapper SOURCE location (the clustered origin the rate and persistence
      // describe, and the row the Zetaris join keys on); the plume record keeps its own point for the image.
      plume_lat: p.lat,
      plume_lon: p.lon,
      lat: s.lat ?? p.lat,
      lon: s.lon ?? p.lon,
      detection_dates: det,
      observation_dates: obs,
      // A detection implies an observation that day, even if the scene list omits it.
      window: { from, to, detections: det.filter(inWin).length, observations: new Set([...obs, ...det].filter(inWin)).size },
      emission_kgph: s.emission_kgph ?? p.emission_kgph ?? null,
      emission_uncertainty_kgph: s.emission_uncertainty_kgph ?? p.emission_uncertainty_kgph ?? null,
      detection_date_count: s.detection_date_count ?? 1,
      observation_date_count: s.observation_date_count ?? 1,
      persistence: s.persistence ?? 1,
    };
  });
}

async function sourceMapper(ctx: AgentContext, forceSample: boolean) {
  const s = ctx.state;
  const d = sampleData(s.input.region, s.input.year);
  let zetarisOk = false;
  if (!forceSample && hasZetaris()) {
    const srcs = await listSources().catch(() => []);
    zetarisOk = srcs.length > 0 && srcs.every((x) => x.ok);
    for (const x of srcs) s.sources.push({ name: x.name, via: "zetaris", rows: x.rows, ok: x.ok });
  }
  if (!zetarisOk) {
    s.sources.push(
      { name: "carbon_mapper.sources", via: "sample-cache", rows: d.sources.length, ok: d.sources.length > 0 },
      { name: "ghgrp.facilities", via: "sample-cache", rows: d.facilities.length, ok: d.facilities.length > 0 },
      { name: "ghgrp.ch4", via: "sample-cache", rows: d.ch4.length, ok: d.ch4.length > 0 },
      { name: "sec_edgar.tickers", via: "sample-cache", rows: d.tickers?.length ?? 0, ok: !!d.tickers },
    );
  }
  let models = "deterministic fallbacks (sample mode)";
  let modelsOnline = false;
  if (!forceSample && config.provider === "nightshift" && hasMeterless()) {
    const m = await connect();
    modelsOnline = m.status === "online";
    models = `Meterless Nightshift ${m.status} at ${m.baseUrl}${m.models.length ? ` (${m.models.length} models)` : ""}`;
  } else if (!forceSample && config.provider === "nvidia" && hasNvidiaDirect()) {
    modelsOnline = true;
    models = `NVIDIA API (${config.nvidia.textModel}, ${config.nvidia.visionModel})`;
  } else if (!forceSample) models = `AI provider "${config.provider}" not configured: deterministic fallbacks`;
  ctx.offlineSql = !zetarisOk;
  ctx.offlineModels = !modelsOnline;
  s.engines = { sql: zetarisOk ? "zetaris" : "sample-cache", models: modelsOnline ? config.provider : "none", models_detail: models };
  ctx.tracer.log({
    agent_name: "SourceMapper", action: "map_sources", status: zetarisOk || forceSample ? "ok" : "fallback", target_agent: "GeoLinker",
    input_summary: `region ${s.input.region}, GHGRP RY${s.input.year}`,
    output_summary: `${s.sources.map((x) => `${x.name} via ${x.via} (${x.rows} rows)`).join("; ")}. Models: ${models}`,
    confidence: 1,
  });
}

async function runCase(ctx: AgentContext, c: PlumeCase, rawByEntity: Map<string, Set<string>>) {
  const it = { gl: 0, pr: 0, rc: 0 };
  await geoLink(ctx, c);
  await readPlume(ctx, c);
  await resolveOwnership(ctx, c, rawByEntity);
  reconcile(ctx, c);
  for (let loop = 0; loop < R().max_review_loops; loop++) {
    const d = skepticReview(ctx, c, it);
    if (d.action === "decide") {
      c.verdict = d.verdict;
      return;
    }
    c.revisions.push({ agent: d.target, reason: d.reason });
    if (d.target === "GeoLinker") {
      it.gl++;
      c.radius_m = maxRadiusM();
      await geoLink(ctx, c, it.gl);
      await readPlume(ctx, c, it.pr);
      await resolveOwnership(ctx, c, rawByEntity);
      reconcile(ctx, c);
    } else if (d.target === "PlumeReader") {
      it.pr++;
      await readPlume(ctx, c, it.pr);
      await resolveOwnership(ctx, c, rawByEntity);
      reconcile(ctx, c);
    } else {
      it.rc++;
      reconcile(ctx, c, d.mode);
    }
  }
  c.verdict = "attribution_uncertain";
  ctx.tracer.log({ agent_name: "Orchestrator", action: "loop_cap", plume_id: c.plume.plume_id, status: "escalated", input_summary: `${R().max_review_loops} review loops`, output_summary: "loop cap reached; marked attribution_uncertain" });
}

export function rollup(cases: PlumeCase[]) {
  const by = new Map<string, { parent: string; cik: string | null; facilities: Set<number>; surviving: number; consistent: number; excluded: number; ratio_range: [number, number] | null }>();
  for (const c of cases) {
    for (const o of c.owners) {
      const r = by.get(o.entity_id) ?? { parent: o.name, cik: o.cik, facilities: new Set(), surviving: 0, consistent: 0, excluded: 0, ratio_range: null };
      r.facilities.add(c.attributed!.facility_id);
      if (c.verdict === "inconsistent_with_report") {
        r.surviving++;
        r.ratio_range = r.ratio_range ? [Math.min(r.ratio_range[0], c.ratio![0]), Math.max(r.ratio_range[1], c.ratio![1])] : [c.ratio![0], c.ratio![1]];
      } else if (c.verdict === "consistent_with_report") r.consistent++;
      else r.excluded++;
      by.set(o.entity_id, r);
    }
  }
  return [...by.values()]
    .map((r) => ({ ...r, facilities: r.facilities.size }))
    .sort((a, b) => b.surviving - a.surviving || b.facilities - a.facilities);
}

/** Runs `fn` over `items` with at most `n` in flight; results keep input order. */
async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
}

export interface RunOptions {
  sample_mode?: boolean;
  echo?: boolean;
  onTrace?: (line: TraceLine) => void;
  onProgress?: (p: { done: number; total: number; plume_id: string; verdict: string | null }) => void;
}

export async function run(runId: string, rawInput: RunInput, opts: RunOptions = {}) {
  const forceSample = opts.sample_mode ?? config.sampleMode;
  const region = regionById(rawInput.region ?? config.region.id);
  const year = Number(rawInput.year ?? (rawInput.region ? region.reporting_year : config.ghgrpYear));
  if (!region.reporting_years_available.includes(year)) throw new Error(`no cached GHGRP data for ${region.id} RY${year} (available: ${region.reporting_years_available.join(", ")})`);
  const state: RunState = {
    run_id: runId,
    input: { max_plumes: R().default_max_plumes, ...rawInput, region: region.id, year },
    sample_mode: forceSample,
    sources: [],
    cases: [],
    review_queue: [],
    started_at: Date.now(),
  };
  const tracer = new Tracer(runId, opts.echo ?? true);
  tracer.onLine = opts.onTrace ?? null;
  const ctx: AgentContext = { state, tracer, graph: new OwnershipGraph(), offlineModels: true, offlineSql: true };

  await sourceMapper(ctx, forceSample);
  // Live model calls cost time and credits: live runs get their own cap.
  const cap = ctx.offlineModels ? R().max_plumes : Math.min(R().max_plumes, R().live_max_plumes);
  state.input.max_plumes = Math.min(Math.max(1, Number(state.input.max_plumes) || 1), cap);
  tracer.log({ agent_name: "Orchestrator", action: "start_run", status: "ok", input_summary: state.input.question ?? "default question", output_summary: `region ${region.id}, RY${year}, sample_mode=${forceSample}, max_plumes=${state.input.max_plumes} (cap ${cap}), concurrency ${ctx.offlineModels ? 1 : R().model_concurrency}` });

  const rawByEntity = await buildOwnershipGraph(ctx);
  const plumes = loadPlumes(state.input);
  state.cases = plumes.map((plume) => ({ plume, radius_m: config.settings.attribution.initial_search_radius_m, candidates: [], attributed: null, geolinker_pick: null, plume_reader: null, owners: [], implied_tch4: null, ratio: null, rivals: [], verdict: null, summary: "", evidence: [], revisions: [], status: "draft" }) as PlumeCase);
  let done = 0;
  await pool(state.cases, ctx.offlineModels ? 1 : R().model_concurrency, async (c) => {
    await runCase(ctx, c, rawByEntity);
    await report(ctx, c);
    opts.onProgress?.({ done: ++done, total: state.cases.length, plume_id: c.plume.plume_id, verdict: c.verdict });
  });

  const counts: Record<string, number> = {};
  for (const c of state.cases) counts[c.verdict!] = (counts[c.verdict!] ?? 0) + 1;
  const output = { summary: counts, dossiers: state.cases, rollup: rollup(state.cases), review_queue: state.review_queue, sources: state.sources };
  tracer.log({ agent_name: "Orchestrator", action: "finish_run", status: "ok", input_summary: `${state.cases.length} plumes`, output_summary: Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ") });

  const result = {
    run_id: runId,
    status: "success",
    input: state.input,
    engines: state.engines,
    output,
    agents: AGENTS,
    models_live: !ctx.offlineModels,
    sql_live: !ctx.offlineSql,
    trace_id: `trace-${runId}`,
    log_file: `logs/trace-${runId}.jsonl`,
    trace_head: tracer.headHash,
    execution_time_seconds: Math.round((Date.now() - state.started_at) / 100) / 10,
  };
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(join(LOG_DIR, `run-${runId}.json`), JSON.stringify(result, null, 1));
  return result;
}
