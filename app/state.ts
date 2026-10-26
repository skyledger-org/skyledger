// The shared RunState every agent reads and writes. One object per run; logged on every transition.

export interface Plume {
  plume_id: string;
  source_name: string;
  lat: number; // Carbon Mapper source (clustered origin) location
  lon: number;
  plume_lat?: number; // this plume record's own origin, used to place the image marker
  plume_lon?: number;
  scene_timestamp: string;
  platform: string;
  sector: string;
  wind_speed_ms: number | null;
  wind_direction_deg: number | null; // meteorological: direction the wind blows FROM
  plume_bounds: number[] | null;
  image: string | null;
  // Source-level (all overpasses) statistics from Carbon Mapper
  emission_kgph: number | null;
  emission_uncertainty_kgph: number | null;
  detection_date_count: number;
  observation_date_count: number;
  persistence: number;
  detection_dates: string[];
  observation_dates: string[];
  // Restricted to the reporting-year window (RY +/- 6 months), so plumes and reports cover the same period
  window: { from: string; to: string; detections: number; observations: number };
}

export type FacilityKind = "point" | "basin_aggregate";

export interface Candidate {
  facility_id: number;
  facility_name: string;
  latitude: number;
  longitude: number;
  parent_company: string | null;
  naics_code: string;
  reported_subparts: string;
  reported_industry_types: string;
  kind: FacilityKind;
  sector_compatible: boolean;
  dist_m: number;
  bearing_from_plume_deg: number;
  reported_ch4_t: number | null; // tonnes CH4, all subparts, converted from CO2e
}

export interface Evidence {
  source: string;
  kind: "sql" | "image" | "computation" | "entity" | "model";
  detail: string;
  sql?: string;
  rows_hash?: string;
  image?: string;
}

export type RivalStatus = "ruled_out" | "flagged" | "failed" | "pending";

export interface Rival {
  id: "R1" | "R2" | "R3" | "R4" | "R5";
  name: string;
  status: RivalStatus;
  note: string;
}

export interface Owner {
  raw: string;
  name: string;
  pct: number | null;
  entity_id: string;
  cik: string | null;
  confidence: number;
  merged_from: string[];
  review: boolean;
}

export type Verdict =
  | "inconsistent_with_report" // implied lower bound exceeds the reported total
  | "consistent_with_report"
  | "insufficient_sightings" // fewer than 2 detections in the reporting window: no annualization
  | "attribution_uncertain"
  | "coverage_gap"
  | "unreported_source"
  | "dropped_quality";

export interface PlumeCase {
  plume: Plume;
  radius_m: number;
  candidates: Candidate[];
  attributed: Candidate | null;
  geolinker_pick: number | null;
  plume_reader: { verdict: string; consistent: number[]; inconsistent: number[]; confidence: number; mode: "vision" | "geometry"; notes: string } | null;
  owners: Owner[];
  implied_tch4: [number, number] | null;
  ratio: [number, number] | null;
  rivals: Rival[];
  verdict: Verdict | null;
  summary: string;
  evidence: Evidence[];
  revisions: { agent: string; reason: string }[];
  status: "draft" | "shareable";
  contract?: { id: string; signed_by: string; signed_at: string; signature: string };
}

export interface RunInput {
  question?: string;
  region?: string;
  year?: number;
  max_plumes?: number;
  plume_ids?: string[];
}

export interface RunState {
  run_id: string;
  input: Required<Pick<RunInput, "region" | "year" | "max_plumes">> & RunInput;
  sample_mode: boolean;
  sources: { name: string; via: string; rows: number; ok: boolean }[];
  cases: PlumeCase[];
  review_queue: { kind: string; detail: string }[];
  started_at: number;
}
