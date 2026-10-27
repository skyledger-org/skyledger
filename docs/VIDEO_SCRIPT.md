# Demo video script (target 3:15, hard limit 4:00)

The rules require a 1–4 minute video that shows the main workflow, how it solves Track 1, the key features, and **how Zetaris and Meterless are integrated**. Use real runs only, and keep **API keys off screen**.

## Before recording
- **Docker Desktop** is running, and in Ubuntu: `cd ~/zetaris/zetaris-platform && docker compose start`, then `./verify.sh` shows 9/9.
- **Nightshift** is open, with the NIGHT → LANES board showing the Lightning, Ultra and Super VL lanes ready.
- `npm start` in the repo. Open three browser tabs:
  1. http://localhost:8000/
  2. http://localhost:8000/app
  3. http://localhost:3000 (the Zetaris UI, signed in)
- **Close or hide `.env`, the Nightshift Console and Providers tabs, and the Zetaris API Tokens page.** They show secrets.
- Screen 1920×1080, browser zoom 100%, notifications off. Record with OBS or the Xbox Game Bar (Win+G).
- Run one live scenario once before recording, so the models are warm.

## Script

| Time | Screen | Voice-over (say roughly this) |
|---|---|---|
| 0:00–0:15 | Landing page hero, mouse resting, the 3D field drifting | "Satellites now see methane leaks from space. Companies report their emissions to the EPA. And nobody checks one against the other. That's SkyLedger." |
| 0:15–0:40 | Scroll slowly through "Three sources" to "One plume" | "These are three sources that were never designed to meet: a plume in kilograms per hour on one morning, a yearly total in CO₂-equivalent tonnes, and an owner written as free text. No shared keys, units or clock. Every dot here is a real Carbon Mapper detection; every pin is a real EPA-reporting facility." |
| 0:40–1:05 | Keep scrolling through the agents and the Skeptic cards | "Eight agents work on each plume. The one that matters most is the Skeptic. Before anything is written, it has to rule out five innocent explanations: wrong facility, a one-off release, a site that doesn't have to report, equipment the report doesn't cover, or a bad measurement. It can send work back, or block it." |
| 1:05–1:20 | Click **Open the analyst console** | "This is the analyst console. Top right, the engines: Zetaris, Meterless Nightshift, NVIDIA Nemotron and the Meterless World Model, all live on this laptop." *(hover the pills)* |
| 1:20–1:55 | Choose **Live engines**, set 5 plumes, press **Run with live engines**. Let the trace stream | "I'll run it live. Watch the trace: GeoLinker runs a federated geo-join through Zetaris, querying the satellite and EPA tables in place without copying them. PlumeReader checks the wind. Nemotron reads the plume image. The Skeptic tests the rivals, and here it sends a case back for another look." *(point at a yellow send-back line)* |
| 1:55–2:35 | Click the **Taylor Gas Plant** or **Artesia** dossier (an inconsistent one). Scroll the dossier | "Here's one that survived. The plume averages over a thousand kilograms an hour, seen on every overpass in the reporting window. Even our conservative estimate is many times what the facility reported. It's always a range, never one number. All five rival tests are listed with the data behind them. The owner string was resolved into its parent company by the Meterless World Model." |
| 2:35–2:50 | Expand an **Evidence** row to show the SQL; click **Verify hash chain** | "Every claim carries its evidence: the exact SQL Zetaris ran, the image, the arithmetic. And the trace is hash-chained, so nobody can quietly edit it." |
| 2:50–3:00 | Type a name and click **Approve & sign** | "Nothing is shareable until an analyst signs. Signing issues an execution contract in Meterless Scout's format, bound to this exact dossier." |
| 3:00–3:10 | Switch to the Zetaris tab: SQL editor with `SELECT * FROM skyledger.cm_sources LIMIT 5`, then Nightshift's LANES board | "Under the hood: our data registered in Zetaris, and Nemotron lanes in Meterless Nightshift." |
| 3:10–3:15 | Back to the landing page evidence counters | "A naive approach flags thirty-four facilities. After the Skeptic, eight remain, each one traced, ranged and signed. SkyLedger." |

## Say it honestly if asked, or put it in the description
- "Nemotron vision runs through NVIDIA's API when Nightshift 1.2.7 refuses images. That's a bug we reported to Meterless, and every fallback is logged."
- "Vision is advisory. We measured it, and on these small quicklooks it's barely better than chance, so it can add confidence but never decides."

## After recording
- Check the length (under 4:00) and that no key or token appears in any frame.
- Upload as **unlisted** to YouTube or Google Drive, set so **anyone with the link can view**, and test the link in a private window.
