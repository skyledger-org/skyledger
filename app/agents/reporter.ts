// Reporter: writes the draft dossier. Facts come from RunState; the model only words them.
// Guarded vocabulary: "inconsistent with available data", never accusations. A deterministic guard
// rejects accusatory wording from any model output and falls back to the template.
import { textChat } from "../adapters/llm.ts";
import { config } from "../config.ts";
import type { AgentContext } from "./context.ts";
import type { PlumeCase } from "../state.ts";

const BANNED = /\b(fraud\w*|lie[sd]?|lying|illegal\w*|criminal\w*|cheat\w*|violat\w*|cover[- ]?up|deliberate\w*|intentional\w*|scandal\w*|guilty)\b/i;

export function templateSummary(c: PlumeCase, year: number): string {
  const p = c.plume;
  const f = c.attributed;
  const parent = c.owners.map((o) => o.name).join(" / ") || "unknown owner";
  const sightings = `${p.window.detections} of ${p.window.observations} overpass dates between ${p.window.from} and ${p.window.to}`;
  switch (c.verdict) {
    case "inconsistent_with_report":
      return `Satellite observations at ${f!.facility_name} (${parent}) are inconsistent with available data: a plume averaging ${Math.round(p.emission_kgph!)} kg/h, seen on ${sightings}, implies ${c.implied_tch4![0].toLocaleString()}-${c.implied_tch4![1].toLocaleString()} t CH4/yr against ${Math.round(f!.reported_ch4_t!).toLocaleString()} t reported for RY${year} (${c.ratio![0]}-${c.ratio![1]}x). All five rival explanations were tested. Draft for analyst review.`;
    case "consistent_with_report":
      return `Observed emissions at ${f!.facility_name} (${parent}) are not inconsistent with the RY${year} report: the conservative estimate (${c.implied_tch4![0].toLocaleString()} t/yr) does not exceed the ${Math.round(f!.reported_ch4_t!).toLocaleString()} t reported.`;
    case "insufficient_sightings":
      return `A plume (${Math.round(p.emission_kgph ?? 0)} kg/h) was seen near ${f?.facility_name ?? "a facility"} on ${sightings}. Too few sightings in the reporting window to annualize; no comparison with the report is made.`;
    case "attribution_uncertain":
      return `The plume cannot be attributed to one facility with confidence (${c.rivals.find((r) => r.id === "R1")?.note}). Excluded from the parent roll-up.`;
    case "coverage_gap":
      return `Coverage gap: ${c.rivals.find((r) => r.id === "R4")?.note}. A facility-level comparison would be misleading.`;
    case "unreported_source":
      return `Possible unreported source: ${c.rivals.find((r) => r.id === "R3")?.note}. Not an under-report claim.`;
    case "dropped_quality":
      return `Dropped for data quality: ${c.rivals.find((r) => r.id === "R5")?.note}.`;
    default:
      return "";
  }
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function facts(c: PlumeCase, year: number): Record<string, string> {
  const p = c.plume, f = c.attributed!;
  return {
    facility: f.facility_name,
    parent_companies: c.owners.map((o) => o.name).join(", ") || "unknown",
    observed_rate: `${fmt(p.emission_kgph!)} kg/h (average across overpasses)`,
    sightings: `${p.window.detections} of ${p.window.observations} overpass dates, ${p.window.from} to ${p.window.to}`,
    implied_annual: `${fmt(c.implied_tch4![0])} to ${fmt(c.implied_tch4![1])} t CH4 per year`,
    reported_annual: `${fmt(f.reported_ch4_t!)} t CH4 for reporting year ${year}`,
    ratio: `${c.ratio![0]} to ${c.ratio![1]} times the reported figure`,
  };
}

/** Numbers in `text` that do not appear in `allowed` (commas ignored). The model may word facts, not invent figures. */
export function strayNumbers(text: string, allowed: string): string[] {
  const norm = (s: string) => s.replace(/,/g, "");
  const ok = new Set((allowed.match(/\d[\d,]*(\.\d+)?/g) ?? []).map(norm));
  return (text.match(/\d[\d,]*(\.\d+)?/g) ?? []).map(norm).filter((n) => !ok.has(n) && !(Number(n) <= 5 && !n.includes(".")));
}

export async function report(ctx: AgentContext, c: PlumeCase) {
  const year = ctx.state.input.year;
  const template = templateSummary(c, year);
  let text = template;
  let how = "template";
  if (!ctx.offlineModels && c.verdict === "inconsistent_with_report") {
    try {
      // Pre-formatted, unit-labelled facts: the model words them, it never computes or converts.
      const f = facts(c, year);
      const r = await textChat("reporter", [
        { role: "system", content: "You write a two-sentence draft finding for an ESG credit analyst. Copy every number exactly as written in the facts, with its unit; do not compute, convert or round anything. Say 'inconsistent with available data'; never allege fraud, intent or violations. Give the annual figures as ranges." },
        { role: "user", content: Object.entries(f).map(([k, v]) => `${k}: ${v}`).join("\n") },
      ], { maxTokens: 220 });
      const stray = strayNumbers(r.text, Object.values(f).join(" "));
      if (BANNED.test(r.text)) {
        ctx.tracer.log({ agent_name: "Reporter", action: "guard_block", plume_id: c.plume.plume_id, status: "blocked", input_summary: "model draft", output_summary: "accusatory wording detected; using guarded template" });
      } else if (stray.length) {
        ctx.tracer.log({ agent_name: "Reporter", action: "number_guard_block", plume_id: c.plume.plume_id, status: "blocked", input_summary: "model draft", output_summary: `numbers not in the computed facts (${stray.slice(0, 5).join(", ")}); using guarded template`, data: { draft: r.text.slice(0, 400) } });
      } else if (r.text.trim()) {
        text = r.text.trim();
        how = `${r.requested_model} via ${r.route}${r.model !== r.requested_model ? ` (echo ${r.model})` : ""}${r.receipt ? ` (receipt ${r.receipt})` : ""}`;
      }
    } catch (e) {
      ctx.tracer.log({ agent_name: "Reporter", action: "model_call", plume_id: c.plume.plume_id, status: "fallback", input_summary: "Nemotron via Meterless", output_summary: `failed (${(e as Error).message}); template used` });
    }
  }
  c.summary = text;
  ctx.tracer.log({ agent_name: "Reporter", action: "write_dossier", plume_id: c.plume.plume_id, status: "ok", target_agent: "SignOff", input_summary: `verdict ${c.verdict}`, output_summary: text.slice(0, 240), data: { writer: how } });
}
