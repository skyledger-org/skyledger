// OwnershipResolver: GHGRP "parent_company" strings -> canonical parent entities on the Meterless World Model.
import { canonicalOwnerName, parseOwners, entityIdFromName } from "../engines/world_model.ts";
import { sampleData } from "../adapters/sample_data.ts";
import type { AgentContext } from "./context.ts";
import type { Owner, PlumeCase } from "../state.ts";

/** Loads every facility's owners into the World Model once per run, so resolution sees the whole dataset. */
export async function buildOwnershipGraph(ctx: AgentContext) {
  const d = sampleData();
  const rawByEntity = new Map<string, Set<string>>();
  for (const f of d.facilities) {
    const { owners } = await ctx.graph.addFacility(f, ctx.state.input.year, ctx.state.run_id);
    for (const o of owners) {
      const id = ctx.graph.company(o.entity_id)?.id ?? o.entity_id;
      if (!rawByEntity.has(id)) rawByEntity.set(id, new Set());
      rawByEntity.get(id)!.add(o.raw.replace(/\s*\([\d.]+%\)/, ""));
    }
  }
  const merged = [...rawByEntity.values()].filter((s) => s.size > 1).length;
  ctx.tracer.log({
    agent_name: "OwnershipResolver", action: "build_world_model", status: "ok",
    input_summary: `${d.facilities.length} GHGRP facilities, owner strings`,
    output_summary: `${rawByEntity.size} parent entities; ${merged} merged from differently spelled owner strings; ${ctx.graph.pendingReviews().length} pairs in review queue; ${ctx.graph.auditCount()} audited writes`,
    data: { engine: "meterless/world-model reference" },
  });
  return rawByEntity;
}

let tickerIndex: Map<string, { cik: string; ticker: string; title: string }> | null = null;
function cikFor(canon: string) {
  const t = sampleData().tickers;
  if (!t) return null;
  tickerIndex ??= new Map(t.map((x: any) => [canonicalOwnerName(x.title), { cik: String(x.cik_str).padStart(10, "0"), ticker: x.ticker, title: x.title }]));
  return tickerIndex.get(canon) ?? null;
}

export async function resolveOwnership(ctx: AgentContext, c: PlumeCase, rawByEntity: Map<string, Set<string>>) {
  const f = c.attributed;
  if (!f) return;
  const pending = ctx.graph.pendingReviews();
  const owners: Owner[] = [];
  for (const o of parseOwners(f.parent_company)) {
    const canon = canonicalOwnerName(o.raw);
    // Content-derived id; the graph view follows aliases to the merged primary entity.
    const ent = ctx.graph.company(entityIdFromName("company", canon));
    if (!ent) continue;
    const review = pending.some((p) => p.leftId === ent.id || p.rightId === ent.id);
    const sec = cikFor(canonicalOwnerName(ent.name ?? canon));
    const mergedFrom = [...(rawByEntity.get(ent.id) ?? [])];
    owners.push({ raw: o.raw, name: ent.name ?? canon, pct: o.pct, entity_id: ent.id, cik: sec?.cik ?? null, confidence: review ? 0.6 : mergedFrom.length > 1 ? 0.9 : 0.95, merged_from: mergedFrom, review });
    if (review) ctx.state.review_queue.push({ kind: "ownership", detail: `${o.raw}: near-duplicate parent names awaiting operator merge decision` });
  }
  c.owners = owners;
  c.evidence.push({ source: "meterless-world-model", kind: "entity", detail: owners.map((o) => `${o.raw} -> ${o.name}${o.cik ? ` (CIK ${o.cik})` : ""} [${o.entity_id}]`).join("; ") || "no owner listed" });
  const anyReview = owners.some((o) => o.review);
  ctx.tracer.log({
    agent_name: "OwnershipResolver", action: anyReview ? "escalate_review_queue" : "resolve_owner", plume_id: c.plume.plume_id,
    status: anyReview ? "escalated" : "ok", target_agent: anyReview ? "ReviewQueue" : "Reconciler",
    input_summary: `${f.facility_name}: "${f.parent_company ?? "none"}"`,
    output_summary: owners.map((o) => `${o.name}${o.pct != null ? ` ${o.pct}%` : ""}${o.merged_from.length > 1 ? ` (merged ${o.merged_from.length} spellings)` : ""}${o.cik ? ` CIK ${o.cik}` : ""}`).join("; ") || "no owner",
    confidence: owners.length ? Math.min(...owners.map((o) => o.confidence)) : 0,
  });
}
