// PlumeReader: judges which candidate the plume points back to.
// Physics first: Carbon Mapper's plume coordinate is the estimated origin, and the plume extends DOWNWIND.
// A facility lying downwind of the origin is in the plume's path, not at its head, so it can't be the source.
// Live mode adds Nemotron vision (via Meterless Nightshift) on the plume image; the geometry stays as a check.
import { chat, imageDataUrl, parseJsonReply } from "../adapters/meterless.ts";
import { config } from "../config.ts";
import { angleDiff, compass } from "../geo.ts";
import type { AgentContext } from "./context.ts";
import type { Candidate, PlumeCase } from "../state.ts";

const NEAR_M = 400; // GHGRP coordinates are often a gate or centroid; within this, location can't discriminate
const CONE = 60;

export function geometryVerdict(c: PlumeCase) {
  const p = c.plume;
  const calm = p.wind_speed_ms == null || p.wind_direction_deg == null || p.wind_speed_ms < 1.5;
  const downwind = ((p.wind_direction_deg ?? 0) + 180) % 360;
  const consistent: number[] = [];
  const inconsistent: number[] = [];
  const notes: string[] = [];
  for (const k of c.candidates) {
    if (k.kind === "basin_aggregate") {
      notes.push(`${k.facility_name}: basin-level report, location is representative only`);
      continue;
    }
    if (k.dist_m <= NEAR_M) {
      consistent.push(k.facility_id);
      notes.push(`${k.facility_name}: ${k.dist_m} m, at the plume origin`);
    } else if (calm) {
      notes.push(`${k.facility_name}: ${k.dist_m} m, wind too weak to judge direction`);
    } else if (angleDiff(k.bearing_from_plume_deg, downwind) <= CONE) {
      inconsistent.push(k.facility_id);
      notes.push(`${k.facility_name}: ${k.dist_m} m ${compass(k.bearing_from_plume_deg)}, downwind: the plume flows toward it, not from it`);
    } else if (k.dist_m > 1000) {
      inconsistent.push(k.facility_id);
      notes.push(`${k.facility_name}: ${k.dist_m} m ${compass(k.bearing_from_plume_deg)}, too far from the plume head to be its source`);
    } else if (angleDiff(k.bearing_from_plume_deg, p.wind_direction_deg!) <= CONE) {
      consistent.push(k.facility_id);
      notes.push(`${k.facility_name}: ${k.dist_m} m ${compass(k.bearing_from_plume_deg)}, upwind of the origin`);
    } else {
      notes.push(`${k.facility_name}: ${k.dist_m} m ${compass(k.bearing_from_plume_deg)}, crosswind, inconclusive`);
    }
  }
  const windText = calm ? "wind < 1.5 m/s" : `wind from ${compass(p.wind_direction_deg!)} (${Math.round(p.wind_direction_deg!)}°) at ${p.wind_speed_ms!.toFixed(1)} m/s, plume extends ${compass(downwind)}`;
  return { consistent, inconsistent, calm, windText, notes };
}

async function visionRead(c: PlumeCase, geo: ReturnType<typeof geometryVerdict>, attempt: number) {
  const p = c.plume;
  const pts = c.candidates.filter((k) => k.kind === "point").slice(0, 5);
  const facts = pts.map((k) => `- id ${k.facility_id}: ${k.facility_name}, ${k.dist_m} m to the ${compass(k.bearing_from_plume_deg)} (bearing ${k.bearing_from_plume_deg}°)`).join("\n");
  const prompt = `You are PlumeReader, a remote-sensing analyst. The image is a Carbon Mapper methane plume (${p.platform}, ${p.scene_timestamp}) overlaid on true-colour imagery, north up. The plume's estimated origin is the image centre region. Reported ${geo.windText}.
Candidate facilities relative to the plume origin:
${facts || "- none (no point facilities)"}
${attempt > 0 ? "A Skeptic disputed the first reading. Look again at where the plume is narrowest and most concentrated (its head) versus where it fans out (its tail).\n" : ""}Which candidate, if any, is at the plume's head? A facility lying in the direction the plume fans out is downwind and cannot be the source.
Reply ONLY with JSON: {"source_facility_id": <id or null>, "plume_heading_deg": <0-359 direction the plume extends>, "confidence": <0-1>, "reason": "<one sentence>"}`;
  const r = await chat(config.meterless.modelVision, [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageDataUrl(p.image!) } }] }], { maxTokens: 300 });
  return { ...r, json: parseJsonReply(r.text) };
}

