// SkyLedger analyst console. Vanilla ES module, no build step; every value shown comes from the API.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
const api = async (path, opts) => {
  const r = await fetch(path, opts);
  const isJson = r.headers.get("content-type")?.includes("json");
  const body = isJson ? await r.json() : await r.text();
  if (!r.ok) throw new Error(body?.error?.message ?? r.statusText);
  return body;
};

// ---------- Plain-language copy (the only text that is written here; all numbers come from the API) ----------
const VERDICT = {
  inconsistent_with_report: { label: "Inconsistent with report", explain: "Even the conservative estimate of yearly methane from what the satellites saw is higher than the facility reported to the EPA. All five rival explanations were tested first. This is a draft for an analyst, not an accusation." },
  consistent_with_report: { label: "Consistent with report", explain: "The conservative estimate does not exceed what the facility reported, so the observations are not in conflict with the report." },
  insufficient_sightings: { label: "Too few sightings", explain: "The plume was seen fewer times than needed during the reporting year, so a yearly total can't be estimated honestly. No comparison is made." },
  attribution_uncertain: { label: "Attribution uncertain", explain: "We can't tell which facility is the source with enough confidence (for example two plausible facilities nearby). It is left out of company totals." },
  coverage_gap: { label: "Coverage gap", explain: "The nearby reports cover a whole basin rather than this site, or the facility doesn't report the kind of equipment that leaks like this. A facility-level comparison would be misleading." },
  unreported_source: { label: "No reporter at the source", explain: "No EPA-reporting facility sits where the plume starts. A naive nearest-facility match would blame a plant that is not the source. The emitter may be well-site equipment reported only at basin level, or not reported at all." },
  dropped_quality: { label: "Dropped: data quality", explain: "The measurement itself is too uncertain (no rate, or uncertainty larger than the rate) to support any conclusion." },
};
const RIVAL = {
  R1: "Could another facility be the source?",
  R2: "Was it a one-off event rather than an ongoing leak?",
  R3: "Is the site actually required to report to the EPA?",
  R4: "Does the report cover this kind of equipment at all?",
  R5: "Is the satellite measurement good enough?",
};
const AGENT_COLOR = { SourceMapper: "#9aa6bb", GeoLinker: "#46e0ff", PlumeReader: "#ffb547", OwnershipResolver: "#a78bfa", Reconciler: "#3ddc97", Skeptic: "#ff4fa3", Reporter: "#e9eef5", SignOff: "#3ddc97", Orchestrator: "#9aa6bb" };
const VCOLOR = { inconsistent_with_report: "#ff4fa3", consistent_with_report: "#3ddc97", insufficient_sightings: "#f5c451", attribution_uncertain: "#f5c451", coverage_gap: "#9aa6bb", unreported_source: "#9aa6bb", dropped_quality: "#9aa6bb" };

// ---------- State ----------
const S = { status: null, geo: null, examples: [], runs: [], run: null, trace: [], sel: null, filter: null, q: "", labels: {}, mode: "sample", streaming: false, live: [] };

// ---------- Tooltips ----------
const tip = $("#tip");
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) return;
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
  const r = t.getBoundingClientRect();
  tip.style.left = Math.min(window.innerWidth - 340, Math.max(8, r.left)) + "px";
  tip.style.top = r.bottom + 8 + "px";
});
document.addEventListener("mouseout", (e) => { if (e.target.closest("[data-tip]")) tip.hidden = true; });

// ---------- Engine status ----------
function renderEngines() {
  const st = S.status;
  $("#engines").innerHTML = (st?.engines ?? []).map((e) => `<span class="pill ${e.state}" data-tip="${esc(`${e.role}: ${e.detail}`)}"><i></i>${esc(e.name)}</span>`).join("");
  const live = $("#mode-live");
  live.disabled = !st?.live_available;
  if (!st?.live_available) live.dataset.tip = "Live engines aren't reachable from this server. Offline sample mode runs the same agents on cached public data.";
}

// ---------- Toolbar ----------
function renderToolbar() {
  const st = S.status;
  $("#region").innerHTML = st.regions.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
  $("#region").value = st.default_region;
  const reg = st.regions.find((r) => r.id === $("#region").value);
  $("#year").innerHTML = reg.years.map((y) => `<option>${y}</option>`).join("");
  $("#year").value = String(reg.default_year);
  setMode(S.mode);
}
function setMode(mode) {
  S.mode = mode;
  $("#mode-sample").classList.toggle("on", mode === "sample");
  $("#mode-live").classList.toggle("on", mode === "live");
  $("#mode-sample").setAttribute("aria-checked", String(mode === "sample"));
  $("#mode-live").setAttribute("aria-checked", String(mode === "live"));
  const lim = S.status.limits;
  const max = mode === "live" ? Math.min(lim.max_plumes, lim.live_max_plumes) : lim.max_plumes;
  const inp = $("#maxp");
  inp.max = max;
  inp.value = Math.min(Number(inp.value) || (mode === "live" ? Math.min(5, max) : max), max);
  $("#go-label").textContent = mode === "live" ? "Run with live engines" : "Run the agents";
}
$("#mode-sample").onclick = () => setMode("sample");
$("#mode-live").onclick = () => !$("#mode-live").disabled && setMode("live");
$("#region").onchange = () => renderToolbar();

