// SkyLedger landing page. Vanilla ES modules, no build step.
// Every figure on the page is read at runtime from /api/geo and /api/stats. If a fetch fails, the
// figures are hidden (never invented) and the copy stays readable.
import Lenis from "/vendor/lenis/lenis.mjs";

// ---------------------------------------------------------------- CONFIG (all tunables live here)
export const CONFIG = {
  api: { geo: "/api/geo", stats: "/api/stats", timeoutMs: 8000 },
  breakpoints: { mobile: 760 },
  colors: {
    bg: "#05070b", amber: "#ffb547", magenta: "#ff4fa3", hot: "#fff1d6", cyan: "#5fe1ff",
    grid: "#3b5770", ledger: "#cfdbe8",
  },
  verdicts: {
    inconsistent_with_report: { label: "Inconsistent with report", color: "#ff4fa3" },
    consistent_with_report: { label: "Consistent with report", color: "#6ee7a8" },
    unreported_source: { label: "No reporting facility at the plume head", color: "#ffb547" },
    attribution_uncertain: { label: "Attribution uncertain", color: "#9b8cff" },
    insufficient_sightings: { label: "Too few sightings to annualize", color: "#6b7787" },
    coverage_gap: { label: "Coverage gap", color: "#5fe1ff" },
    dropped_quality: { label: "Dropped on data quality", color: "#3d4654" },
  },
  rivalQuestions: {
    R1: "Could a neighbouring facility be the real source?",
    R2: "Was it a one-off release rather than a persistent one?",
    R3: "Is the site outside the GHGRP reporting obligation?",
    R4: "Does the source fall in a category the report does not cover?",
    R5: "Is the measurement itself too uncertain to use?",
  },
  sendBackTargets: ["GeoLinker", "PlumeReader", "Reconciler"],
  motion: { lerp: 0.085, hold: 0.18, revealY: 28, counterSeconds: 1.8, flipStaggerMs: 380 },
  scene: {
    worldWidth: 20, fov: 38, dprMax: 1.75, dprMobile: 1.5,
    pointScale: 16, maxPointPx: 40, riseHeight: 0.55, risersDesktop: 4, risersMobile: 1,
    pinHeight: 0.32, stars: 1400, layerGap: 3.2,
    featureRing: 0.05, candRing: 0.028, plumeLength: 0.035, arrowLength: 0.03,
    scanSeconds: 11, introSeconds: 2.6, staticTime: 4.2, parallax: 0.035, idleDrift: 0.025,
    bloom: { enabled: true, strength: 0.55, radius: 0.2, threshold: 0.4 },
    // camera keyframes: hero/layers/evidence/built/cta are absolute world coords;
    // dive/pipeline/skeptic/result are offsets from the featured plume
    keys: {
      hero: { pos: [0, 8.2, 15.5], tgt: [0, -1.4, 0.6] },
      layers: { pos: [-17, 4.2, 15.5], tgt: [0, -0.2, 0] },
      dive: { pos: [-0.17, 0.2, 0.19], tgt: [-0.035, 0, 0.025] },
      pipeline: { pos: [-0.22, 0.42, 0.5], tgt: [0, 0, 0] },
      skeptic: { pos: [0.02, 0.36, 0.1], tgt: [0, 0, 0] },
      result: { pos: [0.34, 0.3, 0.52], tgt: [0, 0.02, 0] },
      evidence: { pos: [0, 26, 2.6], tgt: [0, 0, 0] },
      built: { pos: [12, 5, 13], tgt: [0, 0, 0] },
      cta: { pos: [0, 2.6, 16], tgt: [0, 1.1, 0] },
    },
    // horizontal projection shift per scene (fraction of viewport width; + moves 3D content right)
    shift: { hero: 0.2, layers: 0.24, dive: 0.0, pipeline: 0.25, skeptic: 0.28, result: 0.26, evidence: 0, built: 0, cta: 0 },
  },
};

