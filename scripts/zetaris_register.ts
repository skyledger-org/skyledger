// Registers SkyLedger's CSVs as Zetaris filestore tables and checks row counts.
// Prerequisite: the CSVs from `npm run export:zetaris` copied into the Zetaris driver container at
//   /home/zetaris/customer-data/shared/skyledger/  (the platform's ZETARIS_LOCAL_FILE_SYTEM_ROOT_PATH)
// Usage: npx tsx scripts/zetaris_register.ts      (needs ZETARIS_API_KEY in .env; one statement per call)
import { zetarisSql } from "../app/adapters/zetaris.ts";
import { config, hasZetaris } from "../app/config.ts";
import { sampleData } from "../app/adapters/sample_data.ts";

const DB = "skyledger";
const DIR = "/home/zetaris/customer-data/shared/skyledger";
const TABLES = [
  { name: "cm_sources", expect: () => sampleData().sources.length },
  { name: "ghgrp_facilities", expect: () => sampleData().facilities.length },
  { name: "ghgrp_ch4", expect: () => sampleData().ch4.length },
];

async function step(sql: string, allowFail = false) {
  try {
    const rows = await zetarisSql(sql, 10);
    console.log(`OK   ${sql.split("\n")[0].slice(0, 90)}`);
    return rows;
  } catch (e) {
    console.log(`${allowFail ? "SKIP" : "FAIL"} ${sql.split("\n")[0].slice(0, 90)}\n     ${(e as Error).message.slice(0, 300)}`);
    if (!allowFail) throw e;
    return null;
  }
}

async function main() {
  if (!hasZetaris()) throw new Error("Set ZETARIS_API_KEY in .env first");
  console.log(`Zetaris at ${config.zetaris.restUrl}`);
  await step("SELECT 1");
  await step(`CREATE LIGHTNING DATABASE ${DB} DESCRIBE BY "SkyLedger-CarbonMapper-methane-and-EPA-GHGRP-RY2023"`, true);
  for (const t of TABLES) {
    let ok = false;
    for (const path of [`file://${DIR}/${t.name}.csv`, `${DIR}/${t.name}.csv`]) {
      const r = await step(`CREATE LIGHTNING FILESTORE TABLE ${t.name} FROM ${DB} FORMAT CSV OPTIONS (\n  PATH "${path}", header "true", inferSchema "true")`, true);
      if (r) { ok = true; break; }
    }
    const n = await step(`SELECT COUNT(*) AS n FROM ${DB}.${t.name}`, !ok);
    if (n) console.log(`     rows: ${JSON.stringify(n[0])} (cache has ${t.expect()})`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
