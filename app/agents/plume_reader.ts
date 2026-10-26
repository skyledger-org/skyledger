// PlumeReader: judges which candidate the plume points back to.
// Physics first: Carbon Mapper's plume coordinate is the estimated origin, and the plume extends DOWNWIND.
// A facility lying downwind of the origin is in the plume's path, not at its head, so it can't be the source.
// Live mode adds Nemotron vision (via Meterless Nightshift) on the plume image; the geometry stays as a check.
import { chat, imageDataUrl, parseJsonReply, isVisionRefusal, nvidiaDirectChat } from "../adapters/meterless.ts";
import { config, hasNvidiaDirect } from "../config.ts";
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

// The model reads the plume's direction from the IMAGE ALONE: no wind, no candidate list, so it can't
// echo what we told it. The code then compares its heading with the wind; agreement is independent corroboration.
async function visionRead(c: PlumeCase, attempt: number) {
  const p = c.plume;
  const prompt = `You are PlumeReader, a remote-sensing analyst. The image is a Carbon Mapper methane plume (${p.platform}, ${p.scene_timestamp.slice(0, 10)}): the coloured overlay is methane concentration on true-colour imagery, north up.
A plume is narrow and most concentrated at its head (the source) and widens and fades downwind (its tail).
${attempt > 0 ? "A Skeptic disputed your first reading. Look again carefully at where the overlay is narrowest and brightest versus where it fans out.\n" : ""}In which compass direction does the plume extend from its head toward its tail?
Reply ONLY with JSON: {"plume_heading_deg": <0-359, 0 = north, 90 = east>, "confidence": <0-1>, "reason": "<one sentence on what in the image shows it>"}`;
  const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }, { type: "image_url" as const, image_url: { url: imageDataUrl(p.image!) } }] }];
  // Nightshift first. 1.2.7 refuses image requests to Nemotron VL rows; only then go to NVIDIA directly,
  // with the same model family, and say so in the evidence.
  try {
    const r = await chat(config.meterless.modelVision, messages, { maxTokens: 300 });
    return { ...r, json: parseJsonReply(r.text), route: "meterless-nightshift" as const, refusal: null as string | null };
  } catch (e) {
    if (!isVisionRefusal(e) || !hasNvidiaDirect()) throw e;
    const r = await nvidiaDirectChat(messages, { maxTokens: 300 });
    return { ...r, json: parseJsonReply(r.text), route: "nvidia-direct" as const, refusal: (e as Error).message.slice(0, 160) };
  }
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
      const v = await visionRead(c, attempt);
      mode = "vision";
      const heading = Number(v.json?.plume_heading_deg);
      const vConf = Math.max(0, Math.min(1, Number(v.json?.confidence ?? 0.5)));
      const via = v.route === "nvidia-direct" ? "NVIDIA API direct (Nightshift refused the image)" : "Meterless Nightshift";
      const echo = v.model && v.model !== config.nvidia.visionModel && v.route === "nvidia-direct" ? `, provider echoed ${v.model}` : "";
      if (!Number.isFinite(heading)) {
        modelNote = `Nemotron vision via ${via}: no usable heading in the reply`;
      } else if (p.wind_direction_deg == null || (p.wind_speed_ms ?? 0) < 1.5) {
        modelNote = `Nemotron vision via ${via} reads the plume heading ${Math.round(heading)}° (${compass(heading)}); wind too weak to compare`;
      } else {
        const downwind = (p.wind_direction_deg + 180) % 360;
        const off = Math.round(angleDiff(heading, downwind));
        const agrees = off <= CONE;
        modelNote = `Nemotron vision via ${via} reads the plume heading ${Math.round(heading)}° (${compass(heading)}) from the image alone; the wind says ${Math.round(downwind)}° (${compass(downwind)}): ${agrees ? "agrees" : "disagrees"} (${off}° apart, model confidence ${vConf.toFixed(2)})`;
        if (agrees) {
          confidence = Math.min(0.95, confidence + 0.1 * vConf + 0.05);
          verdict += `; Nemotron vision independently confirms the plume runs ${compass(heading)}`;
        } else {
          // Image and wind disagree: the geometry rests on a wind estimate the picture contradicts.
          confidence = Math.min(confidence, 0.45);
          verdict += `; Nemotron vision reads the plume running ${compass(heading)}, against the wind's ${compass(downwind)}`;
        }
      }
      modelNote += ` [${config.nvidia.visionModel}, ${v.ms} ms${v.receipt ? `, receipt ${v.receipt}` : ""}${echo}]: ${String(v.json?.reason ?? v.text).slice(0, 160)}`;
      if (v.refusal) ctx.tracer.log({ agent_name: "PlumeReader", action: "vision_route", plume_id: p.plume_id, status: "fallback", retry_count: attempt, input_summary: `Nightshift ${config.meterless.modelVision}`, output_summary: `Nightshift refused the image (${v.refusal}); same Nemotron VL called on NVIDIA directly` });
      c.evidence.push({ source: v.route, kind: "model", detail: modelNote, image: p.image ?? undefined });
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