async function loadRunsList(selectId) {
  S.runs = await api("/api/runs");
  $("#runs").innerHTML = S.runs.length
    ? S.runs.map((r) => `<option value="${esc(r.id)}">${esc(new Date(r.created).toLocaleString())} · ${r.plumes} plumes · ${r.models_live || r.sql_live ? "live" : "sample"} · ${r.summary.inconsistent_with_report ?? 0} inconsistent</option>`).join("")
    : `<option value="">No saved runs yet</option>`;
  if (selectId) $("#runs").value = selectId;
}
$("#runs").onchange = () => $("#runs").value && loadRun($("#runs").value);

// ---------- Runs ----------
function startRun(extra = {}) {
  if (S.streaming) return;
  const params = new URLSearchParams({ region: $("#region").value, year: $("#year").value, max_plumes: $("#maxp").value, sample_mode: String(S.mode !== "live"), ...extra });
  const es = new EventSource(`/api/run/stream?${params}`);
  S.streaming = true; S.live = []; S.trace = [];
  const go = $("#go");
  go.disabled = true; go.classList.add("running"); $("#go-label").textContent = "Agents working…";
  $("#progress").hidden = false; $("#progress-bar").style.width = "2%"; $("#progress-text").textContent = "Mapping sources…";
  $("#only-sel").checked = false;
  renderTraceList();
  const finish = () => { es.close(); S.streaming = false; go.disabled = false; go.classList.remove("running"); setMode(S.mode); };
  es.addEventListener("trace", (e) => { const line = JSON.parse(e.data); S.trace.push(line); appendTrace(line); });
  es.addEventListener("progress", (e) => {
    const p = JSON.parse(e.data);
    $("#progress-bar").style.width = `${Math.round((100 * p.done) / p.total)}%`;
    $("#progress-text").textContent = `${p.done} of ${p.total} plumes checked · last: ${VERDICT[p.verdict]?.label ?? p.verdict}`;
  });
  es.addEventListener("done", async (e) => {
    const d = JSON.parse(e.data);
    finish();
    $("#progress-text").textContent = `Done in ${d.seconds}s · ${Object.entries(d.summary).map(([k, v]) => `${v} ${VERDICT[k]?.label.toLowerCase() ?? k}`).join(" · ")}`;
    await loadRunsList(d.run_id);
    await loadRun(d.run_id, true);
  });
  es.addEventListener("error", (e) => {
    let msg = "The run stopped unexpectedly.";
    try { msg = JSON.parse(e.data).message; } catch {}
    finish();
    $("#progress-text").textContent = `⚠ ${msg}`;
  });
}
$("#go").onclick = () => startRun();

async function loadRun(id, keepTrace = false) {
  S.run = await api(`/api/runs/${encodeURIComponent(id)}`);
  if (!keepTrace || !S.trace.length) {
    const t = await api(`/api/runs/${encodeURIComponent(id)}/trace`);
    S.trace = String(t).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }
  try { S.labels = await api("/api/labels"); } catch { S.labels = {}; }
  const ds = S.run.output.dossiers;
  S.sel = (ds.find((d) => d.verdict === "inconsistent_with_report") ?? ds[0])?.plume.plume_id ?? null;
  S.filter = null;
  $("#only-sel").checked = true;
  renderAll();
  focusPlume(S.sel, false);
}

