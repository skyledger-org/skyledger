// Reconciler: numbers come from code, never from the LLM.
// implied t CH4/yr = rate_kg/h x 8.76 x persistence, as a range:
//   low  = (rate - 1 sigma) x 8.76 x observed persistence (detections / overpasses)
//   high = (rate + 1 sigma) x 8.76 x 1.0 (if continuous)
// reported t CH4 = GHGRP CO2e / GWP for the reporting year.
import { config } from "../config.ts";
import type { AgentContext } from "./context.ts";
import type { PlumeCase } from "../state.ts";

const KGPH_TO_TPY = 8.76;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function reconcile(ctx: AgentContext, c: PlumeCase, mode: "annualize" | "no_annualization" = "annualize") {
  const p = c.plume;
  const f = c.attributed;
  const rate = p.emission_kgph;
  if (rate == null || !f) {
    c.implied_tch4 = null;
    c.ratio = null;
    return;
  }
  const sigma = p.emission_uncertainty_kgph ?? rate * 0.3;
  const w = p.window;
  const persistence = w.observations > 0 ? w.detections / w.observations : 0;
  if (mode === "no_annualization") {
    c.implied_tch4 = null;
    c.ratio = null;
    ctx.tracer.log({
      agent_name: "Reconciler", action: "recompute_no_annualization", plume_id: p.plume_id, status: "ok", target_agent: "Skeptic",
      input_summary: `Skeptic blocked annualization (${w.detections}/${w.observations} overpass dates in ${w.from}..${w.to})`,
      output_summary: `Reporting instantaneous rate only: ${Math.round(rate)} ± ${Math.round(sigma)} kg/h; no annual ratio`,
    });
    return;
  }
  const low = Math.max(0, rate - sigma) * KGPH_TO_TPY * persistence;
  const high = (rate + sigma) * KGPH_TO_TPY;
  c.implied_tch4 = [Math.round(low), Math.round(high)];
  const rep = f.reported_ch4_t;
  c.ratio = rep && rep > 0 ? [r2(low / rep), r2(high / rep)] : null;
  c.evidence.push({
    source: "computation", kind: "computation",
    detail: `${Math.round(rate)} ± ${Math.round(sigma)} kg/h x 8.76 x persistence ${w.detections}/${w.observations} overpass dates in ${w.from}..${w.to} (low) to 1.0 (high) = ${c.implied_tch4[0]}-${c.implied_tch4[1]} t CH4/yr; reported ${rep == null ? "n/a" : Math.round(rep)} t CH4 (RY${ctx.state.input.year}, CO2e / GWP ${config.ch4Gwp})`,
  });
  ctx.tracer.log({
    agent_name: "Reconciler", action: "reconcile_units", plume_id: p.plume_id, status: "ok", target_agent: "Skeptic",
    input_summary: `${Math.round(rate)} kg/h, persistence ${w.detections}/${w.observations} in reporting window, reported ${rep == null ? "none" : Math.round(rep) + " t CH4"}`,
    output_summary: `implied ${c.implied_tch4[0]}-${c.implied_tch4[1]} t/yr${c.ratio ? `, ratio ${c.ratio[0]}-${c.ratio[1]}x` : ", no reported total to compare"}`,
  });
}
