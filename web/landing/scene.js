// SkyLedger landing: the single global WebGL scene. Built only from /api/geo and /api/stats data.
// Exports createScene(canvas, CONFIG, geo, stats, opts) -> { setState, resize, start, stop, renderOnce, project }
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ---------- shaders ----------
const SOURCES_VS = /* glsl */ `
attribute float aSize;
attribute float aPersist;
attribute float aSeed;
attribute float aPhase;
uniform float uTime;
uniform float uPR;
uniform float uScale;
uniform float uLift;
uniform float uFocus;
uniform float uScan;
uniform float uIntro;
uniform float uDim;
uniform float uRise;
uniform float uMaxPx;
uniform vec3 uFocusPos;
varying float vAlpha;
varying float vHeat;
varying float vScan;
void main() {
  vec3 p = position;
  float rising = step(0.0, aPhase);
  float t = fract(uTime * (0.035 + 0.05 * aSeed) + aPhase);
  float h = uRise * (0.25 + 1.1 * aSize);
  p.y += rising * t * h;
  p.x += rising * sin(t * 6.2831 + aSeed * 20.0) * 0.035 * t;
  p.z += rising * cos(t * 5.0 + aSeed * 13.0) * 0.035 * t;
  p.y += uLift;
  float fl = 0.5 + 0.5 * sin(uTime * (1.3 + aSeed * 3.0) + aSeed * 40.0);
  float steady = mix(0.25 + 0.75 * fl * fl, 1.0, clamp(aPersist * 1.6, 0.0, 1.0));
  float fade = mix(1.0, smoothstep(0.0, 0.18, t) * (1.0 - t), rising);
  float d = distance(position.xz, uFocusPos.xz);
  float focusMask = mix(1.0, 0.04 + 0.96 * smoothstep(0.24, 0.0, d), uFocus);
  float scan = exp(-pow((position.x - uScan) * 2.2, 2.0));
  vScan = scan;
  vHeat = aSize;
  vAlpha = (0.28 + 0.72 * aSize) * steady * fade * focusMask * uIntro * (1.0 - 0.75 * uDim);
  vAlpha *= mix(1.0, 0.5, rising) * (1.0 + 1.6 * scan);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float sz = (2.2 + 9.0 * aSize) * mix(1.0, 0.55, rising);
  float att = pow(uScale / max(-mv.z, 0.05), 0.6);
  gl_PointSize = clamp(sz * att * uPR, 1.0, uMaxPx * uPR);
  gl_Position = projectionMatrix * mv;
}`;