// ---------- Left pane ----------
function renderVerdicts() {
  const sum = S.run?.output.summary ?? {};
  $("#verdicts").innerHTML = Object.keys(VERDICT).filter((k) => sum[k]).map((k) => `<button class="vchip ${S.filter === k ? "on" : ""}" data-k="${k}" data-tip="${esc(VERDICT[k].explain)}"><b class="v-${k}">${sum[k]}</b><span>${esc(VERDICT[k].label)}</span></button>`).join("");
  $$(".vchip").forEach((b) => (b.onclick = () => { S.filter = S.filter === b.dataset.k ? null : b.dataset.k; renderVerdicts(); renderList(); }));
}
function visibleDossiers() {
  const q = S.q.toLowerCase();
  return (S.run?.output.dossiers ?? []).filter((d) => (!S.filter || d.verdict === S.filter) && (!q || [d.plume.plume_id, d.attributed?.facility_name, ...d.owners.map((o) => o.name), ...d.candidates.map((c) => c.facility_name)].join(" ").toLowerCase().includes(q)));
}
function renderList() {
  const ds = visibleDossiers();
  $("#plumes").innerHTML = ds.map((d) => `<li class="pcard ${d.plume.plume_id === S.sel ? "on" : ""}" data-id="${esc(d.plume.plume_id)}" tabindex="0">
      <span class="fac">${esc((isBlind() ? null : d.attributed?.facility_name) ?? (d.candidates[0] ? `Near ${d.candidates[0].facility_name}` : "No facility nearby"))}</span>
      <span class="rate">${d.plume.emission_kgph == null ? "—" : fmt(d.plume.emission_kgph) + " kg/h"}</span>
      <span class="meta">${esc(d.plume.platform)} · ${esc(String(d.plume.scene_timestamp).slice(0, 10))}${S.labels[d.plume.plume_id] ? " · labelled" : ""}</span>
      <span class="badge v-${d.verdict}">${esc(VERDICT[d.verdict]?.label ?? d.verdict)}</span></li>`).join("") || `<li class="hint">${S.run ? "No plumes match." : "No run loaded. Pick a scenario or press Run the agents."}</li>`;
  $$(".pcard").forEach((li) => { li.onclick = () => select(li.dataset.id); li.onkeydown = (e) => e.key === "Enter" && select(li.dataset.id); });
}
$("#search").oninput = (e) => { S.q = e.target.value; renderList(); };
$$(".tab").forEach((t) => (t.onclick = () => {
  $$(".tab").forEach((x) => { x.classList.toggle("on", x === t); x.setAttribute("aria-selected", String(x === t)); });
  $("#tab-plumes").hidden = t.dataset.tab !== "plumes";
  $("#tab-parents").hidden = t.dataset.tab !== "parents";
}));
function renderRollup() {
  $("#rollup tbody").innerHTML = (S.run?.output.rollup ?? []).map((r) => `<tr><td>${esc(r.parent)}${r.cik ? `<div class="muted sm">CIK ${esc(r.cik)}</div>` : ""}</td><td class="num">${r.facilities}</td><td class="num">${r.surviving}</td><td class="mono sm">${r.ratio_range ? `${r.ratio_range[0]}–${r.ratio_range[1]}×` : "—"}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Run the agents to see parent companies.</td></tr>`;
}

function select(id) { S.sel = id; renderList(); renderDossier(); renderTraceList(); focusPlume(id, true); }

// ---------- Map ----------
const canvas = $("#map");
const ctx = canvas.getContext("2d");
const view = { k: 1, x: 0, y: 0 }; // zoom and pan in CSS pixels
let base = null; // projection fitted to the region bbox
function project(lon, lat) {
  const { bbox } = S.geo;
  const midLat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  const sx = (lon - bbox.west) * Math.cos(midLat), sy = bbox.north - lat;
  return [base.ox + sx * base.s, base.oy + sy * base.s];
}
function fitBase() {
  const { bbox } = S.geo;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const midLat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  const spanX = (bbox.east - bbox.west) * Math.cos(midLat), spanY = bbox.north - bbox.south;
  const s = Math.min((w - 60) / spanX, (h - 60) / spanY);
  base = { s, ox: (w - spanX * s) / 2, oy: (h - spanY * s) / 2 };
}
const isBlind = () => document.body.classList.contains("blind");
const toScreen = ([x, y]) => [x * view.k + view.x, y * view.k + view.y];
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!S.geo) return;
  fitBase();
  // The projection depends on the canvas size, so a zoomed view must be rebuilt around the selection.
  if (view.k !== 1 && S.sel) focusPlume(S.sel, false); else drawMap();
}
// Layout changes (a scrollbar appearing, panes reflowing) resize the canvas without a window resize event.
new ResizeObserver(() => resize()).observe(canvas);

