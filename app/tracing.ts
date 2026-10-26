// Hash-chained JSONL trace: one file per run at logs/trace-<run_id>.jsonl, also echoed to stdout.
// Each line carries prev_hash and hash = sha256(prev_hash + canonical line), so any edit breaks the chain.
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { LOG_DIR } from "./config.ts";

export type TraceStatus = "ok" | "needs_revision" | "blocked" | "escalated" | "retry" | "fallback" | "error";

export interface TraceEvent {
  agent_name: string;
  action: string;
  input_summary: string;
  output_summary: string;
  target_agent?: string | null;
  confidence?: number | null;
  retry_count?: number;
  status: TraceStatus;
  plume_id?: string;
  data?: unknown;
}

export interface TraceLine extends TraceEvent {
  timestamp: string;
  run_id: string;
  trace_id: string;
  seq: number;
  prev_hash: string;
  hash: string;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export class Tracer {
  readonly file: string;
  readonly lines: TraceLine[] = [];
  private prev = "0".repeat(64);

  constructor(readonly runId: string, private echo = true) {
    mkdirSync(LOG_DIR, { recursive: true });
    this.file = join(LOG_DIR, `trace-${runId}.jsonl`);
  }

  log(e: TraceEvent): TraceLine {
    const body = {
      timestamp: new Date().toISOString(),
      run_id: this.runId,
      trace_id: `trace-${this.runId}`,
      seq: this.lines.length,
      agent_name: e.agent_name,
      action: e.action,
      input_summary: e.input_summary,
      output_summary: e.output_summary,
      target_agent: e.target_agent ?? null,
      confidence: e.confidence ?? null,
      retry_count: e.retry_count ?? 0,
      status: e.status,
      plume_id: e.plume_id,
      data: e.data,
      prev_hash: this.prev,
    };
    const hash = sha(this.prev + JSON.stringify(body));
    const line: TraceLine = { ...body, hash };
    this.prev = hash;
    this.lines.push(line);
    const text = JSON.stringify(line);
    appendFileSync(this.file, text + "\n");
    if (this.echo) process.stdout.write(text + "\n");
    return line;
  }

  get headHash() {
    return this.prev;
  }
}

/** Re-computes the chain of a saved trace; returns the first broken seq or -1. */
export function verifyTrace(file: string): { ok: boolean; lines: number; brokenAt: number } {
  if (!existsSync(file)) return { ok: false, lines: 0, brokenAt: 0 };
  const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  let prev = "0".repeat(64);
  for (let i = 0; i < rows.length; i++) {
    const { hash, ...body } = rows[i];
    if (body.prev_hash !== prev || sha(prev + JSON.stringify(body)) !== hash) return { ok: false, lines: rows.length, brokenAt: i };
    prev = hash;
  }
  return { ok: true, lines: rows.length, brokenAt: -1 };
}
