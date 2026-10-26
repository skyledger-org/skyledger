// Pulls a small, documented slice of public data for the Permian Basin into data/sample/.
// This cache powers SAMPLE_MODE (no network, no credentials) and is what we register in Zetaris.
// Usage: npm run cache            (SEC_USER_AGENT in .env enables the EDGAR pull)
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "data", "sample");
const IMG = join(OUT, "images");
mkdirSync(IMG, { recursive: true });

const BBOX = { west: -104.5, south: 30.5, east: -101.0, north: 33.5 }; // Permian Basin, TX/NM
const YEAR = 2023; // latest GHGRP reporting year published on Envirofacts (RY2024 returns no rows as of 2026-10-26)
const MAX_DETAILED_SOURCES = 60;
const CM = "https://api.carbonmapper.org/api/v1/catalog";
const EF = "https://data.epa.gov/efservice";

function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      console.warn(`  retry ${attempt + 1} ${url.slice(0, 100)}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error(`failed: ${url}`);
}

function save(name: string, data: unknown) {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 1));
  console.log(`  wrote data/sample/${name}`);
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

async function main() {
  loadDotEnv();
  const fetchedAt = new Date().toISOString();

  console.log("1/5 Carbon Mapper CH4 sources (Permian bbox)");
  const b = BBOX;
  const srcUrl = `${CM}/sources.geojson?plume_gas=CH4&status=published&minpoints=1&eps=500&bbox=${b.west}&bbox=${b.south}&bbox=${b.east}&bbox=${b.north}`;
  const geo = await getJson(srcUrl);
  // Scene and plume names embed their acquisition date (e.g. GAO20240517t173526, tan20260825t185002).
  const dates = (names: string[]) => [...new Set(names.map((n) => n.match(/(\d{4})(\d{2})(\d{2})t\d{6}/)).filter(Boolean).map((m) => `${m![1]}-${m![2]}-${m![3]}`))].sort();
  const sources = geo.features.map((f: any) => {
    const p = f.properties;
    return {
      detection_dates: dates(p.plume_ids),
      observation_dates: dates(p.observation_scenes_names ?? []),
      source_name: p.source_name.split("?")[0],
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      sector: p.sector,
      plume_count: p.plume_count,
      plume_ids: p.plume_ids,
      emission_kgph: p.emission_auto,
      emission_uncertainty_kgph: p.emission_uncertainty_auto,
      detection_date_count: p.detection_date_count,
      observation_date_count: p.observation_date_count,
      persistence: p.persistence,
      first_detected: p.timestamp_min,
      last_detected: p.timestamp_max,
      basin_name: p.basin_name,
    };
  });
  save("cm_sources.json", sources);

  console.log(`2/5 EPA GHGRP facilities RY${YEAR} (TX, NM) in bbox`);
  const facilities: any[] = [];
  for (const st of ["TX", "NM"]) {
    const rows = await getJson(`${EF}/PUB_DIM_FACILITY/STATE/${st}/YEAR/${YEAR}/ROWS/0:5000/JSON`);
    for (const f of rows) {
      if (f.latitude == null || f.longitude == null) continue;
      if (f.latitude < b.south || f.latitude > b.north || f.longitude < b.west || f.longitude > b.east) continue;
      facilities.push({
        facility_id: f.facility_id,
        facility_name: f.facility_name,
        latitude: f.latitude,
        longitude: f.longitude,
        state: f.state,
        county: f.county,
        naics_code: f.naics_code,
        parent_company: f.parent_company,
        reported_subparts: f.reported_subparts,
        reported_industry_types: f.reported_industry_types,
        year: f.year,
      });
    }
  }
  save(`ghgrp_facilities_${YEAR}.json`, facilities);

  console.log(`3/5 EPA GHGRP CH4 emissions by subpart RY${YEAR}`);
  const ids = new Set(facilities.map((f) => f.facility_id));
  const subparts = await getJson(`${EF}/PUB_DIM_SUBPART/JSON`);
  const spName = new Map(subparts.map((s: any) => [s.subpart_id, s.subpart_name]));
  const emissions: any[] = [];
  for (let start = 0; start < 20000; start += 5000) {
    const rows = await getJson(`${EF}/PUB_FACTS_SUBP_GHG_EMISSION/YEAR/${YEAR}/GAS_ID/2/ROWS/${start}:${start + 4999}/JSON`);
    for (const r of rows) {
      if (ids.has(r.facility_id))
        emissions.push({ facility_id: r.facility_id, year: r.year, subpart: spName.get(r.sub_part_id) ?? String(r.sub_part_id), ch4_co2e_t: r.co2e_emission });
    }
    if (rows.length < 5000) break;
  }
  save(`ghgrp_ch4_${YEAR}.json`, emissions);
  save("ghgrp_subparts.json", subparts);

  console.log("4/5 Carbon Mapper plume details + images for sources near reporting facilities");
  const scored = sources
    .filter((s: any) => s.sector === "1B2")
    .map((s: any) => {
      const near = facilities
        .map((f) => ({ id: f.facility_id, d: haversineM(s.lat, s.lon, f.latitude, f.longitude) }))
        .filter((x) => x.d < 3000)
        .sort((a, b) => a.d - b.d);
      return { s, near };
    })
    .filter((x: any) => x.near.length > 0)
    // Prefer sources overflown within the reporting-year window (RY +/- 6 months), so comparisons are time-aligned.
    .filter((x: any) => x.s.observation_dates.some((d: string) => d >= `${YEAR - 1}-07-01` && d <= `${YEAR + 1}-06-30`))
    // Mix: persistent emitters, single sightings (R2 traps) and multi-candidate cases (R1 traps).
    .sort((a: any, b: any) => (b.near.length > 1 ? 1 : 0) - (a.near.length > 1 ? 1 : 0) || b.s.emission_kgph - a.s.emission_kgph);
  const multi = scored.filter((x: any) => x.near.length > 1).slice(0, 25);
  const persistent = scored.filter((x: any) => x.near.length === 1 && x.s.detection_date_count >= 2).slice(0, 25);
  const single = scored.filter((x: any) => x.near.length === 1 && x.s.detection_date_count < 2).slice(0, 10);
  const chosen = [...multi, ...persistent, ...single].slice(0, MAX_DETAILED_SOURCES);
  console.log(`  near-facility sources: ${scored.length}; chosen ${chosen.length} (multi ${multi.length}, persistent ${persistent.length}, single ${single.length})`);

  const plumes: any[] = [];
  for (const { s } of chosen) {
    // Most recent plume of the source is the one the dossier shows.
    const pid = [...s.plume_ids].sort().at(-1);
    const r = await getJson(`${CM}/plumes/annotated?plume_names=${encodeURIComponent(pid)}&limit=1`);
    const p = r.items?.[0];
    if (!p) continue;
    const imgFile = `${p.plume_id}.png`;
    if (p.plume_rgb_png && !existsSync(join(IMG, imgFile))) {
      const res = await fetch(p.plume_rgb_png, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) writeFileSync(join(IMG, imgFile), Buffer.from(await res.arrayBuffer()));
    }
    plumes.push({
      plume_id: p.plume_id,
      source_name: s.source_name,
      lon: p.geometry_json.coordinates[0],
      lat: p.geometry_json.coordinates[1],
      scene_timestamp: p.scene_timestamp,
      platform: p.platform,
      instrument: p.instrument,
      sector: p.sector,
      emission_kgph: p.emission_auto,
      emission_uncertainty_kgph: p.emission_uncertainty_auto,
      wind_speed_ms: p.wind_speed_avg_auto,
      wind_direction_deg: p.wind_direction_avg_auto,
      plume_bounds: p.plume_bounds,
      plume_quality: p.plume_quality,
      image: existsSync(join(IMG, imgFile)) ? `images/${imgFile}` : null,
    });
    process.stdout.write(".");
  }
  console.log();
  save("cm_plumes.json", plumes);

  console.log("5/5 SEC EDGAR company tickers");
  const ua = process.env.SEC_USER_AGENT;
  if (!ua || ua.includes("example.com")) {
    console.log("  skipped: set SEC_USER_AGENT in .env (SEC requires a contact email)");
  } else {
    const t = await getJson("https://www.sec.gov/files/company_tickers.json", { "User-Agent": ua });
    save("edgar_tickers.json", Object.values(t));
  }

  save("manifest.json", {
    fetched_at: fetchedAt,
    region: "Permian Basin (TX/NM)",
    bbox: BBOX,
    ghgrp_year: YEAR,
    counts: { cm_sources: sources.length, cm_plumes: plumes.length, facilities: facilities.length, ch4_rows: emissions.length },
    sources: {
      carbon_mapper: { url: srcUrl, licence: "Carbon Mapper data terms (non-commercial use with attribution)" },
      epa_ghgrp: { url: `${EF}/PUB_DIM_FACILITY`, licence: "US Government public data" },
      sec_edgar: { url: "https://www.sec.gov/files/company_tickers.json", licence: "US Government public data" },
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
