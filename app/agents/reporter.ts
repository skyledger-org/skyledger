// Reporter: writes the draft dossier. Facts come from RunState; the model only words them.
// Guarded vocabulary: "inconsistent with available data", never accusations. A deterministic guard
// rejects accusatory wording from any model output and falls back to the template.
import { chat } from "../adapters/meterless.ts";
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

export async function report(ctx: AgentContext, c: PlumeCase) {
  const year = ctx.state.input.year;
  const template = templateSummary(c, year);
  let text = template;
  let how = "template";
  if (!ctx.offlineModels && c.verdict === "inconsistent_with_report") {
    try {
      const facts = { facility: c.attributed?.facility_name, parents: c.owners.map((o) => o.name), rate_kgph: c.plume.emission_kgph, sightings_in_reporting_window: `${c.plume.window.detections}/${c.plume.window.observations}`, implied_tch4_range: c.implied_tch4, reported_tch4: c.attributed?.reported_ch4_t, ratio_range: c.ratio, rivals: c.rivals.map((r) => `${r.id} ${r.status}: ${r.note}`) };
      const r = await chat(config.meterless.modelReasoning, [
        { role: "system", content: "You write two-sentence draft findings for an ESG credit analyst. Use only the numbers given. Say 'inconsistent with available data'; never allege fraud, intent or violations. Always give ranges, never a single number." },
        { role: "user", content: JSON.stringify(facts) },
      ], { maxTokens: 220 });
      if (BANNED.test(r.text)) {
        ctx.tracer.log({ agent_name: "Reporter", action: "guard_block", plume_id: c.plume.plume_id, status: "blocked", input_summary: "model draft", output_summary: "accusatory wording detected; using guarded template" });
      } else if (r.text.trim()) {
        text = r.text.trim();
        how = `${r.model}${r.receipt ? ` (receipt ${r.receipt})` : ""}`;
      }
    } catch (e) {
      ctx.tracer.log({ agent_name: "Reporter", action: "model_call", plume_id: c.plume.plume_id, status: "fallback", input_summary: "Nemotron via Meterless", output_summary: `failed (${(e as Error).message}); template used` });
    }
  }
  c.summary = text;
  ctx.tracer.log({ agent_name: "Reporter", action: "write_dossier", plume_id: c.plume.plume_id, status: "ok", target_agent: "SignOff", input_summary: `verdict ${c.verdict}`, output_summary: text.slice(0, 240), data: { writer: how } });
}