// ---------------------------------------------------------------- environment
// optional debug switch for comparing looks: ?bloom=0
if (new URLSearchParams(location.search).get("bloom") === "0") CONFIG.scene.bloom.enabled = false;
const root = document.documentElement;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = window.innerWidth < CONFIG.breakpoints.mobile;
const finePointer = window.matchMedia("(pointer: fine)").matches;
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const hasGsap = !!(gsap && ScrollTrigger);
const animate = hasGsap && !reduced;
if (hasGsap) gsap.registerPlugin(ScrollTrigger);

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const fmt = (n) => (typeof n === "number" && isFinite(n) ? Math.round(n).toLocaleString("en-US") : null);
const isNum = (n) => typeof n === "number" && isFinite(n);
const fmtKm = (m) => {
  if (!isNum(m)) return null;
  const km = m / 1000;
  return `${Number.isInteger(km) ? String(km) : String(Number(km.toFixed(1)))} km`;
};
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (n, cap) => { const w = WORDS[n] ?? String(n); return cap ? w[0].toUpperCase() + w.slice(1) : w; };
const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------- data
async function getJSON(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CONFIG.api.timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn("[skyledger] data unavailable:", url, e && e.message);
    return null;
  } finally { clearTimeout(timer); }
}

function setBind(key, value) {
  for (const el of $$(`[data-bind="${key}"]`)) el.textContent = value;
}
function group(name, ok) {
  for (const el of $$(`[data-group="${name}"]`)) el.classList.toggle("missing", !ok);
}

function bindData(geo, stats) {
  const f = stats && stats.featured;
  // hero + region
  const region = (geo && geo.region) || (stats && stats.data && stats.data.region);
  if (region) setBind("region", region);
  group("region", !!region);
  const year = (geo && geo.ghgrp_year) || (stats && stats.data && stats.data.ghgrp_year);
  if (year) setBind("ghgrpYear", String(year));
  const okGeo = !!(geo && Array.isArray(geo.sources) && Array.isArray(geo.facilities) && year);
  if (okGeo) { setBind("geoSources", fmt(geo.sources.length)); setBind("geoFacilities", fmt(geo.facilities.length)); }
  group("geo", okGeo);

  // agents + rivals counts as words in headlines (fallback words stay if missing)
  const agents = stats && Array.isArray(stats.agents) ? stats.agents : [];
  if (agents.length) setBind("agentLine", `${word(agents.length, true)} agents.`);
  const rivals = f && Array.isArray(f.rivals) ? f.rivals : [];
  if (rivals.length) setBind("rivalWord", word(rivals.length, false));

  // featured plume
  const okF = !!(f && f.plume_id && isNum(f.rate_kgph));
  group("featured", okF);
  if (okF) {
    setBind("fId", f.plume_id);
    setBind("fPlatform", f.platform || "");
    setBind("fDate", f.scene_date || "");
    setBind("fRate", fmt(f.rate_kgph));
    setBind("fFacility", f.facility || "");
    if (isNum(f.reported_tch4)) setBind("fReported", fmt(f.reported_tch4));
    if (isNum(f.wind_from_deg)) {
      setBind("fWindFrom", fmt(f.wind_from_deg));
      setBind("fWindTo", fmt((f.wind_from_deg + 180) % 360));
      // arrow glyph points the way the gas travels (toward wind_from + 180), north up
      const arrow = $("#windArrow");
      if (arrow) arrow.style.transform = `rotate(${(f.wind_from_deg + 180) % 360}deg)`;
    }
    if (isNum(f.wind_speed_ms)) setBind("fWindSpeed", f.wind_speed_ms.toFixed(1));
    const img = $("#fImage");
    if (img && f.image) {
      img.src = "/" + String(f.image).replace(/^\/+/, "");
      img.alt = `Carbon Mapper quicklook image of methane plume ${f.plume_id}, ${f.platform || ""}, ${f.scene_date || ""}`;
      img.addEventListener("error", () => { const q = img.closest(".quicklook"); if (q) q.classList.add("missing", "dg"); }, { once: true });
    }
    const ul = $("#candidates");
    const cands = Array.isArray(f.candidates) ? f.candidates : [];
    ul.innerHTML = cands.map((c) => `<li><span>${esc(c.name)}<span class="kind">${esc(String(c.kind || "").replace("_", " "))}</span></span><span class="dist">${isNum(c.dist_m) ? fmt(c.dist_m) + " m" : ""}</span></li>`).join("");
    if (!cands.length) $(".candidates").classList.add("dg", "missing");
  }
  const parents = f && Array.isArray(f.parents) ? f.parents.filter(Boolean) : [];
  if (parents.length) setBind("fParents", parents.join(", "));
  group("featuredParents", okF && parents.length > 0);

  buildPipeline(agents);
  group("agents", agents.length > 0);
  buildRivals(rivals);
  group("rivals", rivals.length > 0);
  const okResult = buildResult(f, year);
  group("result", okResult);
  buildEvidence(stats);
  // a story section whose every panel lost its data collapses instead of leaving an empty screen
  for (const sec of $$("main section.story")) {
    const panels = $$(".panel", sec);
    sec.hidden = panels.length > 0 && panels.every((p) => p.classList.contains("missing") || p.querySelector(".dg.missing") === p);
  }
}