const SOURCES_FS = /* glsl */ `
uniform vec3 uAmber;
uniform vec3 uMagenta;
uniform vec3 uHot;
varying float vAlpha;
varying float vHeat;
varying float vScan;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;
  float g = exp(-r2 * 16.0) - 0.018;
  float core = exp(-r2 * 90.0);
  vec3 col = mix(uAmber, uMagenta, smoothstep(0.25, 0.95, vHeat));
  col = mix(col, uHot, clamp(core * 0.55 + vScan * 0.25, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(g * vAlpha, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

const FAC_VS = /* glsl */ `
attribute float aKind;
attribute float aRep;
uniform float uPR;
uniform float uScale;
uniform float uIntro;
uniform float uDim;
uniform float uFocus;
uniform float uMaxPx;
uniform vec3 uFocusPos;
varying float vKind;
varying float vAlpha;
void main() {
  vKind = aKind;
  float d = distance(position.xz, uFocusPos.xz);
  float focusMask = mix(1.0, 0.1 + 0.9 * smoothstep(0.35, 0.0, d), uFocus);
  vAlpha = mix(0.95, 0.4, aKind) * uIntro * focusMask * (1.0 - 0.7 * uDim);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float sz = mix(3.0 + 3.0 * aRep, 10.0, aKind);
  float att = pow(uScale / max(-mv.z, 0.05), 0.6);
  gl_PointSize = clamp(sz * att * uPR, 1.5, uMaxPx * uPR);
  gl_Position = projectionMatrix * mv;
}`;

const FAC_FS = /* glsl */ `
uniform vec3 uCyan;
varying float vKind;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float dotA = smoothstep(0.5, 0.15, r);
  float ring = smoothstep(0.06, 0.0, abs(r - 0.38));
  float a = mix(dotA, ring, vKind);
  gl_FragColor = vec4(uCyan, a * vAlpha);
  #include <colorspace_fragment>
}`;

const GROUND_VS = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GROUND_FS = /* glsl */ `
uniform vec2 uCenter;   // lon, lat
uniform vec2 uK;        // world units per degree (x, z)
uniform vec2 uHalf;     // half extents of the bbox in world units
uniform float uScan;
uniform float uIntro;
uniform float uDim;
uniform vec3 uGridCol;
uniform vec3 uScanCol;
varying vec3 vW;
float gridLine(vec2 coord, float spacing) {
  vec2 q = coord / spacing;
  vec2 fw = fwidth(q);
  vec2 g = abs(fract(q - 0.5) - 0.5) / max(fw, vec2(1e-4));
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  // fade lines out once they get denser than a few pixels apart (prevents a grey moire haze far away)
  return line * (1.0 - smoothstep(0.08, 0.35, max(fw.x, fw.y)));
}
void main() {
  vec2 lonlat = vec2(uCenter.x + vW.x / uK.x, uCenter.y - vW.z / uK.y);
  float major = gridLine(lonlat, 0.5);
  float minor = gridLine(lonlat, 0.1);
  vec2 inside2 = smoothstep(uHalf + 0.9, uHalf - 0.2, abs(vW.xz));
  float inside = inside2.x * inside2.y;
  float far = smoothstep(uHalf.x * 1.6, uHalf.x * 0.4, length(vW.xz));
  float a = (major * 0.22 + minor * 0.07) * mix(0.35, 1.0, inside) * far;
  // bbox border
  vec2 e = abs(abs(vW.xz) - uHalf);
  float border = (1.0 - smoothstep(0.0, 0.03, min(e.x, e.y))) * step(abs(vW.x), uHalf.x + 0.03) * step(abs(vW.z), uHalf.y + 0.03);
  a += border * 0.25;
  // satellite scan line with a short afterglow trail
  float dx = vW.x - uScan;
  float scanLine = exp(-dx * dx * 260.0);
  float trail = smoothstep(-2.4, 0.0, dx) * step(dx, 0.0) * 0.12;
  float sc = (scanLine * 0.3 + trail * (major + minor + 0.04)) * inside;
  vec3 col = uGridCol * a + uScanCol * sc;
  float alpha = clamp(a + sc, 0.0, 1.0) * uIntro * (1.0 - 0.6 * uDim);
  gl_FragColor = vec4(col / max(alpha, 1e-3), alpha);
  #include <colorspace_fragment>
}`;

const LEDGER_FS = /* glsl */ `
uniform vec2 uHalf;
uniform float uSep;
uniform vec3 uCol;
varying vec3 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 q = vW.xz;
  vec2 cell = vec2(1.6, 0.34);
  vec2 id = floor(q / cell);
  vec2 f = fract(q / cell);
  vec2 w = fwidth(q / cell);
  float rows = 1.0 - smoothstep(0.0, w.y * 1.5, f.y);
  float cols = (1.0 - smoothstep(0.0, w.x * 1.5, f.x)) * 0.6;
  float h = hash(id);
  float ink = step(0.55, h) * smoothstep(0.15, 0.2, f.y) * smoothstep(0.75, 0.7, f.y)
            * smoothstep(0.08, 0.12, f.x) * smoothstep(0.2 + 0.7 * h, 0.15 + 0.7 * h, f.x);
  vec2 inside2 = smoothstep(uHalf + 0.2, uHalf - 0.6, abs(q));
  float a = (rows * 0.16 + cols * 0.08 + ink * 0.06) * inside2.x * inside2.y * uSep;
  gl_FragColor = vec4(uCol, a);
  #include <colorspace_fragment>
}`;

const RING_FS = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uPulse;
uniform vec3 uCol;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.06, 0.0, abs(r - 0.82));
  float pr = fract(uTime * 0.45);
  float pulse = smoothstep(0.05, 0.0, abs(r - pr)) * (1.0 - pr) * uPulse;
  float core = smoothstep(0.25, 0.0, r) * 0.5 * uPulse;
  float a = clamp(ring * 0.8 + pulse + core, 0.0, 1.0) * uAlpha;
  gl_FragColor = vec4(uCol, a);
  #include <colorspace_fragment>
}`;
const RING_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const PLUME_VS = /* glsl */ `
attribute float aSeed;
attribute float aSeed2;
uniform float uTime;
uniform float uPR;
uniform float uAlpha;
uniform float uLen;
uniform vec3 uOrigin;
uniform vec2 uDir;
varying float vA;
void main() {
  float t = fract(uTime * 0.11 + aSeed);
  vec2 perp = vec2(-uDir.y, uDir.x);
  float spread = (aSeed2 - 0.5) * 0.55 * t * uLen + sin(t * 9.0 + aSeed * 30.0) * 0.06 * uLen * t;
  vec2 xz = uOrigin.xz + uDir * t * uLen + perp * spread;
  vec3 p = vec3(xz.x, uOrigin.y + t * uLen * 0.12, xz.y);
  vA = smoothstep(0.0, 0.08, t) * (1.0 - t) * uAlpha;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp((3.0 + 10.0 * t) * uPR * pow(0.4 / max(-mv.z, 0.02), 0.6), 1.0, 40.0 * uPR);
  gl_Position = projectionMatrix * mv;
}`;
const PLUME_FS = /* glsl */ `
uniform vec3 uCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;
  gl_FragColor = vec4(uCol, (exp(-r2 * 14.0) - 0.03) * vA);
  #include <colorspace_fragment>
}`;

