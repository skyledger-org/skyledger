// Labelling page: one plume at a time, one question. Answers go to POST /api/labels (eval/labels.csv).
// The queue (/api/label/queue) carries plume facts and nearby facilities only, never SkyLedger's verdicts.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const LETTERS = "ABCDEFGH";
const ANSWER_TEXT = { none: "None of these", ambiguous: "Not sure" };

const S = { q: null, labels: {}, target: 0, i: 0, view: "intro" };

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

const batch = () => S.q.plumes.slice(0, S.target);
const doneCount = () => batch().filter((p) => S.labels[p.plume_id]).length;
const firstOpen = () => { const i = batch().findIndex((p) => !S.labels[p.plume_id]); return i < 0 ? null : i; };
const sites = (p) => p.facilities.filter((f) => f.kind === "point").sort((a, b) => a.dist_m - b.dist_m).slice(0, LETTERS.length);

function show(view) {
  S.view = view;
  for (const id of ["intro", "card", "done", "empty"]) $("#" + id).hidden = id !== view;
  $("#progress").hidden = view === "intro" || view === "empty";
  progress();
  window.scrollTo({ top: 0 });
}

function progress() {
  if (!S.q) return;
  const n = doneCount(), t = batch().length;
  $("#progress-text").textContent = `${n} of ${t} done`;
  $("#progress-bar").style.width = `${t ? (100 * n) / t : 0}%`;
}

function distWords(m) {
  if (m <= S.q.near_m) return { t: "right at the start", c: "near" };
  if (m <= S.q.far_m) return { t: "nearby", c: "" };
  return { t: "far away", c: "far" };
}

function renderCard() {
  const p = batch()[S.i];
  if (!p) return finish();
  const list = sites(p), cur = S.labels[p.plume_id]?.label;
  $("#qcount").textContent = `Plume ${S.i + 1} of ${batch().length}`;
  $("#meta").textContent = `${p.platform} · ${p.date} · ${fmt(p.rate_kgph)} kg/h · ${p.plume_id}`;
  $("#calm").hidden = !(p.wind_speed_ms == null || p.wind_speed_ms < S.q.calm_ms);
  $("#cap-basin").hidden = !p.facilities.some((f) => f.kind !== "point");
  $("#options").innerHTML =
    list.map((f, k) => {
      const w = distWords(f.dist_m), out = !inImage(p, f);
      return `<button class="opt ${cur === f.id ? "on" : ""}" role="radio" aria-checked="${cur === f.id}" data-l="${esc(f.id)}" data-key="${LETTERS[k]}">
        <span class="key">${LETTERS[k]}</span>
        <span class="nm" title="${esc(f.name)}">${esc(f.name)}<span class="sub">${fmt(f.dist_m)} m from the ✚${out ? " · outside the picture, at its edge" : ""}</span></span>
        <span class="chip ${w.c}">${w.t}</span></button>`;
    }).join("") +
    `<div class="lb-sep"></div>
    <button class="opt ${cur === "none" ? "on" : ""}" role="radio" aria-checked="${cur === "none"}" data-l="none" data-key="N"><span class="key alt">N</span><span class="nm">None of these<span class="sub">No facility sits at the ✚</span></span><span></span></button>
    <button class="opt ${cur === "ambiguous" ? "on" : ""}" role="radio" aria-checked="${cur === "ambiguous"}" data-l="ambiguous" data-key="S"><span class="key alt">?</span><span class="nm">Not sure<span class="sub">Two look equally likely, or the picture is unclear</span></span><span></span></button>`;
  document.querySelectorAll(".opt").forEach((b) => (b.onclick = () => answer(p, b)));
  $("#prev").disabled = S.i === 0;
  drawImage($("#img"), p, list);
  progress();
}