function buildPipeline(agents) {
  const ol = $("#pipeline");
  if (!ol || !agents.length) return;
  ol.style.setProperty("--n", agents.length);
  ol.innerHTML = agents.map((a, i) => `
    <li class="agent${a.name === "Skeptic" ? " skeptic" : ""}" data-agent="${esc(a.name)}">
      <span class="agent-n">${String(i + 1).padStart(2, "0")}</span>
      <h3>${esc(a.name).replace(/([a-z])([A-Z])/g, "$1<wbr>$2")}</h3>
      <p>${esc(a.role || "")}</p>
    </li>`).join("");
}

function drawArcs() {
  const svg = $("#pipelineArcs"), ol = $("#pipeline");
  if (!svg || !ol) return;
  const sk = ol.querySelector('[data-agent="Skeptic"]');
  if (!sk || getComputedStyle(svg).display === "none") { svg.innerHTML = ""; return; }
  const box = svg.getBoundingClientRect();
  const sb = sk.getBoundingClientRect();
  const xs = sb.left + sb.width / 2 - box.left, y0 = sb.top - box.top - 4;
  let html = `<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${CONFIG.colors.magenta}" stroke="none"/></marker></defs>`;
  let maxSpan = 0, label = null;
  for (const name of CONFIG.sendBackTargets) {
    const t = ol.querySelector(`[data-agent="${name}"]`);
    if (!t) continue;
    const tb = t.getBoundingClientRect();
    const xt = tb.left + tb.width / 2 - box.left;
    const span = Math.abs(xs - xt);
    const h = Math.min(30 + span * 0.28, y0 - 8);
    html += `<path class="arc" pathLength="1" d="M${xs.toFixed(1)},${y0.toFixed(1)} C${xs.toFixed(1)},${(y0 - h).toFixed(1)} ${xt.toFixed(1)},${(y0 - h).toFixed(1)} ${xt.toFixed(1)},${y0.toFixed(1)}" marker-end="url(#ah)"/>`;
    if (span > maxSpan) { maxSpan = span; label = { x: (xs + xt) / 2, y: y0 - h * 0.75 - 6 }; }
  }
  if (label) html += `<text x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" text-anchor="middle">Skeptic sends work back</text>`;
  svg.innerHTML = html;
  if (!animate) svg.classList.add("drawn");
  if (animate) for (const p of $$(".arc", svg)) { p.style.strokeDasharray = "1"; p.style.strokeDashoffset = String(1 - arcProgress); }
}
let arcProgress = 0;

function buildRivals(rivals) {
  const ul = $("#rivals");
  if (!ul || !rivals.length) return;
  const S = { ruled_out: ["✓", "Ruled out"], flagged: ["⚠", "Flagged"], failed: ["✗", "Not ruled out"] };
  const sorted = rivals.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), "en", { numeric: true }));
  ul.style.setProperty("--n", sorted.length);
  ul.innerHTML = sorted.map((r) => {
    const s = S[r.status] || ["?", String(r.status || "unknown").replace(/_/g, " ")];
    const q = CONFIG.rivalQuestions[r.id] || "";
    return `<li class="rival s-${esc(r.status)}">
      <div class="rival-inner">
        <div class="rival-face rival-front" aria-hidden="true">
          <span class="rival-id">${esc(r.id)}</span><h3>${esc(r.name)}</h3><p>${esc(q)}</p><span class="testing">Testing…</span>
        </div>
        <div class="rival-face rival-back">
          <span class="rival-id">${esc(r.id)} · ${esc(r.name)}</span>
          <span class="status"><i aria-hidden="true">${s[0]}</i>${esc(s[1])}</span>
          <p class="note">${esc(r.note || "")}</p>
          <p>${esc(q)}</p>
        </div>
      </div></li>`;
  }).join("");
  if (!animate) ul.classList.add("static");
}