function drawMap() {
  if (!S.geo || !base) return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const { bbox } = S.geo;
  // graticule
  const pxPerDeg = base.s * view.k; const gstep = [0.05, 0.1, 0.25, 0.5, 1].find((g) => g * pxPerDeg > 70) ?? 1;
  ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1; ctx.font = "10px JetBrains Mono, monospace"; ctx.fillStyle = "rgba(255,255,255,0.25)";
  for (let lon = Math.ceil(bbox.west / gstep) * gstep; lon <= bbox.east; lon += gstep) { const [x1, y1] = toScreen(project(lon, bbox.north)); const [x2, y2] = toScreen(project(lon, bbox.south)); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.fillText(`${lon.toFixed(gstep < 0.1 ? 2 : 1)}°`, x2 + 3, Math.min(y2, canvas.clientHeight) - 6); }
  for (let lat = Math.ceil(bbox.south / gstep) * gstep; lat <= bbox.north; lat += gstep) { const [x1, y1] = toScreen(project(bbox.west, lat)); const [x2, y2] = toScreen(project(bbox.east, lat)); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.fillText(`${lat.toFixed(gstep < 0.1 ? 2 : 1)}°`, Math.max(x1, 0) + 4, y1 - 4); }
  // all satellite sources
  ctx.globalCompositeOperation = "lighter";
  for (const [lon, lat, kgph] of S.geo.sources) {
    const [x, y] = toScreen(project(lon, lat));
    if (x < -5 || y < -5 || x > w + 5 || y > h + 5) continue;
    const m = kgph ? Math.log10(kgph + 1) / 4 : 0.1;
    const zr = Math.min(2.2, 0.9 + Math.log2(view.k) * 0.35);
    ctx.fillStyle = `rgba(255,181,71,${(0.1 + 0.32 * m) * (view.k > 6 ? 0.6 : 1)})`;
    ctx.beginPath(); ctx.arc(x, y, (0.8 + 1.8 * m) * zr, 0, 6.283); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  // reporting facilities
  for (const [lon, lat, kind] of S.geo.facilities) {
    const [x, y] = toScreen(project(lon, lat));
    if (x < -5 || y < -5 || x > w + 5 || y > h + 5) continue;
    const r = Math.min(4.5, 1.8 + Math.log2(view.k) * 0.5);
    if (kind === "basin_aggregate") { ctx.strokeStyle = "rgba(70,224,255,0.45)"; ctx.lineWidth = 1; ctx.strokeRect(x - r, y - r, 2 * r, 2 * r); }
    else { ctx.fillStyle = "rgba(70,224,255,0.85)"; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); }
  }
  // analysed plumes
  for (const d of S.run?.output.dossiers ?? []) {
    const [x, y] = toScreen(project(d.plume.lon, d.plume.lat));
    ctx.strokeStyle = isBlind() ? "rgba(233,238,245,.7)" : VCOLOR[d.verdict] ?? "#fff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 6.283); ctx.stroke();
  }
  // selection: candidate links + wind
  const d = current();
  if (d) {
    const [px, py] = toScreen(project(d.plume.lon, d.plume.lat));
    for (const c of d.candidates.slice(0, 6)) {
      const [fx, fy] = toScreen(project(c.longitude, c.latitude));
      const isA = !isBlind() && d.attributed?.facility_id === c.facility_id;
      const out = !isBlind() && d.plume_reader?.inconsistent?.includes(c.facility_id);
      ctx.strokeStyle = isA ? "#3ddc97" : out ? "rgba(255,107,107,0.8)" : "rgba(255,255,255,0.35)";
      ctx.setLineDash(isA ? [] : [4, 4]); ctx.lineWidth = isA ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(fx, fy); ctx.stroke(); ctx.setLineDash([]);
      if (view.k > 3) { ctx.fillStyle = "rgba(233,238,245,0.85)"; ctx.font = "11px Inter, sans-serif"; ctx.fillText(`${c.facility_name.slice(0, 26)} · ${fmt(c.dist_m)} m`, fx + 6, fy - 6); }
    }
    if (d.plume.wind_direction_deg != null) {
      const to = ((d.plume.wind_direction_deg + 180) * Math.PI) / 180, L = 34;
      const ex = px + Math.sin(to) * L, ey = py - Math.cos(to) * L;
      ctx.strokeStyle = "#e9eef5"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.sin(to - 0.45) * 8, ey + Math.cos(to - 0.45) * 8); ctx.lineTo(ex - Math.sin(to + 0.45) * 8, ey + Math.cos(to + 0.45) * 8); ctx.fillStyle = "#e9eef5"; ctx.fill();
    }
    ctx.strokeStyle = "#ff4fa3"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(px, py, 10, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = "rgba(255,79,163,0.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, py, 18, 0, 6.283); ctx.stroke();
  }
}
let anim = null;
function focusPlume(id, animate) {
  const d = (S.run?.output.dossiers ?? []).find((x) => x.plume.plume_id === id);
  if (!d || !base) return drawMap();
  const target = 40; // about 40 px per km at Permian latitudes: candidates within the search radius fill the map
  const [bx, by] = project(d.plume.lon, d.plume.lat);
  const to = { k: target, x: canvas.clientWidth / 2 - bx * target, y: canvas.clientHeight / 2 - by * target };
  if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) { Object.assign(view, to); return drawMap(); }
  const from = { ...view }, t0 = performance.now();
  cancelAnimationFrame(anim);
  const step = (t) => {
    const u = Math.min(1, (t - t0) / 650), e = 1 - Math.pow(1 - u, 3);
    view.k = from.k + (to.k - from.k) * e; view.x = from.x + (to.x - from.x) * e; view.y = from.y + (to.y - from.y) * e;
    drawMap(); if (u < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
function zoomAt(f, cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2) {
  const k = Math.min(60, Math.max(0.8, view.k * f)); const r = k / view.k;
  view.x = cx - (cx - view.x) * r; view.y = cy - (cy - view.y) * r; view.k = k; drawMap();
}
canvas.addEventListener("wheel", (e) => { e.preventDefault(); const b = canvas.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - b.left, e.clientY - b.top); }, { passive: false });
let drag = null;
canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; canvas.setPointerCapture(e.pointerId); canvas.classList.add("dragging"); });
canvas.addEventListener("pointermove", (e) => {
  if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; view.x = drag.vx + dx; view.y = drag.vy + dy; drawMap(); return; }
  const hit = hitTest(e); const tipEl = $("#map-tip");
  if (!hit) { tipEl.hidden = true; return; }
  const b = canvas.getBoundingClientRect();
  tipEl.hidden = false; tipEl.style.left = e.clientX - b.left + 14 + "px"; tipEl.style.top = e.clientY - b.top + 10 + "px";
  tipEl.innerHTML = hit.html;
});
canvas.addEventListener("pointerup", (e) => { canvas.classList.remove("dragging"); const wasDrag = drag?.moved; drag = null; if (!wasDrag) { const hit = hitTest(e); if (hit?.plume) select(hit.plume); } });
canvas.addEventListener("pointerleave", () => ($("#map-tip").hidden = true));
function hitTest(e) {
  const b = canvas.getBoundingClientRect(); const mx = e.clientX - b.left, my = e.clientY - b.top;
  let best = null, bd = 12;
  for (const d of S.run?.output.dossiers ?? []) { const [x, y] = toScreen(project(d.plume.lon, d.plume.lat)); const dd = Math.hypot(x - mx, y - my); if (dd < bd) { bd = dd; best = { plume: d.plume.plume_id, html: isBlind() ? `<b>Analysed plume</b><br>${fmt(d.plume.emission_kgph)} kg/h` : `<b>${esc(d.attributed?.facility_name ?? "Analysed plume")}</b><br><span class="v-${d.verdict}">${esc(VERDICT[d.verdict]?.label)}</span> · ${fmt(d.plume.emission_kgph)} kg/h` }; } }
  if (best) return best;
  bd = 8;
  for (const [lon, lat, kind, t, name] of S.geo.facilities) { const [x, y] = toScreen(project(lon, lat)); const dd = Math.hypot(x - mx, y - my); if (dd < bd) { bd = dd; best = { html: `<b>${esc(name)}</b><br>${kind === "basin_aggregate" ? "Basin-level report (location is representative)" : "EPA-reporting facility"}${t != null ? ` · reports ${fmt(t)} t CH₄` : ""}` }; } }
  if (best) return best;
  bd = 6;
  for (const [lon, lat, kgph, pers, det] of S.geo.sources) { const [x, y] = toScreen(project(lon, lat)); const dd = Math.hypot(x - mx, y - my); if (dd < bd) { bd = dd; best = { html: `Satellite methane source<br>${kgph == null ? "rate not quantified" : `${fmt(kgph)} kg/h average`} · seen on ${det} date${det === 1 ? "" : "s"}` }; } }
  return best;
}
$("#zin").onclick = () => zoomAt(1.5);
$("#zout").onclick = () => zoomAt(1 / 1.5);
$("#zfit").onclick = () => { Object.assign(view, { k: 1, x: 0, y: 0 }); drawMap(); };