// ---------- helpers ----------
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

export function createScene(canvas, CONFIG, geo, stats, opts) {
  const { mobile, reduced } = opts;
  const C = CONFIG.scene;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, alpha: false, powerPreference: "high-performance" });
  const dpr = Math.min(window.devicePixelRatio || 1, mobile ? C.dprMobile : C.dprMax);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Clear to pure black: black is identical in every colour space, so the composer path (linear render
  // target + OutputPass) and the direct path match. A non-black clear colour came out grey via the composer.
  renderer.setClearColor(0x000000, 1);
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    console.error('[skyledger] shader error', gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs), gl.getProgramInfoLog(program));
    if (opts.onError) opts.onError(new Error('shader compile failed'));
  };

  const scene = new THREE.Scene();
  scene.fog = null;
  const camera = new THREE.PerspectiveCamera(C.fov, window.innerWidth / window.innerHeight, 0.005, 300);

  // ----- projection lon/lat -> world -----
  const bbox = geo && geo.bbox ? geo.bbox : { west: -1, east: 1, south: -1, north: 1 };
  const cLon = (bbox.west + bbox.east) / 2;
  const cLat = (bbox.south + bbox.north) / 2;
  const cosLat = Math.cos((cLat * Math.PI) / 180);
  const kz = C.worldWidth / ((bbox.east - bbox.west) * cosLat);
  const kx = kz * cosLat;
  const toWorld = (lon, lat, y = 0) => new THREE.Vector3((lon - cLon) * kx, y, -(lat - cLat) * kz);
  const half = new THREE.Vector2(((bbox.east - bbox.west) * kx) / 2, ((bbox.north - bbox.south) * kz) / 2);

  const col = (hex) => new THREE.Color(hex); // sRGB hex -> linear working space
  const U = {
    uTime: { value: 0 }, uPR: { value: dpr }, uScale: { value: C.pointScale }, uLift: { value: 0 },
    uFocus: { value: 0 }, uScan: { value: -half.x }, uIntro: { value: reduced ? 1 : 0 }, uDim: { value: 0 },
    uFocusPos: { value: new THREE.Vector3(0, 0, 0) }, uMaxPx: { value: C.maxPointPx }, uRise: { value: C.riseHeight },
  };

  // ----- ground grid -----
  const groundGeo = new THREE.PlaneGeometry(half.x * 2 * 2.2, half.y * 2 * 2.2, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.ShaderMaterial({
    vertexShader: GROUND_VS, fragmentShader: GROUND_FS, transparent: true, depthWrite: false,
    uniforms: {
      uCenter: { value: new THREE.Vector2(cLon, cLat) }, uK: { value: new THREE.Vector2(kx, kz) }, uHalf: { value: half },
      uScan: U.uScan, uIntro: U.uIntro, uDim: U.uDim,
      uGridCol: { value: col(CONFIG.colors.grid) }, uScanCol: { value: col(CONFIG.colors.cyan) },
    },
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.renderOrder = 0;
  scene.add(ground);

  // ----- ledger plane (owners), only visible while layers separate -----
  const ledgerGeo = new THREE.PlaneGeometry(half.x * 2, half.y * 2, 1, 1);
  ledgerGeo.rotateX(-Math.PI / 2);
  const uSep = { value: 0 };
  const ledgerMat = new THREE.ShaderMaterial({
    vertexShader: GROUND_VS, fragmentShader: LEDGER_FS, transparent: true, depthWrite: false,
    uniforms: { uHalf: { value: half }, uSep, uCol: { value: col(CONFIG.colors.ledger) } },
  });
  const ledger = new THREE.Mesh(ledgerGeo, ledgerMat);
  ledger.visible = false;
  scene.add(ledger);

  // ----- methane sources (one Points draw call) -----
  const sources = (geo && Array.isArray(geo.sources)) ? geo.sources : [];
  const fieldIdx = (fields, name, dflt) => { const i = Array.isArray(fields) ? fields.indexOf(name) : -1; return i >= 0 ? i : dflt; };
  const sF = geo ? geo.source_fields : null;
  const iLon = fieldIdx(sF, "lon", 0), iLat = fieldIdx(sF, "lat", 1), iE = fieldIdx(sF, "emission_kgph", 2), iP = fieldIdx(sF, "persistence", 3);
  let maxE = 1;
  for (const s of sources) if (typeof s[iE] === "number" && s[iE] > maxE) maxE = s[iE];
  const risers = mobile ? C.risersMobile : C.risersDesktop;
  const per = 1 + risers;
  const nPts = sources.length * per;
  const sPos = new Float32Array(nPts * 3), sSize = new Float32Array(nPts), sPer = new Float32Array(nPts), sSeed = new Float32Array(nPts), sPh = new Float32Array(nPts);
  let k = 0;
  for (const s of sources) {
    const w = toWorld(s[iLon], s[iLat], 0.015);
    const e = typeof s[iE] === "number" ? s[iE] : null;
    const size = e === null ? 0.06 : Math.log10(1 + e) / Math.log10(1 + maxE);
    const persist = typeof s[iP] === "number" ? s[iP] : 0;
    const seed = Math.random();
    for (let j = 0; j < per; j++) {
      sPos[k * 3] = w.x; sPos[k * 3 + 1] = w.y; sPos[k * 3 + 2] = w.z;
      sSize[k] = size; sPer[k] = persist; sSeed[k] = (seed + j * 0.137) % 1;
      sPh[k] = j === 0 ? -1 : (j - 1) / risers + Math.random() * 0.15;
      k++;
    }
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute("aSize", new THREE.BufferAttribute(sSize, 1));
  sGeo.setAttribute("aPersist", new THREE.BufferAttribute(sPer, 1));
  sGeo.setAttribute("aSeed", new THREE.BufferAttribute(sSeed, 1));
  sGeo.setAttribute("aPhase", new THREE.BufferAttribute(sPh, 1));
  const sMat = new THREE.ShaderMaterial({
    vertexShader: SOURCES_VS, fragmentShader: SOURCES_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { ...U, uAmber: { value: col(CONFIG.colors.amber) }, uMagenta: { value: col(CONFIG.colors.magenta) }, uHot: { value: col(CONFIG.colors.hot) } },
  });
  const srcPoints = new THREE.Points(sGeo, sMat);
  srcPoints.frustumCulled = false;
  srcPoints.renderOrder = 3;
  scene.add(srcPoints);

  // ----- EPA facilities: points + pin lines -----
  const facs = (geo && Array.isArray(geo.facilities)) ? geo.facilities : [];
  const fF = geo ? geo.facility_fields : null;
  const fLon = fieldIdx(fF, "lon", 0), fLat = fieldIdx(fF, "lat", 1), fKind = fieldIdx(fF, "kind", 2), fRep = fieldIdx(fF, "reported_t_ch4", 3), fName = fieldIdx(fF, "name", 4);
  let maxR = 1;
  for (const f of facs) if (typeof f[fRep] === "number" && f[fRep] > maxR) maxR = f[fRep];
  const fPos = new Float32Array(facs.length * 3), fK = new Float32Array(facs.length), fR = new Float32Array(facs.length);
  const pinPos = [];
  facs.forEach((f, i) => {
    const basin = f[fKind] === "basin_aggregate";
    const rep = typeof f[fRep] === "number" ? Math.log10(1 + f[fRep]) / Math.log10(1 + maxR) : 0;
    const h = basin ? 0.004 : C.pinHeight * (0.35 + 0.65 * rep);
    const w = toWorld(f[fLon], f[fLat], 0.006);
    fPos[i * 3] = w.x; fPos[i * 3 + 1] = w.y; fPos[i * 3 + 2] = w.z;
    fK[i] = basin ? 1 : 0; fR[i] = rep;
    if (!basin) pinPos.push(w.x, 0.006, w.z, w.x, h, w.z);
  });
  const fGeo = new THREE.BufferGeometry();
  fGeo.setAttribute("position", new THREE.BufferAttribute(fPos, 3));
  fGeo.setAttribute("aKind", new THREE.BufferAttribute(fK, 1));
  fGeo.setAttribute("aRep", new THREE.BufferAttribute(fR, 1));
  const fMat = new THREE.ShaderMaterial({
    vertexShader: FAC_VS, fragmentShader: FAC_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPR: U.uPR, uScale: U.uScale, uIntro: U.uIntro, uDim: U.uDim, uFocus: U.uFocus, uFocusPos: U.uFocusPos, uMaxPx: U.uMaxPx, uCyan: { value: col(CONFIG.colors.cyan) } },
  });
  const facPoints = new THREE.Points(fGeo, fMat);
  facPoints.frustumCulled = false;
  facPoints.renderOrder = 2;
  scene.add(facPoints);
  const pinGeo = new THREE.BufferGeometry();
  pinGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pinPos), 3));
  const pinMat = new THREE.LineBasicMaterial({ color: col(CONFIG.colors.cyan), transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
  const pins = new THREE.LineSegments(pinGeo, pinMat);
  pins.frustumCulled = false;
  scene.add(pins);

  // ----- stars (decorative, desktop only) -----
  if (!mobile) {
    const n = C.stars, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.9), r = 120 + Math.random() * 60;
      p[i * 3] = r * Math.sin(ph) * Math.cos(th); p[i * 3 + 1] = r * Math.cos(ph) * 0.6 + 10; p[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({ color: col("#9fb2c9"), size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.45, depthWrite: false });
    scene.add(new THREE.Points(g, m));
  }

  // ----- featured plume -----
  const f = stats && stats.featured ? stats.featured : null;
  const featured = { ok: false, pos: new THREE.Vector3(), dir: new THREE.Vector2(0, 1), candidates: [] };
  const focusObjs = [];
  let plumeMat = null, arrow = null;
  if (f && typeof f.lat === "number" && typeof f.lon === "number") {
    featured.ok = true;
    featured.pos.copy(toWorld(f.lon, f.lat, 0.01));
    U.uFocusPos.value.copy(featured.pos);
    // plume drifts toward wind_from + 180 (meteorological convention). world x = east, world z = -north.
    if (typeof f.wind_from_deg === "number") {
      const toRad = ((f.wind_from_deg + 180) * Math.PI) / 180;
      featured.dir.set(Math.sin(toRad), -Math.cos(toRad));
    }
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    const mkRing = (pos, size, hex, pulse) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: U.uTime, uAlpha: { value: 0 }, uPulse: { value: pulse ? 1 : 0 }, uCol: { value: col(hex) } },
      });
      const mesh = new THREE.Mesh(ringGeo, m);
      mesh.position.copy(pos); mesh.position.y = 0.004; mesh.scale.setScalar(size);
      mesh.renderOrder = 4; mesh.visible = false;
      scene.add(mesh); focusObjs.push(mesh);
      return mesh;
    };
    mkRing(featured.pos, C.featureRing, CONFIG.colors.magenta, true);
    // candidate facilities, located by name in the geo payload (nearest match to the plume)
    const cands = Array.isArray(f.candidates) ? f.candidates : [];
    for (const c of cands) {
      let best = null, bestD = Infinity;
      for (const fa of facs) {
        if (fa[fName] !== c.name) continue;
        const w = toWorld(fa[fLon], fa[fLat], 0.01);
        const d = w.distanceTo(featured.pos);
        if (d < bestD) { bestD = d; best = w; }
      }
      if (best && bestD < 1.0) {
        mkRing(best, C.candRing, CONFIG.colors.cyan, false);
        featured.candidates.push({ name: c.name, dist_m: c.dist_m, pos: best });
      }
    }
    // drifting plume particles
    const n = mobile ? 220 : 520;
    const a1 = new Float32Array(n), a2 = new Float32Array(n), pp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a1[i] = Math.random(); a2[i] = Math.random(); pp[i * 3] = featured.pos.x; pp[i * 3 + 2] = featured.pos.z; }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(pp, 3));
    pg.setAttribute("aSeed", new THREE.BufferAttribute(a1, 1));
    pg.setAttribute("aSeed2", new THREE.BufferAttribute(a2, 1));
    plumeMat = new THREE.ShaderMaterial({
      vertexShader: PLUME_VS, fragmentShader: PLUME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.uTime, uPR: U.uPR, uAlpha: { value: 0 }, uLen: { value: C.plumeLength }, uOrigin: { value: featured.pos.clone() }, uDir: { value: featured.dir.clone() }, uCol: { value: col(CONFIG.colors.magenta) } },
    });
    const plume = new THREE.Points(pg, plumeMat);
    plume.frustumCulled = false; plume.renderOrder = 5; plume.visible = false;
    scene.add(plume); focusObjs.push(plume);
    // wind arrow: starts upwind and points downwind, ending near the source
    const d3 = new THREE.Vector3(featured.dir.x, 0, featured.dir.y).normalize();
    const start = featured.pos.clone().addScaledVector(d3, -C.arrowLength * 1.25);
    start.y = 0.02;
    arrow = new THREE.ArrowHelper(d3, start, C.arrowLength, col(CONFIG.colors.cyan), C.arrowLength * 0.28, C.arrowLength * 0.16);
    arrow.traverse((o) => { if (o.material) { o.material.transparent = true; o.material.opacity = 0; o.material.depthWrite = false; } });
    arrow.visible = false;
    scene.add(arrow);
  }

  // ----- post -----
  let composer = null, bloom = null;
  if (!mobile && C.bloom.enabled) {
    try {
      composer = new EffectComposer(renderer);
      composer.setPixelRatio(dpr);
      composer.setSize(window.innerWidth, window.innerHeight);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), C.bloom.strength, C.bloom.radius, C.bloom.threshold);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    } catch (e) { console.warn("[skyledger] bloom disabled:", e); composer = null; }
  }

  // ----- camera keyframes (scene states) -----
  const fp = featured.ok ? featured.pos : new THREE.Vector3();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const S = (name, pos, tgt, extra = {}) => ({ name, pos, tgt, sep: 0, focus: 0, dim: 0, shift: (C.shift && typeof C.shift[name] === "number") ? C.shift[name] : 0, ...extra });
  const K = C.keys;
  const near = (o) => fp.clone().add(V(o[0], o[1], o[2]));
  const states = {
    hero: S("hero", V(...K.hero.pos), V(...K.hero.tgt)),
    layers: S("layers", V(...K.layers.pos), V(...K.layers.tgt), { sep: 1 }),
    dive: featured.ok ? S("dive", near(K.dive.pos), near(K.dive.tgt), { focus: 1 }) : S("dive", V(...K.hero.pos), V(...K.hero.tgt)),
    pipeline: featured.ok ? S("pipeline", near(K.pipeline.pos), near(K.pipeline.tgt), { focus: 1 }) : S("pipeline", V(...K.hero.pos), V(...K.hero.tgt), { dim: 0.4 }),
    skeptic: featured.ok ? S("skeptic", near(K.skeptic.pos), near(K.skeptic.tgt), { focus: 1 }) : S("skeptic", V(...K.hero.pos), V(...K.hero.tgt), { dim: 0.4 }),
    result: featured.ok ? S("result", near(K.result.pos), near(K.result.tgt), { focus: 0.85 }) : S("result", V(...K.hero.pos), V(...K.hero.tgt), { dim: 0.4 }),
    evidence: S("evidence", V(...K.evidence.pos), V(...K.evidence.tgt), { dim: 0.35 }),
    built: S("built", V(...K.built.pos), V(...K.built.tgt), { dim: 0.45 }),
    cta: S("cta", V(...K.cta.pos), V(...K.cta.tgt), { dim: 0.15 }),
  };

  // current blended state
  const cur = { pos: states.hero.pos.clone(), tgt: states.hero.tgt.clone(), sep: 0, focus: 0, dim: 0, shift: states.hero.shift };
  const offA = new THREE.Vector3(), offB = new THREE.Vector3();
  function setBlend(a, b, t) {
    const A = states[a] || states.hero, B = states[b] || A;
    const e = smooth(Math.min(Math.max(t, 0), 1));
    cur.tgt.lerpVectors(A.tgt, B.tgt, e);
    // offset: blend direction linearly, length in log space (a smooth zoom across scales)
    offA.subVectors(A.pos, A.tgt); offB.subVectors(B.pos, B.tgt);
    const la = offA.length(), lb = offB.length();
    const len = Math.exp(lerp(Math.log(la), Math.log(lb), e));
    offA.normalize(); offB.normalize();
    const dir = offA.lerp(offB, e).normalize();
    cur.pos.copy(cur.tgt).addScaledVector(dir, len);
    cur.sep = lerp(A.sep, B.sep, e); cur.focus = lerp(A.focus, B.focus, e); cur.dim = lerp(A.dim, B.dim, e); cur.shift = lerp(A.shift, B.shift, e);
  }

  // ----- mouse parallax -----
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  if (!reduced && !mobile) {
    window.addEventListener("pointermove", (ev) => {
      mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (ev.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  // ----- loop -----
  const clock = new THREE.Clock();
  let running = false, raf = 0, t0 = reduced ? C.staticTime : 0;
  const camPos = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let introStart = performance.now();

  function update(dt) {
    if (!reduced) t0 += dt;
    U.uTime.value = t0;
    if (!reduced) {
      const it = Math.min((performance.now() - introStart) / (C.introSeconds * 1000), 1);
      U.uIntro.value = smooth(it);
    }
    const W = half.x * 2;
    U.uScan.value = -half.x * 1.15 + ((t0 / C.scanSeconds) % 1) * W * 1.3;
    // blended scene parameters
    U.uLift.value = cur.sep * C.layerGap;
    uSep.value = cur.sep;
    ledger.visible = cur.sep > 0.01;
    ledger.position.y = -cur.sep * C.layerGap;
    U.uFocus.value = cur.focus;
    U.uDim.value = cur.dim;
    pinMat.opacity = 0.32 * U.uIntro.value * (1 - 0.7 * cur.dim) * (1 - 0.8 * cur.focus);
    const fa = Math.max(0, (cur.focus - 0.3) / 0.7);
    for (const o of focusObjs) {
      o.visible = fa > 0.01;
      if (o.material && o.material.uniforms && o.material.uniforms.uAlpha) o.material.uniforms.uAlpha.value = fa;
    }
    if (arrow) {
      arrow.visible = fa > 0.01;
      arrow.traverse((o) => { if (o.material) o.material.opacity = fa * 0.9; });
    }
    // camera + parallax + idle drift
    mouse.sx += (mouse.x - mouse.sx) * 0.05;
    mouse.sy += (mouse.y - mouse.sy) * 0.05;
    camPos.copy(cur.pos);
    const dist = cur.pos.distanceTo(cur.tgt);
    right.subVectors(cur.pos, cur.tgt).cross(up).normalize();
    const drift = reduced ? 0 : Math.sin(t0 * 0.12) * C.idleDrift;
    camPos.addScaledVector(right, (mouse.sx * C.parallax + drift) * dist);
    camPos.y += -mouse.sy * C.parallax * 0.6 * dist;
    camera.position.copy(camPos);
    camera.lookAt(cur.tgt);
    // shift the projection centre so 3D content sits beside the text column, not under it
    const vw = window.innerWidth, vh = window.innerHeight;
    const sh = vw < 900 ? 0 : cur.shift;
    if (Math.abs(sh) > 1e-4) camera.setViewOffset(vw, vh, -sh * vw, 0, vw, vh);
    else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  }

  function render() {
    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (opts.onFrame) opts.onFrame();
    update(dt);
    render();
    if (opts.afterFrame) opts.afterFrame();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
    if (bloom) bloom.resolution.set(w, h);
    if (reduced) renderOnce();
  }
  function renderOnce() { update(0); render(); if (opts.afterFrame) opts.afterFrame(); }

  const tmp = new THREE.Vector3();
  function project(v) {
    tmp.copy(v).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * window.innerWidth, y: (-tmp.y * 0.5 + 0.5) * window.innerHeight, visible: tmp.z < 1 && tmp.z > -1 };
  }

  return {
    featured, half, layerGap: C.layerGap, cur,
    setBlend,
    resize, renderOnce, project,
    start() { if (running || reduced) return; running = true; clock.getDelta(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    restartIntro() { introStart = performance.now(); },
  };
}
