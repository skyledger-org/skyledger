// Read-only payloads for the landing page and the console. Every figure is derived from the cached data
// (data/sample) and the latest saved real run (output_examples/example_1.json) and eval (eval/results.json);
// nothing on the landing page is typed in by hand.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, config, hasMeterless, hasZetaris, hasNvidiaDirect, listRegions } from "./config.ts";
import { discover } from "./adapters/meterless.ts";
import { zetarisSql } from "./adapters/zetaris.ts";
import { sampleData } from "./adapters/sample_data.ts";

const BASIN = /W-ONSH|W-GB|W-OFFS/;
const POINT = /W-PROC|W-NGTC|W-UNSTG|W-LNGIE|W-LNGSTG|W-TRANS/;
const readJson = (rel: string) => {
  const p = join(ROOT, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};

let geoCache: unknown = null;
/** Compact arrays: sources [lon, lat, kg/h, persistence, detections]; facilities [lon, lat, kind, t CH4, name]. */
export function geoPayload() {
  if (geoCache) return geoCache;
  const d = sampleData();
  const ch4 = new Map<number, number>();
  for (const r of d.ch4) ch4.set(r.facility_id, (ch4.get(r.facility_id) ?? 0) + r.ch4_co2e_t);
  const gwp = Number(process.env.CH4_GWP ?? 25);
  geoCache = {
    region: d.manifest.region ?? null,
    bbox: d.manifest.bbox ?? null,
    ghgrp_year: d.manifest.ghgrp_year ?? null,
    fetched_at: d.manifest.fetched_at ?? null,
    source_fields: ["lon", "lat", "emission_kgph", "persistence", "detections"],
    sources: d.sources.map((s: any) => [+s.lon.toFixed(5), +s.lat.toFixed(5), s.emission_kgph == null ? null : Math.round(s.emission_kgph), +(s.persistence ?? 0).toFixed(3), s.detection_date_count ?? 0]),
    facility_fields: ["lon", "lat", "kind", "reported_t_ch4", "name"],
    facilities: d.facilities.map((f: any) => {
      const types = String(f.reported_industry_types ?? "");
      const kind = BASIN.test(types) && !POINT.test(types) ? "basin_aggregate" : "point";
      const t = ch4.get(f.facility_id);
      return [+f.longitude.toFixed(5), +f.latitude.toFixed(5), kind, t == null ? null : Math.round(t / gwp), f.facility_name];
    }),
  };
  return geoCache;
}

export function statsPayload() {
  const d = sampleData();
  const run = readJson("output_examples/example_1.json");
  const evalRes = readJson("eval/results.json");
  const dossiers: any[] = run?.output?.dossiers ?? [];
  const inconsistent = dossiers.filter((x) => x.verdict === "inconsistent_with_report" && x.ratio);
  const featured = inconsistent.sort((a, b) => b.ratio[0] - a.ratio[0])[0] ?? null;
  return {
    data: {
      sources: d.sources.length,
      plumes_detailed: d.plumes.length,
      facilities: d.facilities.length,
      region: d.manifest.region ?? null,
      ghgrp_year: d.manifest.ghgrp_year ?? null,
    },
    run: run ? { run_id: run.run_id, plumes: dossiers.length, summary: run.output.summary, seconds: run.execution_time_seconds, sql_live: run.sql_live, models_live: run.models_live } : null,
    eval: evalRes ? { label_free: evalRes.label_free, labelled: evalRes.labelled, ambiguous: evalRes.ambiguous, baseline_a: evalRes.baseline_a, baseline_b: evalRes.baseline_b, skyledger: evalRes.skyledger } : null,
    agents: run?.agents ?? [],
    featured: featured && {
      plume_id: featured.plume.plume_id,
      image: featured.plume.image,
      platform: featured.plume.platform,
      scene_date: String(featured.plume.scene_timestamp).slice(0, 10),
      lat: featured.plume.lat,
      lon: featured.plume.lon,
      wind_from_deg: featured.plume.wind_direction_deg,
      wind_speed_ms: featured.plume.wind_speed_ms,
      rate_kgph: featured.plume.emission_kgph,
      sightings: featured.plume.window,
      facility: featured.attributed?.facility_name,
      parents: featured.owners.map((o: any) => o.name),
      implied_tch4: featured.implied_tch4,
      reported_tch4: featured.attributed?.reported_ch4_t == null ? null : Math.round(featured.attributed.reported_ch4_t),
      ratio: featured.ratio,
      rivals: featured.rivals.map((r: any) => ({ id: r.id, name: r.name, status: r.status, note: r.note })),
      candidates: featured.candidates.slice(0, 4).map((k: any) => ({ name: k.facility_name, dist_m: k.dist_m, kind: k.kind })),
    },
  };
}

// ---- Engine status for the console's status bar (cached briefly; never returns secrets) ----

type Engine = { id: string; name: string; role: string; state: "live" | "configured" | "offline" | "not_configured"; detail: string };
let statusCache: { at: number; body: unknown } | null = null;

export async function statusPayload() {
  if (statusCache && Date.now() - statusCache.at < 10_000) return statusCache.body;
  const engines: Engine[] = [];
  const t = (p: Promise<any>, ms: number) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

  if (!hasZetaris()) engines.push({ id: "zetaris", name: "Zetaris", role: "Federated SQL across the sources", state: "not_configured", detail: "ZETARIS_API_KEY not set; queries use the cached sample" });
  else {
    try { await t(zetarisSql("SELECT 1", 1), 4000); engines.push({ id: "zetaris", name: "Zetaris", role: "Federated SQL across the sources", state: "live", detail: `REST at ${config.zetaris.restUrl}` }); }
    catch (e) { engines.push({ id: "zetaris", name: "Zetaris", role: "Federated SQL across the sources", state: "offline", detail: `unreachable (${(e as Error).message.slice(0, 60)}); queries use the cached sample` }); }
  }
  if (!hasMeterless()) engines.push({ id: "nightshift", name: "Meterless Nightshift", role: "AI provider", state: "not_configured", detail: "METERLESS_RUNTIME_TOKEN not set" });
  else {
    const d = await t(discover(), 4000).catch(() => ({ status: "offline", models: [] }));
    engines.push({ id: "nightshift", name: "Meterless Nightshift", role: "AI provider", state: d.status === "online" ? "live" : "offline", detail: d.status === "online" ? `${d.models.length} models at ${config.meterless.baseUrl}` : `status ${d.status}` });
  }
  engines.push({ id: "nvidia", name: "NVIDIA Nemotron", role: config.provider === "nvidia" ? "AI provider" : "Vision fallback", state: hasNvidiaDirect() ? "configured" : "not_configured", detail: hasNvidiaDirect() ? `${config.nvidia.visionModel} / ${config.nvidia.textModel}` : "NVIDIA_API_KEY not set" });
  engines.push({ id: "world_model", name: "Meterless World Model", role: "Ownership entity graph", state: "live", detail: "in-process reference engine (8/8 conformance)" });

  const body = {
    provider: config.provider,
    sample_mode_default: config.sampleMode,
    live_available: engines.some((e) => e.id === "zetaris" && e.state === "live") || (config.provider === "nightshift" ? engines.some((e) => e.id === "nightshift" && e.state === "live") : config.provider === "nvidia" && hasNvidiaDirect()),
    limits: { max_plumes: config.settings.run.max_plumes, live_max_plumes: config.settings.run.live_max_plumes, default_max_plumes: config.settings.run.default_max_plumes },
    regions: listRegions().map((r) => ({ id: r.id, name: r.name, years: r.reporting_years_available, default_year: r.reporting_year })),
    default_region: config.region.id,
    engines,
  };
  statusCache = { at: Date.now(), body };
  return body;
}

// ---- Labelling queue for /label: plume facts and nearby facilities only, never SkyLedger's answers ----

/** Stable pseudo-random order, so plumes are not grouped by size or verdict and every visit sees the same queue. */
const shuffleKey = (id: string) => { let h = 2166136261; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

export function labelQueue() {
  const { source_run, batch } = config.settings.labelling;
  const { at_origin_m, upwind_max_m, calm_wind_ms } = config.settings.attribution;
  const run = readJson(source_run);
  const dossiers: any[] = run?.output?.dossiers ?? [];
  const plumes = dossiers
    .map((d) => {
      const p = d.plume;
      return {
        plume_id: p.plume_id, platform: p.platform, date: String(p.scene_timestamp).slice(0, 10),
        rate_kgph: p.emission_kgph, wind_from_deg: p.wind_direction_deg, wind_speed_ms: p.wind_speed_ms,
        image: p.image, bounds: p.plume_bounds, origin: [p.plume_lat ?? p.lat, p.plume_lon ?? p.lon],
        facilities: d.candidates.map((k: any) => ({ id: String(k.facility_id), name: k.facility_name, kind: k.kind, dist_m: k.dist_m, lat: k.latitude, lon: k.longitude })),
      };
    })
    // A plume with no reporting site nearby has only one possible answer, so it would only inflate the score.
    .filter((p) => p.facilities.some((f: any) => f.kind === "point"))
    .sort((a, b) => shuffleKey(a.plume_id) - shuffleKey(b.plume_id));
  return { run_id: run?.run_id ?? null, batch, near_m: at_origin_m, far_m: upwind_max_m, calm_ms: calm_wind_ms, plumes };
}
