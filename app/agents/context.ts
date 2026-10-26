import type { Tracer } from "../tracing.ts";
import type { OwnershipGraph } from "../engines/world_model.ts";
import type { RunState } from "../state.ts";

export interface AgentContext {
  state: RunState;
  tracer: Tracer;
  graph: OwnershipGraph;
  /** true when model calls must use the deterministic fallback (SAMPLE_MODE or Nightshift offline) */
  offlineModels: boolean;
  /** true when SQL must be answered from the cached files */
  offlineSql: boolean;
}

export const AGENTS = [
  { name: "SourceMapper", role: "Checks which sources are reachable (Zetaris or the cached sample) and their coverage" },
  { name: "GeoLinker", role: "Federated geo-join: plume to GHGRP facilities within a radius, with reported CH4" },
  { name: "PlumeReader", role: "Reads the plume image and wind; can overturn GeoLinker's nearest-facility pick" },
  { name: "OwnershipResolver", role: "Resolves messy owner strings to parent companies on the Meterless World Model" },
  { name: "Reconciler", role: "Converts kg/h and CO2e into comparable annual tonnes; always a range" },
  { name: "Skeptic", role: "Must rule out 5 rival explanations; can block the Reporter or send work back" },
  { name: "Reporter", role: "Writes the draft dossier in guarded language" },
  { name: "SignOff", role: "Nothing is shareable until an analyst signs an execution contract" },
];
