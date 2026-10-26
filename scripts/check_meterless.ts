// Checks the Meterless Nightshift provider against the "Add Meterless as a provider" done-criteria:
//   1. a wrong token shows "unauthorized" (not offline)
//   2. discovery / Auto Detect finds the runtime
//   3. a plain text request returns a string
// plus SkyLedger's own lanes: the reasoning model and the vision model on a real plume image.
// The token is read from .env and never printed. Usage: npm run check:meterless
import { config, hasMeterless } from "../app/config.ts";
import { connect, discover, chat, imageDataUrl } from "../app/adapters/meterless.ts";
import { sampleData } from "../app/adapters/sample_data.ts";

const line = (ok: boolean | null, label: string, detail: string) => console.log(`${ok == null ? "INFO" : ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);

async function main() {
  if (!hasMeterless()) throw new Error("METERLESS_RUNTIME_TOKEN is not set in .env");

  const wrong = await discover(config.meterless.baseUrl, "skyledger-wrong-token-check");
  line(wrong.status === "unauthorized", "wrong token", `status ${wrong.status} (expected unauthorized)`);

  const c = await connect();
  line(c.status === "online", "discovery", `status ${c.status} at ${c.baseUrl}, ${c.models.length} models`);
  line(null, "meterless modes", c.models.filter((m) => m.startsWith("meterless/")).join(", ") || "none");
  line(null, "nemotron ids listed", c.models.filter((m) => /nemotron/i.test(m)).join(", ") || "none");
  if (c.status !== "online") return;

  const tryChat = async (label: string, model: string, content: any, maxTokens = 60) => {
    try {
      const r = await chat(model, [{ role: "user", content }], { maxTokens });
      line(r.text.trim().length > 0, label, `${model} -> ${JSON.stringify(r.text.trim().slice(0, 160))} (${r.ms} ms, echo ${r.model}${r.receipt ? `, receipt ${r.receipt}` : ""})`);
    } catch (e) {
      line(false, label, `${model} -> ${(e as Error).message.slice(0, 300)}`);
    }
  };
  await tryChat("text on meterless/auto", "meterless/auto", "Reply with exactly: SkyLedger connected.");
  await tryChat("reasoning lane", config.meterless.modelReasoning, "Reply with exactly: SkyLedger connected.");

  const p = sampleData().plumes.find((x: any) => x.image);
  if (p) {
    await tryChat("vision lane", config.meterless.modelVision, [
      { type: "text", text: "This is a methane plume overlaid on satellite imagery, north up. In one sentence: which direction does the plume extend from its narrow, concentrated head?" },
      { type: "image_url", image_url: { url: imageDataUrl(p.image) } },
    ], 200);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
