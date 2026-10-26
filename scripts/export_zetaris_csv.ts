// Writes the cached sample as flat CSVs for registering as Zetaris file sources (data/zetaris/).
// Zetaris cannot read files on the laptop: copy this folder somewhere its container can reach
// (a mounted volume or object storage) before registering. Table names must match ZETARIS_*_TABLE in .env.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, config } from "../app/config.ts";
import { sampleData } from "../app/adapters/sample_data.ts";

const OUT = join(ROOT, "data", "zetaris");
mkdirSync(OUT, { recursive: true });

const cell = (v: unknown) => {
  if (v == null) return "";
  const s = Array.isArray(v) ? v.join("|") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function csv(name: string, rows: any[], cols: string[]) {
  writeFileSync(join(OUT, name), [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n");
  console.log(`data/zetaris/${name}: ${rows.length} rows`);
}

const d = sampleData();
csv("cm_sources.csv", d.sources, ["source_name", "lat", "lon", "sector", "plume_count", "emission_kgph", "emission_uncertainty_kgph", "detection_date_count", "observation_date_count", "persistence", "first_detected", "last_detected", "detection_dates", "observation_dates"]);
csv(`ghgrp_facilities.csv`, d.facilities, ["facility_id", "facility_name", "latitude", "longitude", "state", "county", "naics_code", "parent_company", "reported_subparts", "reported_industry_types", "year"]);
csv(`ghgrp_ch4.csv`, d.ch4, ["facility_id", "year", "subpart", "ch4_co2e_t"]);
console.log(`Register as: ${Object.values(config.zetaris.tables).join(", ")}`);
