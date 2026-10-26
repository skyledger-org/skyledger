// Ownership graph on the Meterless World Model reference (vendor/world-model/reference, Apache-2.0, unmodified).
// Facilities, operators and parents are entities; "owned_by" edges carry the ownership share;
// every write carries provenance back to the GHGRP row. Near-duplicate owner names auto-merge (>= 0.85)
// or go to the World Model's operator review queue (0.82-0.85).
import { WorldModel } from "../../vendor/world-model/reference/src/index.ts";
export { entityIdFromName } from "../../vendor/world-model/reference/src/index.ts";

// GHGRP owner strings differ mostly in legal suffixes ("TARGA RESOURCES CORP" vs "TARGA RESOURCES").
// Strip those first; the World Model resolver handles the remaining spelling noise.
const SUFFIX = /\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LLC|L\.L\.C|LP|L\.P|LTD|LIMITED|PLC|HOLDINGS?|USA|U\.S\.A|OPERATING|THE)\b\.?/gi;

export function canonicalOwnerName(raw: string): string {
  return raw
    .replace(/\(.*?\)/g, " ")
    .replace(/[,.'’]/g, " ")
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function parseOwners(parent: string | null): { raw: string; pct: number | null }[] {
  if (!parent) return [];
  return parent
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/\(([\d.]+)%\)/);
      return { raw: s, pct: m ? Number(m[1]) : null };
    });
}

export class OwnershipGraph {
  readonly wm = new WorldModel({ namespace: "skyledger-ownership", storage: "memory", conflictPolicy: "most-recent-wins" });

  async addFacility(f: { facility_id: number; facility_name: string; parent_company: string | null }, year: number, runId: string) {
    const at = `${year}-12-31T00:00:00.000Z`;
    const source = { kind: "api", by: "OwnershipResolver", at, url: `https://data.epa.gov/efservice/PUB_DIM_FACILITY/FACILITY_ID/${f.facility_id}/YEAR/${year}/JSON`, runId };
    const fac = await this.wm.upsertEntity({ type: "facility", externalKey: { system: "ghgrp", id: String(f.facility_id) }, name: f.facility_name, source });
    const owners = [];
    for (const o of parseOwners(f.parent_company)) {
      const canon = canonicalOwnerName(o.raw);
      if (!canon) continue;
      const ent = await this.wm.upsertEntity({ type: "company", name: canon, attrs: { raw_name: o.raw }, source });
      await this.wm.relate({ from: fac.id, type: "owned_by", to: ent.id, attrs: { pct: o.pct, raw: o.raw }, source });
      owners.push({ raw: o.raw, pct: o.pct, entity_id: ent.id });
    }
    return { facilityEntityId: fac.id, owners };
  }

  company(id: string) {
    return this.wm.view("graph").entity(id);
  }

  pendingReviews() {
    return this.wm.mergeQueue().filter((p) => p.status === "pending");
  }

  auditCount() {
    return this.wm.audit().length;
  }
}
