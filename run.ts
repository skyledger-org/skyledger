// SkyLedger entry point.
//   npx tsx run.ts                          HTTP server on 0.0.0.0:$PORT (POST /run, UI at /)
//   npx tsx run.ts --once [input.json]      one run from the CLI, JSON result on stdout's last line
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { config, DATA_DIR, LOG_DIR, ROOT } from "./app/config.ts";
import { run } from "./app/orchestrator.ts";
import { issueContract, verifyContract } from "./app/agents/signoff.ts";
import { verifyTrace, Tracer } from "./app/tracing.ts";

const LABELS_FILE = join(ROOT, "eval", "labels.csv");
function readLabels(): Record<string, { label: string; labeled_at: string }> {
  if (!existsSync(LABELS_FILE)) return {};
  const out: Record<string, { label: string; labeled_at: string }> = {};
  for (const line of readFileSync(LABELS_FILE, "utf8").trim().split(/\r?\n/).slice(1)) {
    const [plume_id, label, labeled_at] = line.split(",");
    if (plume_id) out[plume_id] = { label, labeled_at };
  }
  return out;
}

const newRunId = () => `run-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${randomBytes(2).toString("hex")}`;
const safeId = (s: string) => /^[A-Za-z0-9_.-]{1,80}$/.test(s);

function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : (body as string | Buffer));
}
const err = (res: ServerResponse, status: number, code: string, message: string) => send(res, status, { status: "error", error: { code, message } });

async function readBody(req: IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serveFile(res: ServerResponse, base: string, rel: string) {
  const p = normalize(join(base, rel));
  if (!p.startsWith(normalize(base)) || !existsSync(p)) return err(res, 404, "not_found", rel);
  send(res, 200, readFileSync(p), MIME[extname(p)] ?? "application/octet-stream");
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  try {
    if (req.method === "GET" && (path === "/" || path === "/index.html")) return serveFile(res, join(ROOT, "web"), "index.html");
    if (req.method === "GET" && path === "/health") return send(res, 200, { status: "ok", sample_mode: config.sampleMode });
    if (req.method === "GET" && path.startsWith("/images/")) return serveFile(res, join(DATA_DIR, "images"), path.slice(8));

    if (req.method === "POST" && path === "/run") {
      const body = await readBody(req);
      const runId = body.run_id && safeId(body.run_id) ? body.run_id : newRunId();
      if (existsSync(join(LOG_DIR, `trace-${runId}.jsonl`))) return err(res, 409, "run_exists", `run_id ${runId} already used`);
      const result = await run(runId, body.input ?? {}, { sample_mode: body.options?.sample_mode, echo: true });
      return send(res, 200, result);
    }

    if (req.method === "GET" && path === "/api/runs") {
      const runs = existsSync(LOG_DIR) ? readdirSync(LOG_DIR).filter((f) => f.startsWith("run-") && f.endsWith(".json")).sort().reverse() : [];
      return send(res, 200, runs.map((f) => f.slice(4, -5)));
    }
    const m = path.match(/^\/api\/runs\/([A-Za-z0-9_.-]+)(\/trace|\/verify)?$/);
    if (req.method === "GET" && m) {
      const id = m[1];
      if (m[2] === "/trace") return serveFile(res, LOG_DIR, `trace-${id}.jsonl`);
      if (m[2] === "/verify") return send(res, 200, verifyTrace(join(LOG_DIR, `trace-${id}.jsonl`)));
      return serveFile(res, LOG_DIR, `run-${id}.json`);
    }

    if (path === "/api/labels") {
      const labels = readLabels();
      if (req.method === "GET") return send(res, 200, labels);
      if (req.method === "POST") {
        const { plume_id, label } = await readBody(req);
        if (!safeId(plume_id ?? "") || !/^(\d{1,10}|none|ambiguous)$/.test(String(label))) return err(res, 400, "bad_request", "plume_id and label (facility id | none | ambiguous) required");
        labels[plume_id] = { label: String(label), labeled_at: new Date().toISOString() };
        mkdirSync(join(ROOT, "eval"), { recursive: true });
        writeFileSync(LABELS_FILE, "plume_id,label,labeled_at\n" + Object.entries(labels).map(([k, v]) => `${k},${v.label},${v.labeled_at}`).join("\n") + "\n");
        return send(res, 200, { ok: true, count: Object.keys(labels).length });
      }
    }

    if (req.method === "POST" && path === "/api/signoff") {
      const { run_id, plume_id, analyst } = await readBody(req);
      if (!safeId(run_id ?? "") || !analyst || typeof analyst !== "string") return err(res, 400, "bad_request", "run_id and analyst are required");
      const file = join(LOG_DIR, `run-${run_id}.json`);
      if (!existsSync(file)) return err(res, 404, "not_found", run_id);
      const result = JSON.parse(readFileSync(file, "utf8"));
      const c = result.output.dossiers.find((d: any) => d.plume.plume_id === plume_id);
      if (!c) return err(res, 404, "not_found", plume_id);
      if (c.status === "shareable") return send(res, 200, c.contract);
      const contract = issueContract(run_id, result.trace_head, c, analyst.slice(0, 80));
      c.status = "shareable";
      c.contract = contract;
      writeFileSync(file, JSON.stringify(result, null, 1));
      // Sign-off is part of the audit trail: append to the run's chained trace.
      const tr = new Tracer(`${run_id}-signoff`, false);
      tr.log({ agent_name: "SignOff", action: "issue_contract", plume_id, status: "ok", input_summary: `analyst ${analyst}`, output_summary: `contract ${contract.contractId} (verified: ${verifyContract(contract)})`, data: contract });
      return send(res, 200, contract);
    }
    return err(res, 404, "not_found", path);
  } catch (e) {
    return err(res, 500, "internal_error", (e as Error).message);
  }
}

if (process.argv.includes("--once")) {
  const file = process.argv[process.argv.indexOf("--once") + 1];
  const body = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const runId = body.run_id && safeId(body.run_id) && !existsSync(join(LOG_DIR, `trace-${body.run_id}.jsonl`)) ? body.run_id : newRunId();
  const result = await run(runId, body.input ?? {}, { sample_mode: body.options?.sample_mode, echo: !process.argv.includes("--quiet") });
  process.stdout.write(JSON.stringify(result) + "\n");
} else {
  createServer((req, res) => void handle(req, res)).listen(config.port, "0.0.0.0", () => {
    console.log(`SkyLedger on http://0.0.0.0:${config.port} (SAMPLE_MODE=${config.sampleMode})`);
  });
}
