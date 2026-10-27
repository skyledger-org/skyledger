// Meterless Nightshift provider, implemented to the "Add Meterless as a provider" contract:
// - provider id "meterless", base URL normalised to <host>/v1 (never /v1/v1)
// - Authorization: Bearer <runtime token>; the placeholder "rt-local" is rejected
// - meterless-app header on every request, meterless-scope: user on chat
// - discovery via GET /v1/models (401/403 unauthorized, 200 online, else offline); /healthz is not proof
// - OpenAI-compatible POST /v1/chat/completions with a 180 s timeout
// - Auto Detect probes 8088, 8090, 8787, 11434 on 127.0.0.1, localhost and [::1]
// The token is never logged.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config, DATA_DIR } from "../config.ts";

export type ProviderStatus = "online" | "unauthorized" | "offline";

export function normalizeBaseUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  // Accept whatever was pasted: .../v1, .../v1/chat/completions, .../v1/models, .../healthz
  u = u.replace(/\/(chat\/completions|models|healthz)$/, "").replace(/(\/v1)+$/, "");
  if (!/^https?:\/\//.test(u)) u = `http://${u}`;
  return `${u}/v1`;
}

function assertToken(token: string) {
  if (!token || token === "rt-local") throw new Error("Meterless: a real runtime token is required (placeholder rt-local rejected)");
}

const headers = (token: string, chat: boolean): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "meterless-app": config.meterless.app,
  ...(chat ? { "meterless-scope": "user" } : {}),
});

export async function discover(baseUrl = config.meterless.baseUrl, token = config.meterless.token): Promise<{ status: ProviderStatus; models: string[] }> {
  try {
    assertToken(token);
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, { headers: headers(token, false), signal: AbortSignal.timeout(5000) });
    if (res.status === 401 || res.status === 403) return { status: "unauthorized", models: [] };
    if (res.status !== 200) return { status: "offline", models: [] };
    const body: any = await res.json();
    const models = (body?.data ?? []).map((m: any) => m.id as string);
    // Unknown meterless/* ids are kept, not filtered; a 200 without any meterless id is not the runtime.
    return { status: models.some((m: string) => m.startsWith("meterless/")) ? "online" : "offline", models };
  } catch {
    return { status: "offline", models: [] };
  }
}

/** Discovery on the configured URL, falling back to Auto Detect; the first online or unauthorized hit is kept. */
export async function connect(): Promise<{ status: ProviderStatus; models: string[]; baseUrl: string }> {
  const first = await discover();
  if (first.status !== "offline") return { ...first, baseUrl: normalizeBaseUrl(config.meterless.baseUrl) };
  const found = await autoDetect();
  if (!found) return { ...first, baseUrl: normalizeBaseUrl(config.meterless.baseUrl) };
  config.meterless.baseUrl = found;
  return { ...(await discover(found)), baseUrl: found };
}

export async function autoDetect(token = config.meterless.token): Promise<string | null> {
  for (const host of ["127.0.0.1", "localhost", "[::1]"])
    for (const port of [8088, 8090, 8787, 11434]) {
      const url = `http://${host}:${port}/v1`;
      const r = await discover(url, token);
      if (r.status !== "offline") return url;
    }
  return null;
}

export interface ChatResult {
  text: string;
  model: string;
  ms: number;
  receipt: string | null;
}

type Content = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

export async function chat(model: string, messages: { role: "system" | "user" | "assistant"; content: Content }[], opts: { maxTokens?: number; temperature?: number; thinking?: boolean } = {}): Promise<ChatResult> {
  const token = config.meterless.token;
  assertToken(token);
  const t0 = Date.now();
  const res = await fetch(`${normalizeBaseUrl(config.meterless.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: headers(token, true),
    // Nemotron rows think before answering; with a small max_tokens the answer never arrives.
    // reasoning_effort "none" is Nightshift's documented switch to turn thinking off for a request.
    body: JSON.stringify({ model, messages, max_tokens: opts.maxTokens ?? 600, temperature: opts.temperature ?? 0.1, ...(opts.thinking ? {} : { reasoning_effort: "none" }) }),
    signal: AbortSignal.timeout(config.meterless.timeoutMs),
  });
  if (res.status === 401 || res.status === 403) throw new Error("Meterless: unauthorized (check METERLESS_RUNTIME_TOKEN)");
  if (!res.ok) throw new Error(`Meterless ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body: any = await res.json();
  return {
    text: body?.choices?.[0]?.message?.content ?? "",
    model: body?.model ?? model,
    ms: Date.now() - t0,
    receipt: res.headers.get("meterless-receipt") ?? res.headers.get("x-request-id") ?? body?.id ?? null,
  };
}

/** True when Nightshift refused a request only because it carries an image (see config.nvidia). */
export const isVisionRefusal = (e: unknown) => /no_vision_model|no configured vision-capable model/i.test(String((e as Error)?.message ?? e));

/**
 * Direct NVIDIA API call, used ONLY for the image step when Nightshift refuses it (isVisionRefusal).
 * Same OpenAI shape; thinking is switched off through chat_template_kwargs as NVIDIA documents for Nemotron.
 */
export async function nvidiaDirectChat(messages: { role: "system" | "user" | "assistant"; content: Content }[], opts: { maxTokens?: number; model?: string; temperature?: number } = {}): Promise<ChatResult> {
  const model = opts.model ?? config.nvidia.visionModel;
  if (!config.nvidia.apiKey.startsWith("nvapi-")) throw new Error("NVIDIA direct: NVIDIA_API_KEY is not set");
  const t0 = Date.now();
  const res = await fetch(`${config.nvidia.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.nvidia.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: opts.maxTokens ?? 400, temperature: opts.temperature ?? 0.6, top_p: 0.95, chat_template_kwargs: { enable_thinking: false } }),
    signal: AbortSignal.timeout(config.nvidia.timeoutMs),
  });
  if (!res.ok) throw new Error(`NVIDIA ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body: any = await res.json();
  return { text: body?.choices?.[0]?.message?.content ?? "", model: body?.model ?? model, ms: Date.now() - t0, receipt: body?.id ?? null };
}

export function imageDataUrl(relPath: string): string {
  return `data:image/png;base64,${readFileSync(join(DATA_DIR, relPath)).toString("base64")}`;
}

/** Extracts the first JSON object from a model reply. */
export function parseJsonReply(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