function buildResult(f, year) {
  if (!f || !Array.isArray(f.implied_tch4) || f.implied_tch4.length < 2 || !isNum(f.reported_tch4)) return false;
  const [lo, hi] = f.implied_tch4, rep = f.reported_tch4;
  if (!isNum(lo) || !isNum(hi)) return false;
  setBind("fImplied", `${fmt(lo)}–${fmt(hi)}`);
  const ratio = Array.isArray(f.ratio) && f.ratio.length >= 2 && isNum(f.ratio[0]) && isNum(f.ratio[1]) ? f.ratio : null;
  if (ratio) setBind("fRatio", `${fmt(ratio[0])}–${fmt(ratio[1])}`);
  else { const r = $(".ratio"); if (r) r.classList.add("dg", "missing"); }

  const max = Math.max(hi, rep) * 1.08;
  const fill = $("#rangeFill"), mark = $("#rangeMark"), bar = $("#rangebar");
  fill.dataset.left = String((lo / max) * 100);
  fill.dataset.width = String(((hi - lo) / max) * 100);
  fill.style.left = fill.dataset.left + "%";
  fill.style.width = fill.dataset.width + "%";
  mark.style.left = ((rep / max) * 100) + "%";
  const lblImp = $("#lblImp");
  if (lblImp) { lblImp.style.right = "auto"; lblImp.style.left = `min(${(lo / max) * 100}%, calc(100% - 16em))`; }
  bar.setAttribute("aria-label", `Implied ${fmt(lo)} to ${fmt(hi)} tonnes of methane per year, against ${fmt(rep)} tonnes reported`);

  const s = f.sightings || {};
  const seen = isNum(s.detections) && isNum(s.observations) && s.from && s.to
    ? `Seen on <b>${fmt(s.detections)} of ${fmt(s.observations)}</b> overpass dates between ${esc(s.from)} and ${esc(s.to)}, the plume implies `
    : "The sightings imply ";
  let verdict;
  if (lo > rep) verdict = `Even the lower bound is ${ratio ? `<b>${fmt(ratio[0])}×</b> ` : "above "}the report, which is <b>inconsistent with available data</b>.`;
  else if (hi < rep) verdict = "The whole range sits below the report, which is consistent with available data.";
  else verdict = "The range overlaps the report, so it is not flagged.";
  $("#guarded").innerHTML = `${seen}<b>${fmt(lo)}–${fmt(hi)} t CH₄ per year</b>. ${esc(f.facility || "The facility")} reported <b>${fmt(rep)} t CH₄</b>${year ? ` for RY${esc(year)}` : ""}. ${verdict} This is a draft for an analyst to review, not a finding of wrongdoing.`;
  return true;
}

function buildEvidence(stats) {
  const okStats = !!(stats && stats.data && stats.run && stats.eval && stats.eval.label_free);
  group("stats", okStats);
  const farKm = stats && stats.eval ? fmtKm(stats.eval.far_m) : null;
  if (farKm) setBind("farKm", farKm);
  else {
    for (const el of $$('[data-bind="farKm"]')) {
      const wrap = el.closest(".counter") || el;
      wrap.classList.add("dg", "missing");
    }
  }
  if (okStats) {
    for (const el of $$("[data-count]")) {
      const v = get(stats, el.dataset.count);
      if (isNum(v)) { el.dataset.value = String(v); el.textContent = fmt(v); }
      else { const c = el.closest(".counter, .versus-side"); if (c) c.classList.add("dg", "missing"); }
    }
  }
  // run mode, honestly stated
  const run = stats && stats.run;
  if (run && isNum(run.plumes)) {
    const sql = run.sql_live ? "SQL answered live through Zetaris" : "SQL answered from the cached sample data";
    const models = run.models_live ? "model steps run live" : "model steps use deterministic stand-ins";
    $("#runMode").textContent = `These numbers come from run ${run.run_id || ""} over ${fmt(run.plumes)} plumes: ${sql}, ${models}. Anyone can reproduce them offline from the repository.`;
    group("runMode", true);
  } else group("runMode", false);
  // verdict breakdown
  const sum = run && run.summary && typeof run.summary === "object" ? run.summary : null;
  const entries = sum ? Object.entries(sum).filter(([, v]) => isNum(v) && v > 0) : [];
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (entries.length && total > 0) {
    const order = Object.keys(CONFIG.verdicts);
    entries.sort((a, b) => (order.indexOf(a[0]) + 99 * (order.indexOf(a[0]) < 0)) - (order.indexOf(b[0]) + 99 * (order.indexOf(b[0]) < 0)));
    const meta = (k) => CONFIG.verdicts[k] || { label: k.replace(/_/g, " "), color: "#6b7787" };
    $("#verdictBar").innerHTML = entries.map(([k, v]) => `<span style="width:${(v / total) * 100}%;background:${meta(k).color}"></span>`).join("");
    $("#verdictLegend").innerHTML = entries.map(([k, v]) => `<li><i style="background:${meta(k).color}"></i><b>${fmt(v)}</b>${esc(meta(k).label)}</li>`).join("");
    group("verdicts", true);
  } else group("verdicts", false);
  // labelled eval, honestly stated
  const ev = stats && stats.eval;
  if (ev && isNum(ev.labelled)) {
    $("#labelNote").textContent = ev.labelled > 0
      ? (ev.skyledger && ev.baseline_a
        ? `On ${fmt(ev.labelled)} hand-labelled plumes, nearest-facility matching blamed the wrong facility ${fmt(ev.baseline_a.wrong_blame_pct)}% of the time; SkyLedger ${fmt(ev.skyledger.wrong_blame_pct)}%. A small sanity check labelled by the team, not expert ground truth (eval/results.md).`
        : `Hand-labelled results are in eval/results.md in the repository.`)
      : "These are label-free diagnostics. A hand-labelled accuracy table has not been published yet.";
    group("labels", true);
  } else group("labels", false);
}

