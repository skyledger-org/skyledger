// Parity check: the federated geo-join answered by Zetaris must equal the cached sample engine,
// for every plume in the sample. Usage: npx tsx scripts/check_zetaris_parity.ts
import { candidatesNear } from "../app/adapters/zetaris.ts";
import { sampleData } from "../app/adapters/sample_data.ts";

const d = sampleData();
const bySource = new Map(d.sources.map((s: any) => [s.source_name, s]));
let same = 0, diff = 0, ms = 0;
for (const p of d.plumes) {
  const s: any = bySource.get(p.source_name) ?? {};
  const plume: any = { ...p, ...s, lat: s.lat ?? p.lat, lon: s.lon ?? p.lon };
  const live = await candidatesNear(plume, 3000, false);
  const cache = await candidatesNear(plume, 3000, true);
  ms += live.ms;
  if (live.engine !== "zetaris") { console.log("FALLBACK", p.plume_id, live.fallback_reason); diff++; continue; }
  const a = live.rows.map((r) => `${r.facility_id}:${r.dist_m}`).join(",");
  const b = cache.rows.map((r) => `${r.facility_id}:${r.dist_m}`).join(",");
  if (a === b) same++;
  else { diff++; console.log("DIFF", p.plume_id, "\n  zetaris:", a, "\n  cache:  ", b); }
}
console.log(`${same} identical, ${diff} different, of ${d.plumes.length}; mean Zetaris query ${Math.round(ms / d.plumes.length)} ms`);