export async function readPlume(ctx: AgentContext, c: PlumeCase, attempt = 0) {
  const p = c.plume;
  const geo = geometryVerdict(c);
  const geoPick = c.candidates.find((k) => geo.consistent.includes(k.facility_id)) ?? null;
  let mode: "vision" | "geometry" = "geometry";
  let pick: Candidate | null = geoPick;
  let confidence = geoPick ? (geoPick.dist_m <= NEAR_M ? 0.8 : 0.65) : 0.3;
  let verdict = geoPick ? `origin consistent with ${geoPick.facility_name}` : "no candidate consistent with plume origin and wind";
  let modelNote = "";

  if (!ctx.offlineModels && p.image) {
    try {
      const v = await visionRead(c, geo, attempt);
      mode = "vision";
      const vid = v.json?.source_facility_id == null ? null : Number(v.json.source_facility_id);
      const vPick = c.candidates.find((k) => k.facility_id === vid) ?? null;
      modelNote = `Nemotron (${v.model}, ${v.ms} ms${v.receipt ? `, receipt ${v.receipt}` : ""}): ${v.json?.reason ?? v.text.slice(0, 160)}`;
      c.evidence.push({ source: "meterless-nightshift", kind: "model", detail: modelNote, image: p.image });
      if (vPick?.facility_id === geoPick?.facility_id) {
        confidence = Math.min(0.95, Math.max(confidence, Number(v.json?.confidence ?? 0.7)) + 0.1);
      } else if (vPick && geo.inconsistent.includes(vPick.facility_id)) {
        // Vision named a facility the physics rules out; keep geometry, lower confidence, let the Skeptic decide.
        confidence = 0.4;
        verdict = `vision named ${vPick.facility_name}, but it lies downwind; geometry keeps ${geoPick?.facility_name ?? "none"}`;
      } else if (vPick) {
        pick = vPick;
        confidence = Number(v.json?.confidence ?? 0.6);
        verdict = `vision places the plume head at ${vPick.facility_name}`;
      } else {
        confidence = Math.min(confidence, 0.45);
        verdict = `vision found no candidate at the plume head; geometry suggests ${geoPick?.facility_name ?? "none"}`;
      }
    } catch (e) {
      ctx.tracer.log({ agent_name: "PlumeReader", action: "vision_call", plume_id: p.plume_id, status: "fallback", retry_count: attempt, input_summary: "Nemotron vision via Meterless", output_summary: `model call failed (${(e as Error).message}); using geometry only` });
    }
  }

  c.plume_reader = { verdict, consistent: geo.consistent, inconsistent: geo.inconsistent, confidence, mode, notes: [geo.windText, ...geo.notes, modelNote].filter(Boolean).join(" | ") };
  c.attributed = pick;
  c.evidence.push({ source: "carbon-mapper", kind: "image", detail: `${geo.windText}. ${geo.notes.join("; ")}`, image: p.image ?? undefined });
  const overturned = pick && c.geolinker_pick != null && pick.facility_id !== c.geolinker_pick;
  const nearest = c.candidates.find((k) => k.facility_id === c.geolinker_pick);
  ctx.tracer.log({
    agent_name: "PlumeReader", action: overturned ? "overturn_geolinker" : "read_plume", plume_id: p.plume_id, retry_count: attempt,
    status: overturned ? "needs_revision" : "ok", target_agent: overturned ? "GeoLinker" : "OwnershipResolver",
    input_summary: `${p.image ?? "no image"}; ${geo.windText}; ${c.candidates.length} candidates`,
    output_summary: overturned ? `Overturned nearest pick ${nearest?.facility_name} (${nearest?.dist_m} m): ${verdict}` : verdict,
    confidence, data: { mode, consistent: geo.consistent, inconsistent: geo.inconsistent },
  });
}
