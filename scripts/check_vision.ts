// Runs PlumeReader's vision step on real plume images: Nightshift first, NVIDIA direct only if Nightshift refuses.
// Usage: npx tsx scripts/check_vision.ts [n]
import { config, hasNvidiaDirect } from "../app/config.ts";
import { chat, nvidiaDirectChat, isVisionRefusal, imageDataUrl } from "../app/adapters/meterless.ts";
import { sampleData } from "../app/adapters/sample_data.ts";

console.log("nvidia direct key set:", hasNvidiaDirect());
const n = Number(process.argv[2] ?? 3);
const plumes = sampleData().plumes.filter((p: any) => p.image).slice(0, n);
for (const p of plumes) {
  const messages = [{ role: "user" as const, content: [
    { type: "text" as const, text: `Methane plume (red-yellow overlay) on true-colour imagery, north up. Reported wind blows FROM ${Math.round(p.wind_direction_deg)} degrees. Reply ONLY with JSON: {"plume_heading_deg": <direction the plume extends from its concentrated head, 0-359>, "confidence": <0-1>, "reason": "<one sentence>"}` },
    { type: "image_url" as const, image_url: { url: imageDataUrl(p.image) } }] }];
  let route = "meterless-nightshift";
  try {
    let r;
    try { r = await chat(config.meterless.modelVision, messages, { maxTokens: 250 }); }
    catch (e) { if (!isVisionRefusal(e) || !hasNvidiaDirect()) throw e; route = "nvidia-direct"; r = await nvidiaDirectChat(messages, { maxTokens: 250 }); }
    console.log(`PASS ${p.plume_id} via ${route} (${r.model}, ${r.ms} ms): ${r.text.trim().slice(0, 220)}`);
  } catch (e) {
    console.log(`FAIL ${p.plume_id} via ${route}: ${(e as Error).message.slice(0, 250)}`);
  }
}
