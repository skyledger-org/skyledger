// Runtime configuration. Defaults live in config/skyledger.json and config/regions/*.json; deployment values
// and secrets come from the environment (.env locally). Nothing is printed, and no secret has a default.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const ROOT = process.cwd();
export const LOG_DIR = join(ROOT, "logs");
const CONFIG_DIR = join(ROOT, "config");

function loadDotEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
loadDotEnv();

const env = (k: string, d = "") => process.env[k] ?? d;
const isPlaceholder = (v: string) => !v || /paste-|your-|example\.com|change-me|^rt-local$/i.test(v);
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const S = readJson(join(CONFIG_DIR, "skyledger.json"));
/** A config value, overridden by the env var named in its `<key>_env` sibling when that var is set. */
function pick<T>(obj: any, key: string): T {
  const envName = obj[`${key}_env`];
  const raw = envName ? process.env[envName] : undefined;
  if (raw === undefined || raw === "") return obj[key];
  return (typeof obj[key] === "number" ? Number(raw) : raw) as T;
}

export interface Region {
  id: string;
  name: string;
  bbox: { west: number; south: number; east: number; north: number };
  states: string[];
  reporting_year: number;
  reporting_years_available: number[];
  ipcc_sector: string;
  data_dir: string;
  cache: { max_detailed_sources: number; multi_candidate: number; persistent: number; single_sighting: number; near_facility_m: number };
  zetaris: { database: string; tables: { plumes: string; facilities: string; ch4: string }; container_dir: string };
}

export function listRegions(): Region[] {
  const dir = join(CONFIG_DIR, "regions");
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readJson(join(dir, f)) as Region);
}
export function regionById(id: string): Region {
  const r = listRegions().find((x) => x.id === id);
  if (!r) throw new Error(`unknown region "${id}" (add config/regions/${id}.json)`);
  return r;
}

const region = regionById(pick<string>(S, "default_region"));

export function gwpFor(year: number): number {
  if (env("CH4_GWP")) return Number(env("CH4_GWP"));
  const g = S.ch4_gwp_by_reporting_year[String(year)];
  if (typeof g !== "number") throw new Error(`no CH4 GWP configured for reporting year ${year} (config/skyledger.json)`);
  return g;
}

export type ProviderName = "nightshift" | "nvidia" | "none";
const provider = pick<string>(S.providers, "default") as ProviderName;
if (!["nightshift", "nvidia", "none"].includes(provider)) throw new Error(`AI_PROVIDER must be nightshift, nvidia or none (got "${provider}")`);
const models = (p: "nightshift" | "nvidia") => ({
  reporter: pick<string>(S.providers[p], "reporter"),
  vision: pick<string>(S.providers[p], "vision"),
  general: pick<string>(S.providers[p], "general"),
});

// The sign-off HMAC secret: from the environment, else a random per-install key kept in logs/ (git-ignored).
function signingKey(): string {
  const v = env("SIGNOFF_SECRET");
  if (!isPlaceholder(v)) return v;
  const f = join(LOG_DIR, ".signoff-secret");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  mkdirSync(LOG_DIR, { recursive: true });
  const k = randomBytes(32).toString("hex");
  writeFileSync(f, k, { mode: 0o600 });
  return k;
}

export const config = {
  sampleMode: env("SAMPLE_MODE", "true").toLowerCase() !== "false",
  port: Number(env("PORT", "8000")),
  region,
  provider,
  settings: {
    attribution: S.attribution as Record<string, number>,
    reconciliation: S.reconciliation as Record<string, number>,
    vision: S.vision as { advisory: boolean; agree_boost: number },
    run: {
      default_max_plumes: S.run.default_max_plumes as number,
      max_plumes: S.run.max_plumes as number,
      max_review_loops: S.run.max_review_loops as number,
      model_concurrency: pick<number>(S.run, "model_concurrency"),
      live_max_plumes: pick<number>(S.run, "live_max_plumes"),
    },
    labelling: S.labelling as { source_run: string; batch: number },
  },
  meterless: {
    baseUrl: env("METERLESS_BASE_URL", "http://127.0.0.1:8088/v1"),
    token: env("METERLESS_RUNTIME_TOKEN"),
    app: "skyledger",
    ...(() => { const m = models("nightshift"); return { modelText: m.general, modelVision: m.vision, modelReasoning: m.reporter }; })(),
    timeoutMs: 180_000,
  },
  zetaris: {
    restUrl: env("ZETARIS_REST_URL", "http://localhost:8888/api/v1.0"),
    apiKey: env("ZETARIS_API_KEY"),
    orgId: env("ZETARIS_ORG_ID", "1"),
    tables: {
      plumes: env("ZETARIS_PLUMES_TABLE", region.zetaris.tables.plumes),
      facilities: env("ZETARIS_FACILITIES_TABLE", region.zetaris.tables.facilities),
      ch4: env("ZETARIS_CH4_TABLE", region.zetaris.tables.ch4),
    },
    timeoutMs: 30_000,
  },
  // NVIDIA API directly: the provider when AI_PROVIDER=nvidia, and the fallback for the image step when
  // Nightshift 1.2.7 refuses images (docs/METERLESS_VISION_ISSUE.md).
  nvidia: {
    baseUrl: env("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"),
    apiKey: env("NVIDIA_API_KEY"),
    ...(() => { const m = models("nvidia"); return { textModel: m.reporter, visionModel: m.vision }; })(),
    timeoutMs: 120_000,
  },
  ghgrpYear: Number(env("GHGRP_YEAR", String(region.reporting_year))),
  get ch4Gwp() { return gwpFor(this.ghgrpYear); },
  signingKey: signingKey(),
};

export const DATA_DIR = join(ROOT, region.data_dir);
export const hasMeterless = () => !isPlaceholder(config.meterless.token);
export const hasZetaris = () => !isPlaceholder(config.zetaris.apiKey);
export const hasNvidiaDirect = () => config.nvidia.apiKey.startsWith("nvapi-");
