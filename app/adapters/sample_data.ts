// Loads a region's cached public data (config/regions/<id>.json -> data_dir; see scripts/cache_data.ts
// and data/README.md). One cache per region and reporting year.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, config, regionById, type Region } from "../config.ts";

export interface SampleData {
  region: Region;
  year: number;
  sources: any[];
  plumes: any[];
  facilities: any[];
  ch4: any[];
  tickers: any[] | null;
  manifest: any;
}

const cache = new Map<string, SampleData>();

export function sampleData(regionId: string = config.region.id, year: number = config.ghgrpYear): SampleData {
  const key = `${regionId}:${year}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const region = regionById(regionId);
  const dir = join(ROOT, region.data_dir);
  const load = (name: string) => {
    const p = join(dir, name);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  };
  const d: SampleData = {
    region,
    year,
    sources: load("cm_sources.json") ?? [],
    plumes: load("cm_plumes.json") ?? [],
    facilities: load(`ghgrp_facilities_${year}.json`) ?? [],
    ch4: load(`ghgrp_ch4_${year}.json`) ?? [],
    tickers: load("edgar_tickers.json"),
    manifest: load("manifest.json") ?? {},
  };
  cache.set(key, d);
  return d;
}

export const dataDirFor = (regionId: string) => join(ROOT, regionById(regionId).data_dir);
