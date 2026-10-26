// Re-computes the hash chain of a saved trace. Usage: npm run verify -- logs/trace-<run_id>.jsonl
import { verifyTrace } from "../app/tracing.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: npm run verify -- logs/trace-<run_id>.jsonl");
  process.exit(2);
}
const r = verifyTrace(file);
console.log(r.ok ? `OK: ${r.lines} lines, hash chain intact` : `BROKEN at line ${r.brokenAt} of ${r.lines}`);
process.exit(r.ok ? 0 : 1);