// ---------- Dossier ----------
const current = () => (S.run?.output.dossiers ?? []).find((d) => d.plume.plume_id === S.sel);

function welcome() {
  const st = S.status;
  return `<div class="welcome">
    <div class="muted sm">${esc(st.regions.find((r) => r.id === st.default_region)?.name ?? "")}</div>
    <h1>Check what satellites saw against what was reported.</h1>
    <p>Each run sends a team of agents over methane plumes seen from space. They find the facilities nearby, read the plume and the wind, work out who owns what, convert the numbers into comparable yearly ranges, and a Skeptic tries to prove the result wrong before anything is written up. Nothing is shareable until you sign it.</p>
    <p class="muted sm">Start with a scenario, or set the options above and press <b>Run the agents</b>.</p>
    <div class="scenarios">${S.examples.map((x) => `<button class="scenario" data-id="${esc(x.id)}"><b>${esc(x.question)}</b><span>${x.input.plume_ids ? `${x.input.plume_ids.length} specific plumes` : `${x.input.max_plumes ?? ""} plumes`} · ${esc(x.input.region ?? "")} ${esc(x.input.year ?? "")}</span></button>`).join("")}</div>
  </div>`;
}

function renderDossier() {
  const el = $("#dossier");
  const d = current();
  if (!S.run || !d) { el.innerHTML = welcome(); bindWelcome(); return; }
  const p = d.plume, f = d.attributed, w = p.window, v = VERDICT[d.verdict] ?? { label: d.verdict, explain: "" };
  const label = S.labels[p.plume_id];
  el.innerHTML = `
  <div class="d-head">
    <div>
      <span class="badge v-${d.verdict}">${esc(v.label)}</span>
      <div class="d-title">${esc((isBlind() ? null : f?.facility_name) ?? (d.candidates[0] ? `Nearest: ${d.candidates[0].facility_name}` : "No reporting facility nearby"))}</div>
      <div class="d-sub mono">${esc(p.plume_id)} · ${esc(p.platform)} · ${esc(String(p.scene_timestamp).slice(0, 16).replace("T", " "))} UTC</div>
    </div>
    <span class="status-tag ${d.status === "shareable" ? "shareable" : ""}">${d.status === "shareable" ? "SIGNED · SHAREABLE" : "DRAFT · NOT SHAREABLE"}</span>
  </div>
  <div class="explain">${esc(v.explain)}</div>
  <p class="summary">${esc(d.summary)}</p>

  <div class="kpis">
    <div class="kpi"><div class="k" data-tip="Carbon Mapper's average across all its overpasses of this source, ± one standard deviation.">Observed rate</div><div class="v">${p.emission_kgph == null ? "—" : `${fmt(p.emission_kgph)} <small>± ${fmt(p.emission_uncertainty_kgph)} kg/h</small>`}</div></div>
    <div class="kpi"><div class="k" data-tip="Days the plume was detected, out of days the area was flown over, inside the reporting-year window.">Sightings in window</div><div class="v">${w.detections} <small>of ${w.observations} · ${esc(w.from)} → ${esc(w.to)}</small></div></div>
    <div class="kpi"><div class="k" data-tip="Low: rate − σ × hours in a year × observed persistence. High: rate + σ × hours in a year, if continuous.">Implied per year</div><div class="v">${d.implied_tch4 ? `${fmt(d.implied_tch4[0])}–${fmt(d.implied_tch4[1])} <small>t CH₄</small>` : "—"}</div></div>
    <div class="kpi"><div class="k" data-tip="All methane the facility reported to EPA GHGRP for the year, converted from CO₂e with that year's global warming potential.">Reported</div><div class="v">${f?.reported_ch4_t != null ? `${fmt(f.reported_ch4_t)} <small>t CH₄ · RY${esc(S.run.input?.year ?? "")}</small>` : "—"}</div></div>
  </div>
  ${d.ratio ? ratioBar(d.ratio) : ""}

  <div class="two">
    ${p.image ? `<figure class="plume-img"><canvas id="pimg"></canvas><figcaption>Carbon Mapper quicklook, north up. ✚ plume origin estimate · arrow: wind (blows toward) · ${isBlind() ? "<span style=\"color:#46e0ff\">●</span> reporting facility · <span style=\"color:#9aa6bb\">●</span> basin-level report" : "<span style=\"color:#3ddc97\">●</span> attributed · <span style=\"color:#ff6b6b\">●</span> ruled out by geometry"} · ■ outside the image. Quicklooks are small (about 114 px), so the picture supports, but never decides, the attribution.</figcaption></figure>` : `<div class="explain">No quicklook image for this plume.</div>`}
    <div>
      <div class="section plume-reading" style="margin-top:0"><h3>Plume reading</h3><p class="muted" style="margin:0 0 8px">${esc(d.plume_reader?.verdict ?? "—")}</p>
      ${d.evidence.filter((e) => e.kind === "model").map((e) => `<p class="sm" style="color:var(--ink-2);margin:0 0 6px"><span class="src-tag">${esc(e.source)}</span>${esc(e.detail)}</p>`).join("")}</div>
      ${d.owners.length ? `<div class="section owners-sec"><h3>Who owns it <span class="muted sm" style="text-transform:none">· Meterless World Model</span></h3>${d.owners.map((o) => `<div style="margin-bottom:8px"><b>${esc(o.name)}</b>${o.pct != null ? ` <span class="muted">${o.pct}%</span>` : ""}${o.cik ? ` <span class="muted sm">CIK ${esc(o.cik)}</span>` : ""}<div class="muted sm">from “${esc(o.raw)}”${o.merged_from.length > 1 ? ` · merged spellings: ${o.merged_from.map(esc).join(" · ")}` : ""}${o.review ? " · in operator review" : ""}</div></div>`).join("")}</div>` : ""}
    </div>
  </div>

  <div class="section rival-head"><h3>The Skeptic's five tests</h3><div class="rivals">${["R1", "R2", "R3", "R4", "R5"].map((id) => {
    const r = d.rivals.find((x) => x.id === id);
    const st = r?.status ?? "pending";
    const ic = st === "ruled_out" ? "✓" : st === "flagged" ? "!" : st === "failed" ? "✕" : "·";
    return `<div class="rival ${st}"><span class="ic">${ic}</span><span class="nm">${esc(r?.name ?? id)}<small>${esc(RIVAL[id])}</small></span><span class="nt">${r ? esc(r.note) : `<span class="muted">Not reached: an earlier test settled this case.</span>`}</span></div>`;
  }).join("")}</div>
  ${d.revisions.length ? `<p class="sm muted" style="margin-top:8px">Sent back for more work: ${d.revisions.map((r) => `${esc(r.agent)} (${esc(r.reason)})`).join(" → ")}</p>` : ""}</div>

  <div class="section"><h3>Facilities nearby <span class="muted sm" style="text-transform:none">· federated join, ${esc(d.radius_m)} m</span></h3>
  <table class="tbl"><thead><tr><th>Facility</th><th class="num">Distance</th><th>Reports as</th><th class="num">Reported t CH₄</th></tr></thead><tbody>
  ${d.candidates.map((k) => `<tr><td>${esc(k.facility_name)}${d.attributed?.facility_id === k.facility_id ? ' <span class="badge attributed-tag" style="color:#3ddc97">attributed</span>' : ""}</td><td class="num">${fmt(k.dist_m)} m</td><td>${k.kind === "basin_aggregate" ? `<span data-tip="An operator's whole basin, filed as one 'facility'. Its coordinates are representative, not an emitting site.">basin-level</span>` : "site"} <span class="muted sm">${esc(k.reported_industry_types)}</span></td><td class="num">${k.reported_ch4_t == null ? "—" : fmt(k.reported_ch4_t)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No oil &amp; gas reporter within the search radius.</td></tr>`}
  </tbody></table></div>

  <div class="section evidence"><h3>Evidence</h3>${d.evidence.map((e) => `<details><summary><span class="src-tag">${esc(e.source)}</span>${esc(e.detail.slice(0, 140))}${e.detail.length > 140 ? "…" : ""}${e.rows_hash ? ` <span class="muted sm mono">rows ${esc(e.rows_hash)}</span>` : ""}</summary><pre>${esc(e.sql ?? e.detail)}</pre></details>`).join("")}</div>

  <div class="section signoff-sec"><h3>Analyst sign-off</h3>
  ${d.contract ? `<p class="sm">Signed by <b>${esc(d.contract.scope.user)}</b> · contract <span class="mono">${esc(d.contract.contractId)}</span> · HMAC-SHA256 over the dossier and trace head</p><div class="contract">${esc(JSON.stringify(d.contract, null, 1))}</div>`
    : `<div class="row"><input id="analyst" placeholder="Your name" aria-label="Analyst name"><button class="btn" id="sign">Approve &amp; sign</button><span class="muted sm">Signing issues an execution contract that binds this exact dossier and trace.</span></div>`}</div>

  <div class="section labels-sec"><h3>Your label <span class="muted sm" style="text-transform:none">· builds the accuracy test set</span></h3>
  <ol class="label-guide"><li>In the image, find where the plume is <b>narrow and brightest</b>: that's its head (the source). It fans out downwind, the way the white arrow points.</li><li>A facility <b>at or right next to the head</b> is the source. Pick it.</li><li>A facility the plume blows <b>toward</b>, or that's far from the head (roughly over 1 km), is not the source.</li><li>No facility near the head: <b>No reporter at the head</b>. Two equally plausible, or a messy image: <b>Can't tell</b>.</li></ol>
  <div class="labels">${d.candidates.filter((k) => k.kind === "point").slice(0, 5).map((k) => `<button class="btn sm ${label?.label === String(k.facility_id) ? "on" : ""}" data-l="${k.facility_id}">${esc(k.facility_name.slice(0, 30))}</button>`).join("")}<button class="btn sm ${label?.label === "none" ? "on" : ""}" data-l="none">No reporter at the head</button><button class="btn sm ${label?.label === "ambiguous" ? "on" : ""}" data-l="ambiguous">Can't tell</button></div></div>`;
  if (p.image) drawPlumeImage($("#pimg"), d);
  const sign = $("#sign");
  if (sign) sign.onclick = async () => {
    const analyst = $("#analyst").value.trim();
    if (!analyst) return $("#analyst").focus();
    d.contract = await api("/api/signoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: S.run.run_id, plume_id: p.plume_id, analyst }) });
    d.status = "shareable";
    renderDossier();
  };
  $$(".labels button").forEach((b) => (b.onclick = async () => {
    await api("/api/labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plume_id: p.plume_id, label: b.dataset.l }) });
    S.labels[p.plume_id] = { label: b.dataset.l };
    renderDossier(); renderList();
  }));
}
function bindWelcome() {
  $$(".scenario").forEach((b) => (b.onclick = () => {
    const x = S.examples.find((e) => e.id === b.dataset.id);
    if (x.input.max_plumes) $("#maxp").value = Math.min(x.input.max_plumes, Number($("#maxp").max));
    startRun(x.input.plume_ids ? { plume_ids: x.input.plume_ids.join(","), max_plumes: String(x.input.plume_ids.length), question: x.question } : { question: x.question });
  }));
}
function ratioBar([lo, hi]) {
  const L = (v) => Math.log10(Math.max(0.1, v));
  const min = -1, max = Math.max(2.5, L(hi) + 0.2), pos = (v) => ((L(v) - min) / (max - min)) * 100;
  return `<div class="ratio"><div class="k muted sm" style="margin-bottom:6px">Implied ÷ reported: <b style="color:var(--ink)">${lo}–${hi}×</b> <span data-tip="The white marker is 1×, where observations would exactly match the report. Log scale.">(log scale)</span></div>
    <div class="ratio-bar"><div class="rng" style="left:${pos(lo)}%;width:${Math.max(1, pos(hi) - pos(lo))}%"></div><div class="one" style="left:${pos(1)}%"></div></div>
    <div class="ratio-scale"><span>0.1×</span><span>1×</span><span>10×</span><span>100×</span></div></div>`;
}
function drawPlumeImage(cv, d) {
  const p = d.plume, b = p.plume_bounds, S2 = 3;
  const g = cv.getContext("2d");
  const img = new Image();
  img.onload = () => {
    cv.width = img.width * S2; cv.height = img.height * S2;
    g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, cv.width, cv.height);
    if (!b) return;
    const W = cv.width, H = cv.height;
    const xy = (lat, lon) => [((lon - b[0]) / (b[2] - b[0])) * W, ((b[3] - lat) / (b[3] - b[1])) * H];
    const clamp = (v, m) => Math.max(10, Math.min(m - 10, v));
    for (const k of d.candidates) {
      let [x, y] = xy(k.latitude, k.longitude);
      const outside = x < 0 || y < 0 || x > W || y > H; x = clamp(x, W); y = clamp(y, H);
      const col = k.kind === "basin_aggregate" ? "#9aa6bb" : isBlind() ? "#46e0ff" : d.attributed?.facility_id === k.facility_id ? "#3ddc97" : d.plume_reader?.inconsistent?.includes(k.facility_id) ? "#ff6b6b" : "#46e0ff";
      g.fillStyle = col; g.strokeStyle = "#000"; g.lineWidth = 2;
      g.beginPath(); outside ? g.rect(x - 6, y - 6, 12, 12) : g.arc(x, y, 7, 0, 6.283); g.fill(); g.stroke();
      g.font = "600 12px Inter, sans-serif"; g.lineWidth = 3; g.strokeText(k.facility_name.slice(0, 22), x + 10, y + 4); g.fillText(k.facility_name.slice(0, 22), x + 10, y + 4);
    }
    const [ox, oy] = xy(p.plume_lat ?? p.lat, p.plume_lon ?? p.lon);
    g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath(); g.moveTo(ox - 9, oy); g.lineTo(ox + 9, oy); g.moveTo(ox, oy - 9); g.lineTo(ox, oy + 9); g.stroke();
    if (p.wind_direction_deg != null) {
      const to = ((p.wind_direction_deg + 180) * Math.PI) / 180, L = 44, cx = 34, cy = 34;
      const ex = cx + (Math.sin(to) * L) / 2, ey = cy - (Math.cos(to) * L) / 2, sx = cx - (Math.sin(to) * L) / 2, sy = cy + (Math.cos(to) * L) / 2;
      g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineWidth = 3; g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
      g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - Math.sin(to - 0.5) * 11, ey + Math.cos(to - 0.5) * 11); g.lineTo(ex - Math.sin(to + 0.5) * 11, ey + Math.cos(to + 0.5) * 11); g.fill();
      g.font = "600 11px JetBrains Mono, monospace"; g.fillText(`${(p.wind_speed_ms ?? 0).toFixed(1)} m/s`, 8, 74);
    }
  };
  img.src = "/" + p.image;
}

// ---------- Trace ----------
function traceItem(t, fresh) {
  const col = AGENT_COLOR[t.agent_name] ?? "#9aa6bb";
  return `<li class="${esc(t.status)} ${fresh ? "fresh" : ""}"><div class="t-head"><span class="t-agent" style="color:${col}">${esc(t.agent_name)}</span><span class="t-act">${esc(t.action)}</span>${t.target_agent ? `<span class="t-arrow">→ ${esc(t.target_agent)}</span>` : ""}<span class="t-time">#${t.seq}</span></div><div class="t-body">${esc(t.output_summary)}</div></li>`;
}
function renderTraceList() {
  const only = $("#only-sel").checked && S.sel && !S.streaming;
  const rows = only ? S.trace.filter((t) => !t.plume_id || t.plume_id === S.sel) : S.trace;
  $("#trace").innerHTML = rows.map((t) => traceItem(t, false)).join("") || `<li class="muted">The trace appears here as the agents work.</li>`;
}
function appendTrace(line) {
  const ol = $("#trace");
  if (ol.firstElementChild?.classList.contains("muted")) ol.innerHTML = "";
  ol.insertAdjacentHTML("beforeend", traceItem(line, true));
  if (ol.children.length > 400) ol.firstElementChild.remove();
  ol.parentElement.scrollTop = ol.parentElement.scrollHeight;
}
$("#only-sel").onchange = renderTraceList;
$("#verify").onclick = async () => {
  if (!S.run) return;
  const v = await api(`/api/runs/${encodeURIComponent(S.run.run_id)}/verify`);
  $("#verify-out").textContent = v.ok ? `✓ ${v.lines} lines, chain intact` : `✕ chain broken at line ${v.brokenAt}`;
};

// ---------- Blind labelling ----------
$("#blind").onchange = (e) => { document.body.classList.toggle("blind", e.target.checked); try { localStorage.setItem("sl-blind", e.target.checked ? "1" : ""); } catch {} if (S.run) renderAll(); resize(); };
try { if (localStorage.getItem("sl-blind")) { $("#blind").checked = true; document.body.classList.add("blind"); } } catch {}

// ---------- Boot ----------
function renderAll() { renderVerdicts(); renderList(); renderRollup(); renderDossier(); renderTraceList(); drawMap(); }
async function boot() {
  const [status, geo, examples] = await Promise.all([api("/api/status"), api("/api/geo"), api("/api/examples")]);
  Object.assign(S, { status, geo, examples });
  renderEngines(); renderToolbar(); resize();
  await loadRunsList();
  const want = new URLSearchParams(location.search).get("run");
  if (want) await loadRun(want);
  else { renderAll(); }
  setInterval(async () => { try { S.status = await api("/api/status"); renderEngines(); } catch {} }, 30_000);
}
boot().catch((e) => { $("#dossier").innerHTML = `<div class="explain">Couldn't reach the SkyLedger server (${esc(e.message)}). Start it with <span class="mono">npm start</span>.</div>`; });
