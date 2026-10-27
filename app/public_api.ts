// Read-only payloads for the landing page and the console. Every figure is derived from the cached data
// (data/sample) and the latest saved real run (output_examples/example_1.json) and eval (eval/results.json);
// nothing on the landing page is typed in by hand.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config.ts";
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
    eval: evalRes ? { label_free: evalRes.label_free, labelled: evalRes.labelled, baseline_a: evalRes.baseline_a, skyledger: evalRes.skyledger } : null,
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
