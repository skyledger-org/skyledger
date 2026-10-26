// Loads the cached public data in data/sample/ (see scripts/cache_data.ts and data/README.md).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, config } from "../config.ts";

const load = (name: string) => {
  const p = join(DATA_DIR, name);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};

export interface SampleData {
  sources: any[];
  plumes: any[];
  facilities: any[];
  ch4: any[];
  tickers: any[] | null;
  manifest: any;
}

let cached: SampleData | null = null;

export function sampleData(): SampleData {
  if (cached) return cached;
  const y = config.ghgrpYear;
  cached = {
    sources: load("cm_sources.json") ?? [],
    plumes: load("cm_plumes.json") ?? [],
    facilities: load(`ghgrp_facilities_${y}.json`) ?? [],
    ch4: load(`ghgrp_ch4_${y}.json`) ?? [],
    tickers: load("edgar_tickers.json"),
    manifest: load("manifest.json") ?? {},
  };
  return cached;
}
