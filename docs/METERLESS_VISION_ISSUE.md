# Nightshift 1.2.7: image requests to a named Nemotron VL model are refused

Reported in the Help Meterless channel on 2026-10-26. SkyLedger's workaround is described at the end.

## Message as posted

> **Nightshift 1.2.7 (Windows): image requests to a pinned Nemotron VL lane fail with `no_vision_model`, while text works**
>
> **Setup:** Windows 11, Nightshift 1.2.7 (installer sha256 `f30cfc10…f03d3a`), RTX 4050 6 GB. Cloud lanes: NVIDIA (Nemotron 3 Ultra 550B, Nemotron 3.5 Lightning 30B, both "nvidia accepted the key") and OpenRouter (Nemotron 3.5 Super VL (Free), lane ready, "openrouter accepted the key").
>
> **Works:** `POST /v1/chat/completions` with a text-only body on `meterless/auto`, `nvidia/nemotron-3.5-lightning-30b-a3b` and `nvidia/nemotron-3-ultra-550b-a55b`: answers with receipts in under 1 s.
>
> **Fails:** the same endpoint with an `image_url` part (a 114×113 PNG, base64 data URL) and `model` set to any of:
> - `openrouter/nvidia/nemotron-3.5-super-vl:free` (seated in the Race row)
> - `nvidia/nemotron-3.5-super-vl-120b-a12b` (after setting `NVIDIA_SUPER_VL=true` in `state/engine-kv.json`; it then appears in `/v1/models`)
> - `meterless/vision`
>
> Every case returns **502** `request has image attachments but no configured vision-capable model admits them (add an OpenAI/Anthropic/Google key or enable a vision model)`.
>
> **What I think is happening** (from reading `engine/js/engine/orchestrator.js` in 1.2.7):
> 1. The vision gate around line 2440 filters `pool`, which comes from `pickRaceCandidates(phase, routeMode, …)`.
> 2. `pickRaceCandidates` → `availableModels` → `isActiveModel` drops rows tagged `experimental`, and `release-2026-10` rows without `liveVerifiedAt`. Both Nemotron Super VL rows are excluded that way, so the pool contains no vision model.
> 3. The pinned model (`forceModelId`) is only substituted later (around line 2536: `if (forceModelId) candidates = [forceModelId]`), so a named VL model never reaches the gate.
>
> Text requests skip the gate, which is why pinning works for text.
>
> **Possible fix:** when `forceModelId` is set, run the vision check against the pinned row (`RT.modelSees(RT.findModel(forceModelId))`) instead of the automatic pool. Separately, the Add-lane picker never lists `nvidia/nemotron-3.5-super-vl-120b-a12b`, even after the host flag is set, because the webview reads its own copy of the gate.
>
> **Question:** is there a supported way, today, to send an image to a Nemotron VL model through the hotspot? For the hackathon we're falling back to NVIDIA's API directly, for the image step only, and disclosing it. Happy to test a build.

## SkyLedger's workaround

- Every text model call goes through Nightshift: the Reporter on Nemotron 3.5 Lightning, the eval baseline on `meterless/auto`.
- PlumeReader tries Nightshift first. Only when Nightshift refuses with `no_vision_model` does it send the same request to `https://integrate.api.nvidia.com/v1` with `nvidia/nemotron-3.5-super-vl-120b-a12b` (`app/agents/plume_reader.ts`, `app/adapters/meterless.ts`).
- Each fallback is logged in the trace as `PlumeReader / vision_route / fallback`. The dossier evidence names the route (`nvidia-direct`) and quotes Nightshift's refusal.
- If a Nightshift build fixes the gate, the first attempt succeeds and no code change is needed.
