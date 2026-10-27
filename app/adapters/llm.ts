// One entry point for every model call, routed by AI_PROVIDER (config/skyledger.json "providers"):
//   nightshift  Meterless Nightshift (the default). Images: Nightshift first, NVIDIA direct only when
//               Nightshift 1.2.7 refuses them (docs/METERLESS_VISION_ISSUE.md), and only if NVIDIA_API_KEY is set.
//   nvidia      NVIDIA's API directly (e.g. a hosted deployment with no Nightshift on the machine).
//   none        no model calls; agents use their deterministic paths.
import { config, hasNvidiaDirect } from "../config.ts";
import { chat, nvidiaDirectChat, isVisionRefusal, type ChatResult } from "./meterless.ts";

type Msg = Parameters<typeof chat>[1][number];
export type Route = "meterless-nightshift" | "nvidia-direct";
export interface RoutedResult extends ChatResult { route: Route; requested_model: string; refusal: string | null }

export async function textChat(role: "reporter" | "general", messages: Msg[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<RoutedResult> {
  if (config.provider === "nvidia") {
    const model = config.nvidia.textModel;
    const r = await nvidiaDirectChat(messages, { ...opts, model, temperature: opts.temperature ?? 0.2 });
    return { ...r, route: "nvidia-direct", requested_model: model, refusal: null };
  }
  if (config.provider === "none") throw new Error("AI_PROVIDER=none: no model calls");
  const model = role === "reporter" ? config.meterless.modelReasoning : config.meterless.modelText;
  const r = await chat(model, messages, opts);
  return { ...r, route: "meterless-nightshift", requested_model: model, refusal: null };
}

export async function visionChat(messages: Msg[], opts: { maxTokens?: number } = {}): Promise<RoutedResult> {
  if (config.provider === "nvidia") {
    const r = await nvidiaDirectChat(messages, { ...opts, model: config.nvidia.visionModel });
    return { ...r, route: "nvidia-direct", requested_model: config.nvidia.visionModel, refusal: null };
  }
  if (config.provider === "none") throw new Error("AI_PROVIDER=none: no model calls");
  try {
    const r = await chat(config.meterless.modelVision, messages, opts);
    return { ...r, route: "meterless-nightshift", requested_model: config.meterless.modelVision, refusal: null };
  } catch (e) {
    if (!isVisionRefusal(e) || !hasNvidiaDirect()) throw e;
    const r = await nvidiaDirectChat(messages, { ...opts, model: config.nvidia.visionModel });
    return { ...r, route: "nvidia-direct", requested_model: config.nvidia.visionModel, refusal: (e as Error).message.slice(0, 160) };
  }
}
