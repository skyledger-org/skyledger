// Runtime configuration. Reads .env (if present) without printing any values.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = process.cwd();
export const DATA_DIR = join(ROOT, "data", "sample");
export const LOG_DIR = join(ROOT, "logs");

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
const isPlaceholder = (v: string) => !v || /paste-|your-|example\.com|^rt-local$/i.test(v);

export const config = {
  sampleMode: env("SAMPLE_MODE", "true").toLowerCase() !== "false",
  port: Number(env("PORT", "8000")),
  meterless: {
    baseUrl: env("METERLESS_BASE_URL", "http://127.0.0.1:8088/v1"),
    token: env("METERLESS_RUNTIME_TOKEN"),
    app: "skyledger",
    // Lanes are routing modes or pinned model ids exposed by Nightshift.
    modelText: env("METERLESS_MODEL", "meterless/auto"),
    modelVision: env("METERLESS_MODEL_VISION", "meterless/vision"),
    modelReasoning: env("METERLESS_MODEL_REASONING", "meterless/deep"),
    timeoutMs: 180_000,
  },
  zetaris: {
    restUrl: env("ZETARIS_REST_URL", "http://localhost:8888/api/v1.0"),
    apiKey: env("ZETARIS_API_KEY"),
    orgId: env("ZETARIS_ORG_ID", "1"),
    tables: {
      plumes: env("ZETARIS_PLUMES_TABLE", "skyledger.cm_sources"),
      facilities: env("ZETARIS_FACILITIES_TABLE", "skyledger.ghgrp_facilities"),
      ch4: env("ZETARIS_CH4_TABLE", "skyledger.ghgrp_ch4"),
    },
    timeoutMs: 30_000,
  },
  // GWP used by GHGRP to report CH4 as CO2e for RY2023 (40 CFR 98 Table A-1 before the 2024 amendments: AR4, 25).
  ch4Gwp: Number(env("CH4_GWP", "25")),
  ghgrpYear: 2023,
  signingKey: env("SIGNOFF_SECRET", "skyledger-local-demo-key"),
};

export const hasMeterless = () => !isPlaceholder(config.meterless.token);
export const hasZetaris = () => !isPlaceholder(config.zetaris.apiKey);