// ---------------------------------------------------------------- smooth scroll
let lenis = null;
function initScroll() {
  if (!reduced) {
    try {
      lenis = new Lenis({ lerp: CONFIG.motion.lerp, smoothWheel: true });
      if (hasGsap) {
        lenis.on("scroll", ScrollTrigger.update);
        gsap.ticker.add((time) => lenis.raf(time * 1000));
        gsap.ticker.lagSmoothing(0);
      } else {
        const loop = (t) => { lenis.raf(t); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
      }
    } catch (e) { console.warn("[skyledger] smooth scroll off:", e); lenis = null; }
  }
  for (const a of $$('a[href^="#"]')) {
    a.addEventListener("click", (ev) => {
      const id = a.getAttribute("href");
      const target = id === "#top" ? 0 : $(id);
      if (target === null) return;
      ev.preventDefault();
      if (lenis) lenis.scrollTo(target, { duration: 1.6 });
      else if (target === 0) window.scrollTo(0, 0);
      else target.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
      if (target !== 0 && target.focus) { target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); }
    });
  }
  const nav = $("#nav");
  const onScroll = () => {
    nav.classList.toggle("scrolled", window.scrollY > 40);
    // reduced motion keeps a static scene, so dim it behind the reading sections instead of flying the camera
    if (reduced) root.classList.toggle("past-hero", window.scrollY > window.innerHeight * 0.6);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

// ---------------------------------------------------------------- animations
function heroIntro() {
  if (!animate) return;
  gsap.from(".hero-title .line > span", { yPercent: 115, duration: 1.3, ease: "power4.out", stagger: 0.09, delay: 0.15 });
  gsap.from(".hero .reveal", { y: CONFIG.motion.revealY, opacity: 0, duration: 1.1, ease: "power3.out", stagger: 0.1, delay: 0.55 });
  gsap.from(".nav", { y: -20, opacity: 0, duration: 1, ease: "power3.out", delay: 0.3 });
}

function initAnimations() {
  if (!animate) return;
  for (const h of $$(".split")) {
    gsap.from($$(".line > span", h), { yPercent: 115, duration: 1.15, ease: "power4.out", stagger: 0.08, scrollTrigger: { trigger: h, start: "top 86%" } });
  }
  for (const el of $$("main .reveal").filter((e) => !e.closest(".hero"))) {
    gsap.from(el, { y: CONFIG.motion.revealY, opacity: 0, duration: 1.1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 90%" } });
  }
  // counters
  for (const el of $$("[data-count]")) {
    const v = Number(el.dataset.value);
    if (!isFinite(v)) continue;
    const o = { n: 0 };
    el.textContent = "0";
    ScrollTrigger.create({
      trigger: el, start: "top 88%", once: true,
      onEnter: () => gsap.to(o, { n: v, duration: CONFIG.motion.counterSeconds, ease: "power2.out", onUpdate: () => { el.textContent = fmt(o.n); } }),
    });
  }
  // rival flips, one by one
  const rivals = $$(".rival");
  if (rivals.length) {
    ScrollTrigger.create({
      trigger: "#rivals", start: "top 72%", once: true,
      onEnter: () => rivals.forEach((r, i) => setTimeout(() => r.classList.add("flipped"), 500 + i * CONFIG.motion.flipStaggerMs)),
    });
  }
  // pipeline: agents light up in sequence, then the Skeptic's send-back arcs draw
  const agents = $$(".agent");
  if (agents.length) {
    ScrollTrigger.create({
      trigger: ".pipeline-wrap", start: "top 85%", end: "bottom 70%", scrub: true,
      onUpdate: (st) => {
        const lit = Math.floor(st.progress * (agents.length + 1.5));
        agents.forEach((a, i) => a.classList.toggle("lit", i < lit));
        const sk = agents.findIndex((a) => a.dataset.agent === "Skeptic");
        const arcT = sk >= 0 ? Math.min(Math.max((st.progress * (agents.length + 1.5) - (sk + 1)) / 1.5, 0), 1) : 0;
        arcProgress = arcT;
        const svgEl = $("#pipelineArcs"); if (svgEl) svgEl.classList.toggle("drawn", arcT > 0.9);
        for (const p of $$("#pipelineArcs .arc")) p.style.strokeDashoffset = String(1 - arcT);
      },
    });
  }
  // range bar grows from the reported mark
  const fill = $("#rangeFill");
  if (fill && fill.dataset.width) {
    gsap.fromTo(fill, { width: "0%" }, { width: fill.dataset.width + "%", duration: 1.8, ease: "power3.inOut", scrollTrigger: { trigger: "#rangebar", start: "top 82%" } });
  }
  const vb = $$("#verdictBar span");
  if (vb.length) gsap.from(vb, { scaleX: 0, duration: 1.2, ease: "power3.out", stagger: 0.08, scrollTrigger: { trigger: "#verdictBar", start: "top 88%" } });
}

function staticState() {
  for (const a of $$(".agent")) a.classList.add("lit");
  for (const r of $$(".rival")) r.classList.add("flipped");
}

// ---------------------------------------------------------------- cursor
function initCursor() {
  if (reduced || mobile || !finePointer) return;
  const c = $("#cursor");
  if (!c) return;
  root.classList.add("has-cursor");
  let x = -100, y = -100, sx = x, sy = y, on = false;
  window.addEventListener("pointermove", (e) => { x = e.clientX; y = e.clientY; if (!on) { on = true; sx = x; sy = y; c.classList.add("on"); } }, { passive: true });
  document.addEventListener("pointerleave", () => { on = false; c.classList.remove("on"); });
  document.addEventListener("pointerover", (e) => { c.classList.toggle("hover", !!e.target.closest("a, button")); });
  const loop = () => { sx += (x - sx) * 0.25; sy += (y - sy) * 0.25; c.style.transform = `translate3d(${sx}px, ${sy}px, 0)`; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- WebGL scene + scroll choreography
let sceneApi = null;
function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(window.WebGL2RenderingContext && c.getContext("webgl2")); } catch { return false; }
}
function fallback(reason) {
  if (reason) console.warn("[skyledger] static hero:", reason);
  root.classList.add("no-webgl");
  if (sceneApi) { try { sceneApi.stop(); } catch {} }
  sceneApi = null;
  const a = $("#anchors"); if (a) a.innerHTML = "";
}

function sceneAnchors() {
  // scroll positions at which each [data-scene] section is centred in the viewport
  const vh = window.innerHeight;
  return $$("[data-scene]").filter((el) => !el.hidden).map((el, i) => {
    const r = el.getBoundingClientRect();
    const top = r.top + window.scrollY;
    const y = i === 0 ? 0 : Math.max(0, top + r.height / 2 - vh / 2);
    return { name: el.dataset.scene, y };
  });
}

async function initScene(geo, stats) {
  const canvas = $("#gl");
  if (!canvas || !webglAvailable()) return fallback("WebGL2 unavailable");
  let createScene;
  try { ({ createScene } = await import("/landing/scene.js")); } catch (e) { return fallback(e); }
  let anchors = [];
  const labels = [];
  try {
    sceneApi = createScene(canvas, CONFIG, geo, stats, {
      mobile, reduced,
      onError: (e) => fallback(e),
      onFrame: () => {
        if (reduced || !anchors.length) return;
        const y = window.scrollY;
        let i = 0;
        while (i < anchors.length - 1 && y >= anchors[i + 1].y) i++;
        const a = anchors[i], b = anchors[Math.min(i + 1, anchors.length - 1)];
        let t = b.y > a.y ? (y - a.y) / (b.y - a.y) : 0;
        const h = CONFIG.motion.hold;
        t = Math.min(Math.max((t - h) / (1 - 2 * h), 0), 1);
        sceneApi.setBlend(a.name, b.name, t);
      },
      afterFrame: () => {
        for (const l of labels) {
          const alpha = l.alpha();
          if (alpha < 0.01) { if (l.shown) { l.el.style.opacity = "0"; l.shown = false; } continue; }
          const p = sceneApi.project(l.pos());
          if (!p.visible) { l.el.style.opacity = "0"; l.shown = false; continue; }
          l.el.style.opacity = String(alpha);
          l.el.style.transform = `translate3d(${(p.x + l.dx).toFixed(1)}px, ${(p.y + l.dy).toFixed(1)}px, 0)`;
          l.shown = true;
        }
      },
    });
  } catch (e) { return fallback(e); }
  if (!sceneApi) return;

  // projected labels (decorative duplicates of DOM copy; aria-hidden container)
  if (!mobile && !reduced) {
    const box = $("#anchors");
    const mk = (cls, html, pos, alpha, dx = 12, dy = -8) => {
      const el = document.createElement("div");
      el.className = "anchor " + cls; el.innerHTML = html; box.appendChild(el);
      labels.push({ el, pos, alpha, dx, dy, shown: false });
    };
    const H = sceneApi.half, G = sceneApi.layerGap, cur = sceneApi.cur;
    mk("sky", "Sky<small>plumes · kg/h on one morning</small>", () => new DOMVec(H.x, cur.sep * G, -H.y), () => cur.sep);
    mk("ground", "Ground<small>facilities · t CO₂e per year</small>", () => new DOMVec(H.x, 0, -H.y), () => cur.sep);
    mk("ledger", "Ledger<small>owners · free-text strings</small>", () => new DOMVec(H.x, -cur.sep * G, -H.y), () => cur.sep);
    const fe = sceneApi.featured;
    const f = stats && stats.featured;
    if (fe.ok && f) {
      const fa = () => Math.max(0, (cur.focus - 0.5) / 0.5);
      mk("plume", `Plume<small>${isNum(f.rate_kgph) ? fmt(f.rate_kgph) + " kg/h · " : ""}${esc(f.scene_date || "")}</small>`, () => fe.pos, fa, -150, -64);
      for (const c of fe.candidates) {
        mk("cand", `${esc(c.name)}<small>${isNum(c.dist_m) ? fmt(c.dist_m) + " m from the plume head" : ""}</small>`, () => c.pos, fa);
      }
    }
  }

  const refresh = () => { anchors = sceneAnchors(); };
  refresh();
  window.addEventListener("resize", () => { sceneApi && sceneApi.resize(); refresh(); drawArcs(); });
  if (hasGsap) ScrollTrigger.addEventListener("refresh", refresh);
  window.addEventListener("load", refresh);
  document.addEventListener("visibilitychange", () => { if (!sceneApi) return; if (document.hidden) sceneApi.stop(); else sceneApi.start(); });

  if (reduced) { sceneApi.setBlend("hero", "hero", 0); sceneApi.renderOnce(); }
  else { sceneApi.restartIntro(); sceneApi.start(); }
}

// tiny Vector3-compatible object so project() can copy() it without importing three here
class DOMVec { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }

// ---------------------------------------------------------------- boot
async function boot() {
  root.classList.add("js");
  heroIntro();
  initScroll();
  initCursor();
  const [geo, stats] = await Promise.all([getJSON(CONFIG.api.geo), getJSON(CONFIG.api.stats)]);
  try { bindData(geo, stats); } catch (e) { console.error("[skyledger] binding failed", e); }
  drawArcs();
  if (animate) initAnimations(); else staticState();
  initScene(geo, stats).catch((e) => fallback(e));
  if (hasGsap) requestAnimationFrame(() => ScrollTrigger.refresh());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { drawArcs(); if (hasGsap) ScrollTrigger.refresh(); });
}
boot();
