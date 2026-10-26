// Zetaris adapter. Live mode sends federated SQL to the local Zetaris REST API
// (POST {ZETARIS_REST_URL}/sql-editor/sqls/run). Sample mode answers the SAME query
// from the cached files in data/sample/ and says so in the evidence; it never pretends to be Zetaris.
import { randomUUID, createHash } from "node:crypto";
import { config, hasZetaris } from "../config.ts";
import { sampleData } from "./sample_data.ts";
import { haversineM, bearingDeg } from "../geo.ts";
import type { Candidate, Plume } from "../state.ts";

export interface SqlResult<T> {
  rows: T[];
  engine: "zetaris" | "sample";
  sql: string;
  rows_hash: string;
  ms: number;
  fallback_reason?: string;
}

export const rowsHash = (rows: unknown[]) => createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);

const esc = (s: string) => s.replace(/'/g, "''");

/** One SQL statement per call (Zetaris rule). Returns rows as objects. */
export async function zetarisSql(sql: string, limit = 1000): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${config.zetaris.restUrl.replace(/\/$/, "")}/sql-editor/sqls/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.zetaris.apiKey}`,
      "X-Org-ID": config.zetaris.orgId,
      "X-Request-ID": randomUUID(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ queryId: randomUUID(), sql, source: "SqlEditor", limit }),
    signal: AbortSignal.timeout(config.zetaris.timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Zetaris ${res.status}: ${text.slice(0, 200)}`);
  return parseRows(JSON.parse(text));
}

// The REST response nests rows differently across versions; accept the common shapes.
function parseRows(body: any): Record<string, unknown>[] {
  const node = body?.data ?? body?.result ?? body;
  const rows = node?.rows ?? node?.records ?? node?.data ?? node;
  const cols: string[] | undefined = (node?.columns ?? node?.schema ?? body?.columns)?.map((c: any) => (typeof c === "string" ? c : c.name ?? c.columnName));
  if (Array.isArray(rows) && rows.length && Array.isArray(rows[0]) && cols) {
    return rows.map((r: unknown[]) => Object.fromEntries(cols.map((c, i) => [c.toLowerCase(), r[i]])));
  }
  if (Array.isArray(rows)) return rows.map((r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])));
  throw new Error("Zetaris: unrecognised response shape");
}

export async function listSources(): Promise<{ name: string; ok: boolean; rows: number }[]> {
  const t = config.zetaris.tables;
  const out = [];
  for (const [name, table] of Object.entries(t)) {
    try {
      const r = await zetarisSql(`SELECT COUNT(*) AS n FROM ${table}`, 1);
      out.push({ name: table, ok: true, rows: Number(Object.values(r[0] ?? {})[0] ?? 0) });
    } catch (e) {
      out.push({ name: `${name}:${table}`, ok: false, rows: 0 });
    }
  }
  return out;
}

export function geoJoinSql(sourceName: string, radiusM: number): string {
  const t = config.zetaris.tables;
  const dLat = (radiusM / 111_000).toFixed(4);
  const dLon = (radiusM / 94_000).toFixed(4); // ~cos(32°) at Permian latitudes
  return `SELECT p.source_name, f.facility_id, f.facility_name, f.latitude, f.longitude, f.parent_company,
       f.naics_code, f.reported_subparts, f.reported_industry_types, e.ch4_co2e_t,
       2 * 6371000 * ASIN(SQRT(POWER(SIN(RADIANS(f.latitude - p.lat) / 2), 2)
         + COS(RADIANS(p.lat)) * COS(RADIANS(f.latitude)) * POWER(SIN(RADIANS(f.longitude - p.lon) / 2), 2))) AS dist_m
FROM ${t.plumes} p
JOIN ${t.facilities} f
  ON f.latitude BETWEEN p.lat - ${dLat} AND p.lat + ${dLat}
 AND f.longitude BETWEEN p.lon - ${dLon} AND p.lon + ${dLon}
LEFT JOIN (SELECT facility_id, SUM(ch4_co2e_t) AS ch4_co2e_t FROM ${t.ch4} GROUP BY facility_id) e
  ON e.facility_id = f.facility_id
WHERE p.source_name = '${esc(sourceName)}'
ORDER BY dist_m`;
}

const POINT_TYPES = /W-PROC|W-NGTC|W-UNSTG|W-LNGIE|W-LNGSTG|W-TRANS/;
const BASIN_TYPES = /W-ONSH|W-GB|W-OFFS/;

function toCandidate(row: any, plume: Plume): Candidate {
  const types = String(row.reported_industry_types ?? "");
  const kind = BASIN_TYPES.test(types) && !POINT_TYPES.test(types) ? "basin_aggregate" : "point";
  const naics = String(row.naics_code ?? "");
  // IPCC 1B2 (oil & gas fugitives) maps to oil & gas extraction, support, pipelines and Subpart W.
  const sector_compatible = /^(211|213|486|4247)/.test(naics) || /\bW\b/.test(String(row.reported_subparts ?? ""));
  const lat = Number(row.latitude), lon = Number(row.longitude);
  return {
    facility_id: Number(row.facility_id),
    facility_name: String(row.facility_name),
    latitude: lat,
    longitude: lon,
    parent_company: row.parent_company ?? null,
    naics_code: naics,
    reported_subparts: String(row.reported_subparts ?? ""),
    reported_industry_types: types,
    kind,
    sector_compatible,
    dist_m: Math.round(Number(row.dist_m ?? haversineM(plume.lat, plume.lon, lat, lon))),
    bearing_from_plume_deg: Math.round(bearingDeg(plume.lat, plume.lon, lat, lon)),
    reported_ch4_t: row.ch4_co2e_t == null ? null : Number(row.ch4_co2e_t) / config.ch4Gwp,
  };
}

function sampleGeoJoin(plume: Plume, radiusM: number) {
  const d = sampleData();
  const ch4 = new Map<number, number>();
  for (const r of d.ch4) ch4.set(r.facility_id, (ch4.get(r.facility_id) ?? 0) + r.ch4_co2e_t);
  return d.facilities
    .map((f) => ({ ...f, source_name: plume.source_name, ch4_co2e_t: ch4.get(f.facility_id) ?? null, dist_m: haversineM(plume.lat, plume.lon, f.latitude, f.longitude) }))
    .filter((f) => f.dist_m <= radiusM)
    .sort((a, b) => a.dist_m - b.dist_m);
}

/** Federated geo-join: Carbon Mapper source x GHGRP facilities x GHGRP CH4 totals. */
export async function candidatesNear(plume: Plume, radiusM: number, forceSample: boolean): Promise<SqlResult<Candidate>> {
  const sql = geoJoinSql(plume.source_name, radiusM);
  const t0 = Date.now();
  let fallback_reason: string | undefined;
  if (!forceSample && hasZetaris()) {
    try {
      const raw = await zetarisSql(sql);
      const rows = raw.filter((r: any) => Number(r.dist_m) <= radiusM).map((r) => toCandidate(r, plume));
      return { rows, engine: "zetaris", sql, rows_hash: rowsHash(rows), ms: Date.now() - t0 };
    } catch (e) {
      fallback_reason = (e as Error).message;
    }
  } else if (!forceSample) {
    fallback_reason = "ZETARIS_API_KEY not set";
  }
  const rows = sampleGeoJoin(plume, radiusM).map((r) => toCandidate(r, plume));
  return { rows, engine: "sample", sql, rows_hash: rowsHash(rows), ms: Date.now() - t0, fallback_reason };
}
