// Orchestrator: a state machine over one shared RunState. Not a linear pipeline: the Skeptic decides
// what happens next and can send a case back to GeoLinker, PlumeReader or Reconciler (bounded loops).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config, hasMeterless, hasZetaris, LOG_DIR } from "./config.ts";
import { Tracer } from "./tracing.ts";
import { OwnershipGraph } from "./engines/world_model.ts";
import { sampleData } from "./adapters/sample_data.ts";
import { listSources } from "./adapters/zetaris.ts";
import { discover } from "./adapters/meterless.ts";
import { geoLink } from "./agents/geo_linker.ts";
import { readPlume } from "./agents/plume_reader.ts";
import { buildOwnershipGraph, resolveOwnership } from "./agents/ownership.ts";
import { reconcile } from "./agents/reconciler.ts";
import { skepticReview, MAX_RADIUS_M } from "./agents/skeptic.ts";
import { report } from "./agents/reporter.ts";
import { AGENTS, type AgentContext } from "./agents/context.ts";
import type { PlumeCase, Plume, RunInput, RunState } from "./state.ts";

const MAX_LOOPS = 4;

function loadPlumes(input: RunState["input"]): Plume[] {
  const d = sampleData();
  const bySource = new Map(d.sources.map((s: any) => [s.source_name, s]));
  let rows = d.plumes;
  if (input.plume_ids?.length) rows = rows.filter((p: any) => input.plume_ids!.includes(p.plume_id));
  return rows.slice(0, input.max_plumes).map((p: any) => {
    const s: any = bySource.get(p.source_name) ?? {};
    const from = `${input.year - 1}-07-01`, to = `${input.year + 1}-06-30`;
    const inWin = (d: string) => d >= from && d <= to;
    const det: string[] = s.detection_dates ?? [];
    const obs: string[] = s.observation_dates ?? [];
    return {
      ...p,
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
  const d = sampleData();
  const s = ctx.state;
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
  let models = "deterministic fallbacks (SAMPLE_MODE)";
  let modelsOnline = false;
  if (!forceSample && hasMeterless()) {
    const m = await discover();
    modelsOnline = m.status === "online";
    models = `Meterless Nightshift ${m.status}${m.models.length ? ` (${m.models.length} models)` : ""}`;
  } else if (!forceSample) models = "Meterless token not set: deterministic fallbacks";
  ctx.offlineSql = !zetarisOk;
  ctx.offlineModels = !modelsOnline;
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
  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    const d = skepticReview(ctx, c, it);
    if (d.action === "decide") {
      c.verdict = d.verdict;
      return;
    }
    c.revisions.push({ agent: d.target, reason: d.reason });
    if (d.target === "GeoLinker") {
      it.gl++;
      c.radius_m = MAX_RADIUS_M;
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
  ctx.tracer.log({ agent_name: "Orchestrator", action: "loop_cap", plume_id: c.plume.plume_id, status: "escalated", input_summary: `${MAX_LOOPS} review loops`, output_summary: "loop cap reached; marked attribution_uncertain" });
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

export async function run(runId: string, rawInput: RunInput, opts: { sample_mode?: boolean; echo?: boolean } = {}) {
  const forceSample = opts.sample_mode ?? config.sampleMode;
  const state: RunState = {
    run_id: runId,
    input: { region: "permian", year: config.ghgrpYear, max_plumes: 20, ...rawInput },
    sample_mode: forceSample,
    sources: [],
    cases: [],
    review_queue: [],
    started_at: Date.now(),
  };
  state.input.max_plumes = Math.min(Math.max(1, state.input.max_plumes), 60);
  const tracer = new Tracer(runId, opts.echo ?? true);
  const ctx: AgentContext = { state, tracer, graph: new OwnershipGraph(), offlineModels: true, offlineSql: true };
  tracer.log({ agent_name: "Orchestrator", action: "start_run", status: "ok", input_summary: state.input.question ?? "default question", output_summary: `sample_mode=${forceSample}, max_plumes=${state.input.max_plumes}` });

  await sourceMapper(ctx, forceSample);
  const rawByEntity = await buildOwnershipGraph(ctx);
  for (const plume of loadPlumes(state.input)) {
    const c: PlumeCase = { plume, radius_m: 1500, candidates: [], attributed: null, geolinker_pick: null, plume_reader: null, owners: [], implied_tch4: null, ratio: null, rivals: [], verdict: null, summary: "", evidence: [], revisions: [], status: "draft" };
    state.cases.push(c);
    await runCase(ctx, c, rawByEntity);
    await report(ctx, c);
  }

  const counts: Record<string, number> = {};
  for (const c of state.cases) counts[c.verdict!] = (counts[c.verdict!] ?? 0) + 1;
  const output = { summary: counts, dossiers: state.cases, rollup: rollup(state.cases), review_queue: state.review_queue, sources: state.sources };
  tracer.log({ agent_name: "Orchestrator", action: "finish_run", status: "ok", input_summary: `${state.cases.length} plumes`, output_summary: Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ") });

  const result = {
    run_id: runId,
    status: "success",
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