async function answer(p, btn) {
  document.querySelectorAll(".opt").forEach((b) => b.classList.toggle("on", b === btn));
  try {
    await api("/api/labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plume_id: p.plume_id, label: btn.dataset.l }) });
  } catch {
    btn.classList.remove("on");
    alert("Couldn't save that answer. Is the server still running?");
    return;
  }
  S.labels[p.plume_id] = { label: btn.dataset.l };
  progress();
  setTimeout(() => next(), 260);
}

function next() {
  const open = batch().findIndex((p, k) => k > S.i && !S.labels[p.plume_id]);
  if (open >= 0) { S.i = open; return renderCard(); }
  const any = firstOpen();
  if (any != null) { S.i = any; return renderCard(); }
  finish();
}

function finish() {
  show("done");
  const n = doneCount();
  $("#done-title").textContent = `${n} plume${n === 1 ? "" : "s"} labelled. Thank you.`;
  $("#more").hidden = S.target >= S.q.plumes.length;
  $("#review").innerHTML = batch().map((p, k) => {
    const l = S.labels[p.plume_id]?.label;
    const txt = !l ? "Skipped" : ANSWER_TEXT[l] ?? p.facilities.find((f) => f.id === l)?.name ?? l;
    return `<li><button data-i="${k}"><span class="mono">${k + 1}. ${esc(p.plume_id)}</span>${esc(txt)}</button></li>`;
  }).join("");
  document.querySelectorAll("#review button").forEach((b) => (b.onclick = () => { S.i = Number(b.dataset.i); show("card"); renderCard(); }));
}

// ---------- Picture ----------
const SCALE = 4;
function project(p, lat, lon, W, H) {
  const b = p.bounds;
  return [((lon - b[0]) / (b[2] - b[0])) * W, ((b[3] - lat) / (b[3] - b[1])) * H];
}
function inImage(p, f) {
  if (!p.bounds) return false;
  const [x, y] = project(p, f.lat, f.lon, 1, 1);
  return x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

function drawImage(cv, p, list) {
  const g = cv.getContext("2d");
  const img = new Image();
  img.onload = () => {
    cv.width = img.width * SCALE; cv.height = img.height * SCALE;
    const W = cv.width, H = cv.height;
    g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, W, H);
    if (!p.bounds) return;
    const pad = 16, clamp = (v, m) => Math.max(pad, Math.min(m - pad, v));
    // Basin-level reports first, so site dots sit on top.
    for (const f of p.facilities.filter((f) => f.kind !== "point")) {
      let [x, y] = project(p, f.lat, f.lon, W, H); x = clamp(x, W); y = clamp(y, H);
      g.fillStyle = "#9aa6bb"; g.strokeStyle = "#000"; g.lineWidth = 2; g.beginPath(); g.rect(x - 6, y - 6, 12, 12); g.fill(); g.stroke();
    }
    list.forEach((f, k) => {
      let [x, y] = project(p, f.lat, f.lon, W, H);
      const out = x < 0 || y < 0 || x > W || y > H; x = clamp(x, W); y = clamp(y, H);
      g.fillStyle = "#46e0ff"; g.strokeStyle = "#000"; g.lineWidth = 2.5;
      g.beginPath(); out ? g.roundRect(x - 13, y - 13, 26, 26, 6) : g.arc(x, y, 13, 0, 6.283); g.fill(); g.stroke();
      g.fillStyle = "#05070b"; g.font = "700 15px 'Space Grotesk Variable', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(LETTERS[k], x, y + 1);
    });
    // Where the plume starts: a crosshair with an open centre, so a facility dot under it stays readable.
    const [ox, oy] = project(p, p.origin[0], p.origin[1], W, H), a = 17, b = 30;
    for (const [c, w] of [["#000", 7], ["#fff", 3.5]]) {
      g.strokeStyle = c; g.lineWidth = w; g.lineCap = "butt"; g.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.moveTo(ox + dx * a, oy + dy * a); g.lineTo(ox + dx * b, oy + dy * b); }
      g.stroke();
    }
    // Wind arrow (points the way the wind blows), in a badge top-left.
    if (p.wind_from_deg != null) {
      const cx = 44, cy = 44, R = 34;
      g.fillStyle = "rgba(5,7,11,.72)"; g.beginPath(); g.arc(cx, cy, R + 6, 0, 6.283); g.fill();
      const to = ((p.wind_from_deg + 180) * Math.PI) / 180, L = R * 1.4;
      const ex = cx + (Math.sin(to) * L) / 2, ey = cy - (Math.cos(to) * L) / 2, sx = cx - (Math.sin(to) * L) / 2, sy = cy + (Math.cos(to) * L) / 2;
      g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineWidth = 4; g.lineCap = "round"; g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
      g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - Math.sin(to - 0.5) * 14, ey + Math.cos(to - 0.5) * 14); g.lineTo(ex - Math.sin(to + 0.5) * 14, ey + Math.cos(to + 0.5) * 14); g.closePath(); g.fill();
      g.font = "600 12px 'JetBrains Mono', monospace"; g.textAlign = "center"; g.textBaseline = "alphabetic";
      g.fillStyle = "rgba(5,7,11,.72)"; g.fillRect(cx - 34, cy + R + 10, 68, 18); g.fillStyle = "#fff";
      g.fillText(`wind ${(p.wind_speed_ms ?? 0).toFixed(1)} m/s`, cx, cy + R + 23);
    }
  };
  img.src = "/" + p.image;
}

// ---------- Keys ----------
document.addEventListener("keydown", (e) => {
  if (S.view !== "card" || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toUpperCase();
  const btn = [...document.querySelectorAll(".opt")].find((b) => b.dataset.key === k);
  if (btn) { e.preventDefault(); btn.click(); }
  else if (e.key === "ArrowLeft") $("#prev").click();
  else if (e.key === "ArrowRight") $("#skip").click();
});

$("#prev").onclick = () => { if (S.i > 0) { S.i--; renderCard(); } };
$("#skip").onclick = () => { if (S.i < batch().length - 1) { S.i++; renderCard(); } else finish(); };
$("#start").onclick = () => { try { localStorage.setItem("sl-label-intro", "1"); } catch {} begin(); };
$("#howto-link").onclick = (e) => { e.preventDefault(); show("intro"); };
$("#more").onclick = () => { S.target = Math.min(S.q.plumes.length, S.target + 10); begin(); };

function begin() {
  const i = firstOpen();
  if (i == null) return finish();
  S.i = i; show("card"); renderCard();
}

async function init() {
  try {
    [S.q, S.labels] = await Promise.all([api("/api/label/queue"), api("/api/labels")]);
  } catch {
    $("#empty").textContent = "Couldn't reach the SkyLedger server. Start it with npm start, then reload this page.";
    return show("empty");
  }
  if (!S.q.plumes.length) { $("#empty").textContent = "No saved run to label yet. Run the agents once in the analyst console, then come back."; return show("empty"); }
  S.target = Math.min(S.q.plumes.length, S.q.batch);
  $("#intro-note").textContent = `${S.target} plumes in this batch · your answers save as you go, so you can stop any time.`;
  let seen = false; try { seen = !!localStorage.getItem("sl-label-intro"); } catch {}
  seen || new URLSearchParams(location.search).has("start") ? begin() : show("intro");
}
init();
