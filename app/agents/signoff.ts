// SignOff gate: dossiers stay "draft" until an analyst approves. Approval issues an execution contract
// in the shape of Meterless Scout Intent's ExecutionContract (vendor/scout-intent/docs/execution-contract.md):
// signature = HMAC_SHA256(secret, canonical_json(contract_without_signature)).
import { createHmac, createHash, randomBytes } from "node:crypto";
import { canonicalJson } from "../../vendor/world-model/reference/src/index.ts";
import { config } from "../config.ts";
import type { PlumeCase } from "../state.ts";

export function issueContract(runId: string, traceHead: string, c: PlumeCase, analyst: string) {
  const now = new Date();
  const dossierHash = createHash("sha256").update(canonicalJson({ ...c, contract: undefined, status: undefined })).digest("hex");
  const contract = {
    contractId: `ctr_${now.getTime().toString(36)}${randomBytes(4).toString("hex")}`,
    traceId: `trace-${runId}`,
    intent: { primary: "share_dossier", parameters: { plume_id: c.plume.plume_id, facility_id: c.attributed?.facility_id ?? null, verdict: c.verdict }, references: { dossier_sha256: dossierHash, trace_head: traceHead }, confidence: 1, alternates: [] },
    risk: { level: c.verdict === "inconsistent_with_report" ? "high" : "medium", flags: ["names-a-company"], redactions: [], approvals: [{ kind: "operator-review", by: analyst, at: now.toISOString() }] },
    toolPlan: [{ tool: "export_dossier", args: { format: "json" } }],
    modelProfile: { id: "none" },
    scope: { user: analyst, surface: "skyledger-ui", capabilities: ["export_dossier"] },
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    registryVersion: 1,
    policyPackVersion: "skyledger-guarded-language-1",
    signedBy: "scout" as const,
  };
  const signature = createHmac("sha256", config.signingKey).update(canonicalJson(contract)).digest("hex");
  return { ...contract, signature };
}

export function verifyContract(contract: Record<string, unknown>): boolean {
  const { signature, ...rest } = contract;
  return createHmac("sha256", config.signingKey).update(canonicalJson(rest)).digest("hex") === signature;
}
