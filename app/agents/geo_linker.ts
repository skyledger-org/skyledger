// GeoLinker: no LLM. Federated SQL through Zetaris; ranks facilities by distance.
import { candidatesNear } from "../adapters/zetaris.ts";
import type { AgentContext } from "./context.ts";
import type { PlumeCase } from "../state.ts";

export async function geoLink(ctx: AgentContext, c: PlumeCase, retry = 0) {
  const p = c.plume;
  let res = await candidatesNear(p, c.radius_m, ctx.offlineSql);
  if (res.fallback_reason && !ctx.offlineSql) {
    ctx.tracer.log({
      agent_name: "GeoLinker", action: "zetaris_query", plume_id: p.plume_id, retry_count: retry, status: "fallback",
      input_summary: `geo-join r=${c.radius_m} m`, output_summary: `Zetaris unavailable (${res.fallback_reason}); answered from cached sample`,
    });
  }
  c.candidates = res.rows.filter((r) => r.sector_compatible);
  c.evidence.push({ source: res.engine === "zetaris" ? "zetaris" : "sample-cache", kind: "sql", detail: `geo-join r=${c.radius_m} m -> ${res.rows.length} facilities (${c.candidates.length} oil & gas)`, sql: res.sql, rows_hash: res.rows_hash });
  const top = c.candidates[0];
  c.geolinker_pick = top?.facility_id ?? null;
  const list = c.candidates.slice(0, 4).map((x) => `${x.facility_name} ${x.dist_m} m${x.kind === "basin_aggregate" ? " [basin aggregate]" : ""}`).join("; ");
  ctx.tracer.log({
    agent_name: "GeoLinker", action: "geo_join", plume_id: p.plume_id, retry_count: retry, status: "ok",
    input_summary: `plume ${p.plume_id} (${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}), radius ${c.radius_m} m, engine ${res.engine}`,
    output_summary: c.candidates.length ? `${c.candidates.length} candidates: ${list}` : "no oil & gas facility within radius",
    target_agent: "PlumeReader", confidence: top ? Math.max(0.2, 1 - top.dist_m / c.radius_m) : 0,
    data: { rows_hash: res.rows_hash, ms: res.ms, engine: res.engine },
  });
}
