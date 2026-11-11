/* Precision Landing Lab: pure helpers for the 3D city scene.
 *
 * No DOM and no three.js in this file. It is shared by the browser
 * (window.PLVWorldCore) and the node tests (require). Everything here works in
 * the city frame of viewer/scene/city.json: ENU metres, x = east, y = north,
 * z = up, origin = pad centre at street level.
 */
(function (root) {
  'use strict';

  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const FACADES = ['glass', 'office', 'brick', 'concrete'];

  /* ---------- deterministic random ---------- */
  /** mulberry32: small seeded PRNG, returns a function giving [0, 1). */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- city.json validation ---------- */
  function rect(r, where) {
    if (!Array.isArray(r) || r.length !== 4 || !r.every(isNum) || !(r[2] > r[0]) || !(r[3] > r[1])) {
      throw new Error(where + ': footprint must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0');
    }
    return r.slice();
  }

  /** Validate a parsed city.json and return a normalised copy (see scene/README.md). */
  function parseCity(obj) {
    if (!isObj(obj)) throw new Error('city.json: expected a JSON object');
    if (obj.schema_version !== 1) throw new Error('city.json: unsupported schema_version ' + JSON.stringify(obj.schema_version));
    const st = obj.streets;
    if (!isObj(st)) throw new Error('city.json: missing "streets"');
    const streets = {
      pitch: st.pitch, offset: st.offset, road_width: st.road_width, lanes: st.lanes | 0,
      sidewalk_width: st.sidewalk_width, curb_height: isNum(st.curb_height) ? st.curb_height : 0.15, extent: st.extent | 0,
    };
    if (!Array.isArray(streets.pitch) || streets.pitch.length !== 2 || !streets.pitch.every((p) => isNum(p) && p > 0)) throw new Error('city.json: streets.pitch must be [px, py] > 0');
    if (!Array.isArray(streets.offset) || streets.offset.length !== 2 || !streets.offset.every(isNum)) throw new Error('city.json: streets.offset must be [x, y]');
    if (!isNum(streets.road_width) || !isNum(streets.sidewalk_width) || streets.road_width <= 0 || streets.sidewalk_width < 0) throw new Error('city.json: bad road_width / sidewalk_width');
    if (streets.road_width + 2 * streets.sidewalk_width >= Math.min(streets.pitch[0], streets.pitch[1])) throw new Error('city.json: streets leave no room for blocks');
    if (streets.lanes < 1 || streets.extent < 0 || streets.extent > 6) throw new Error('city.json: lanes >= 1 and 0 <= extent <= 6');

    if (!Array.isArray(obj.buildings) || !obj.buildings.length) throw new Error('city.json: "buildings" must be a non-empty array');
    const ids = new Set();
    const buildings = obj.buildings.map((b, i) => {
      const w = 'city.json: buildings[' + i + ']';
      if (!isObj(b) || typeof b.id !== 'string' || !b.id) throw new Error(w + ': needs a string id');
      if (ids.has(b.id)) throw new Error(w + ': duplicate id ' + b.id);
      ids.add(b.id);
      if (!isNum(b.height) || b.height <= 0 || b.height > 500) throw new Error(w + ': height must be in (0, 500] m');
      const facade = b.facade === undefined ? 'office' : b.facade;
      if (!FACADES.includes(facade)) throw new Error(w + ': facade must be one of ' + FACADES.join(', '));
      const setbacks = (b.setbacks || []).map((s, k) => {
        if (!isObj(s) || !isNum(s.at) || !isNum(s.inset) || s.inset <= 0 || s.at <= 0 || s.at >= b.height) throw new Error(w + '.setbacks[' + k + ']: needs 0 < at < height and inset > 0');
        return { at: s.at, inset: s.inset };
      }).sort((a, c) => a.at - c.at);
      return { id: b.id, footprint: rect(b.footprint, w), height: b.height, facade, setbacks, role: b.role || null };
    });

    const v = obj.vertiport;
    if (!isObj(v)) throw new Error('city.json: missing "vertiport"');
    const host = buildings.find((b) => b.id === v.building);
    if (!host) throw new Error('city.json: vertiport.building must name a building id');
    const pad = v.pad || {};
    if (![pad.x, pad.y, pad.z].every(isNum)) throw new Error('city.json: vertiport.pad needs x, y, z');
    const deck = isNum(v.deck_height) ? v.deck_height : 0.9;
    if (Math.abs(host.height + deck - pad.z) > 0.05) throw new Error('city.json: vertiport.pad.z must equal building height + deck_height');
    const fp = host.footprint;
    if (pad.x <= fp[0] || pad.x >= fp[2] || pad.y <= fp[1] || pad.y >= fp[3]) throw new Error('city.json: the pad must lie inside the vertiport building footprint');
    const sizes = { tlof: v.tlof || 1, fato: v.fato || 2, safety_area: v.safety_area || 3 };
    if (!(sizes.tlof < sizes.fato && sizes.fato < sizes.safety_area)) throw new Error('city.json: need tlof < fato < safety_area');
    const wind = v.wind || {};
    const vertiport = {
      building: host.id, pad: { x: pad.x, y: pad.y, z: pad.z, yaw_deg: isNum(pad.yaw_deg) ? pad.yaw_deg : 0 },
      deck_height: deck, tlof: sizes.tlof, fato: sizes.fato, safety_area: sizes.safety_area,
      net_width: isNum(v.net_width) ? v.net_width : 0.5,
      parapet: Object.assign({ height: 1.0, thickness: 0.3 }, v.parapet || {}),
      stair_tower: v.stair_tower ? { footprint: rect(v.stair_tower.footprint, 'vertiport.stair_tower'), height: v.stair_tower.height || 3, floodlights: v.stair_tower.floodlights | 0 } : null,
      hvac: (v.hvac || []).map((h, k) => ({ footprint: rect(h.footprint, 'vertiport.hvac[' + k + ']'), height: h.height || 1.5 })),
      windsock: v.windsock ? Object.assign({ mast_height: 1.2, length: 0.4 }, v.windsock) : null,
      wind: { from_deg: isNum(wind.from_deg) ? wind.from_deg : 0, speed_mps: isNum(wind.speed_mps) ? wind.speed_mps : 0 },
      approach_from_deg: isNum(v.approach_from_deg) ? v.approach_from_deg : 180,
    };
    return {
      schema_version: 1, name: obj.name || '', streets, buildings, vertiport,
      plaza: obj.plaza ? { footprint: rect(obj.plaza.footprint, 'plaza'), trees: obj.plaza.trees | 0 } : null,
      street_trees: Object.assign({ spacing: 10, extent: 1 }, obj.street_trees || {}),
      street_lights: Object.assign({ spacing: 28, extent: 1, height: 7 }, obj.street_lights || {}),
      context: obj.context ? Object.assign({ seed: 1, extent: streets.extent, min_height: 10, max_height: 45, tower_chance: 0.1, tower_height: 70 }, obj.context) : null,
    };
  }

  /* ---------- street grid ---------- */
  /** Street centrelines: {xs: [...] (N-S streets), ys: [...] (E-W streets)}. */
  function streetLines(city) {
    const s = city.streets, xs = [], ys = [];
    for (let k = -s.extent; k <= s.extent + 1; k++) { xs.push(s.offset[0] + k * s.pitch[0]); ys.push(s.offset[1] + k * s.pitch[1]); }
    return { xs, ys };
  }

  /** City blocks between streets: [{i, j, outer: [x0,y0,x1,y1] (curb edge), inner: [...] (building line)}]. */
  function cityBlocks(city) {
    const s = city.streets, L = streetLines(city), hw = s.road_width / 2, sw = s.sidewalk_width, out = [];
    for (let i = 0; i < L.xs.length - 1; i++) for (let j = 0; j < L.ys.length - 1; j++) {
      const outer = [L.xs[i] + hw, L.ys[j] + hw, L.xs[i + 1] - hw, L.ys[j + 1] - hw];
      out.push({ i: i - s.extent, j: j - s.extent, outer, inner: [outer[0] + sw, outer[1] + sw, outer[2] - sw, outer[3] - sw] });
    }
    return out;
  }

  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

  /** Stacked boxes for one building: [{x0,y0,x1,y1,z0,z1}], narrowing at each setback. */
  function buildingTiers(b) {
    const out = [];
    let f = b.footprint.slice(), z0 = 0;
    const cuts = (b.setbacks || []).concat([{ at: b.height, inset: 0 }]);
    for (const c of cuts) {
      if (c.at > z0) out.push({ x0: f[0], y0: f[1], x1: f[2], y1: f[3], z0, z1: c.at });
      z0 = c.at;
      const nf = [f[0] + c.inset, f[1] + c.inset, f[2] - c.inset, f[3] - c.inset];
      if (nf[2] - nf[0] >= 2 && nf[3] - nf[1] >= 2) f = nf; // ignore a setback that leaves < 2 m
    }
    return out;
  }

  /**
   * Visual-only filler buildings for every block (inside streets.extent / context.extent)
   * that holds no listed building. Deterministic for a given seed.
   */
  function contextBuildings(city) {
    const c = city.context;
    if (!c) return [];
    const R = rng(c.seed), out = [];
    const listed = city.buildings.map((b) => b.footprint);
    for (const blk of cityBlocks(city)) {
      if (Math.max(Math.abs(blk.i), Math.abs(blk.j)) > c.extent) continue;
      if (listed.some((f) => overlaps(f, blk.inner))) continue;
      const [x0, y0, x1, y1] = blk.inner;
      // split the block into 1-3 columns and 1-2 rows
      const nx = 1 + Math.floor(R() * 3), ny = 1 + Math.floor(R() * 2);
      const ring = Math.max(Math.abs(blk.i), Math.abs(blk.j));
      for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
        if (R() < 0.12) continue; // a gap: parking lot or small park
        const gx = 1.5, gy = 1.5;
        const bx0 = x0 + ((x1 - x0) * a) / nx + (a ? gx : 0), bx1 = x0 + ((x1 - x0) * (a + 1)) / nx - (a < nx - 1 ? gx : 0);
        const by0 = y0 + ((y1 - y0) * b) / ny + (b ? gy : 0), by1 = y0 + ((y1 - y0) * (b + 1)) / ny - (b < ny - 1 ? gy : 0);
        const tower = R() < c.tower_chance;
        let h = tower ? c.tower_height * (0.8 + 0.4 * R()) : c.min_height + (c.max_height - c.min_height) * Math.pow(R(), 1.4);
        h *= ring >= 3 ? 0.85 : 1;
        // keep filler below the approach / departure surfaces
        const lim = Math.min(lowestLimit(city, [bx0, by0, bx1, by1], city.vertiport.approach_from_deg), lowestLimit(city, [bx0, by0, bx1, by1], city.vertiport.approach_from_deg + 180));
        h = Math.min(h, lim - 1);
        h = Math.round(h * 2) / 2;
        if (h < 6) continue;
        const facade = FACADES[Math.floor(R() * FACADES.length)];
        const setbacks = h > 30 && R() < 0.5 ? [{ at: Math.round(h * (0.6 + 0.2 * R())), inset: 2 }] : [];
        out.push({ id: 'ctx-' + blk.i + '-' + blk.j + '-' + a + b, footprint: [bx0, by0, bx1, by1], height: h, facade, setbacks, role: 'context' });
      }
    }
    return out;
  }

  /** Points along sidewalks (trees, lights) at a spacing, skipping intersections. */
  function sidewalkPoints(city, spacing, extent, inset, phase) {
    const out = [];
    for (const blk of cityBlocks(city)) {
      if (Math.max(Math.abs(blk.i), Math.abs(blk.j)) > extent) continue;
      const [x0, y0, x1, y1] = blk.outer;
      const m = 4; // keep clear of the corners and crosswalks
      const along = (a0, a1, fn) => {
        const n = Math.floor((a1 - a0 - 2 * m) / spacing);
        if (n < 0) return;
        const start = a0 + (a1 - a0 - n * spacing) / 2 + (phase || 0);
        for (let k = 0; k <= n; k++) { const a = start + k * spacing; if (a > a0 + m - 1e-9 && a < a1 - m + 1e-9) fn(a); }
      };
      along(x0, x1, (x) => { out.push({ x, y: y0 + inset, side: 'S' }); out.push({ x, y: y1 - inset, side: 'N' }); });
      along(y0, y1, (y) => { out.push({ x: x0 + inset, y, side: 'W' }); out.push({ x: x1 - inset, y, side: 'E' }); });
    }
    return out;
  }

  /* ---------- vertiport obstacle check (FAA EB 105 surfaces, see docs/research) ---------- */
  /**
   * Height limit of the 8:1 approach/departure surface at city point (x, y), or
   * Infinity if the point is outside the surface. Starts at the FATO edge, rises
   * 1:8, widens from the FATO width to 152 m at 1219 m.
   */
  function approachLimit(city, x, y, fromDeg) {
    const v = city.vertiport, p = v.pad;
    const a = (fromDeg * Math.PI) / 180;
    const ux = Math.sin(a), uy = Math.cos(a); // unit vector toward the approach origin
    const dx = x - p.x, dy = y - p.y;
    const along = dx * ux + dy * uy - v.fato / 2, across = Math.abs(-dx * uy + dy * ux);
    if (along < 0 || along > 1219) return Infinity;
    const half = v.fato / 2 + ((152 / 2 - v.fato / 2) * along) / 1219;
    if (across > half) return Infinity;
    return p.z + along / 8;
  }

  /** Lowest approach-surface height over a footprint (sampled grid). */
  function lowestLimit(city, f, dir) {
    let m = Infinity;
    for (let x = f[0]; x <= f[2] + 1e-9; x += Math.max(0.5, (f[2] - f[0]) / 24)) {
      for (let y = f[1]; y <= f[3] + 1e-9; y += Math.max(0.5, (f[3] - f[1]) / 24)) m = Math.min(m, approachLimit(city, x, y, dir % 360));
    }
    return m;
  }

  /** Building tiers that rise above the preferred or reciprocal approach surface. */
  function approachObstacles(city, extra) {
    const v = city.vertiport, hits = [];
    const all = city.buildings.concat(extra || []);
    for (const dir of [v.approach_from_deg, (v.approach_from_deg + 180) % 360]) {
      for (const b of all) {
        if (b.id === v.building) continue;
        for (const t of buildingTiers(b)) {
          for (let x = t.x0; x <= t.x1 + 1e-9; x += Math.max(0.5, (t.x1 - t.x0) / 24)) {
            for (let y = t.y0; y <= t.y1 + 1e-9; y += Math.max(0.5, (t.y1 - t.y0) / 24)) {
              if (t.z1 > approachLimit(city, x, y, dir)) { hits.push({ id: b.id, dir }); x = Infinity; break; }
            }
          }
        }
      }
    }
    return hits;
  }

  /* ---------- wind, windsock ---------- */
  /**
   * Windsock pose from the wind. fromDeg: direction the wind blows FROM (0 = north,
   * clockwise). Returns {towardDeg, droop}: the sock points downwind; droop is the
   * angle below horizontal in degrees (90 = hangs limp, 0 = straight out at >= 7.7 m/s / 15 kt).
   */
  function windsockPose(fromDeg, speed) {
    const toward = (((fromDeg + 180) % 360) + 360) % 360;
    const s = clamp(isNum(speed) ? speed : 0, 0, 40);
    const f = clamp(s / 7.7, 0, 1);
    const droop = 90 * Math.pow(1 - f, 1.6);
    return { towardDeg: toward, droop };
  }

  /* ---------- time of day ---------- */
  const TIMES = ['day', 'golden', 'dusk'];
  /** Lighting preset. Sun elevation/azimuth in degrees (azimuth from north, clockwise). */
  function timeOfDay(name) {
    const P = {
      day: { sunElev: 52, sunAz: 205, turbidity: 4, rayleigh: 1.2, mie: 0.004, mieG: 0.8, exposure: 0.42, sun: 3.2, sunColor: 0xfff4e5, hemi: 0.75, hemiSky: 0xbcd6ff, hemiGround: 0x8a8070, fog: 0xc7d6e4, fogDensity: 0.0016, windows: 0.0, lights: 0.7, bloom: 0.0, envIntensity: 0.9 },
      golden: { sunElev: 7, sunAz: 252, turbidity: 6, rayleigh: 2.2, mie: 0.006, mieG: 0.85, exposure: 0.42, sun: 3.0, sunColor: 0xffb070, hemi: 0.55, hemiSky: 0xa8bce0, hemiGround: 0x6a5040, fog: 0xd8b49a, fogDensity: 0.0018, windows: 0.35, lights: 1.2, bloom: 0.35, envIntensity: 0.8 },
      dusk: { sunElev: 0.8, sunAz: 268, turbidity: 3.5, rayleigh: 2.6, mie: 0.005, mieG: 0.88, exposure: 0.62, sun: 0.35, sunColor: 0xff8a5a, hemi: 0.42, hemiSky: 0x40508a, hemiGround: 0x2a2430, fog: 0x404a6a, fogDensity: 0.0022, windows: 0.75, lights: 3.0, bloom: 0.55, envIntensity: 0.5 },
    };
    const k = TIMES.includes(name) ? name : 'day';
    return Object.assign({ name: k }, P[k]);
  }

  /** Unit vector toward the sun in three.js world axes (x east, y up, z south). */
  function sunVector(elevDeg, azDeg) {
    const e = (elevDeg * Math.PI) / 180, a = (azDeg * Math.PI) / 180;
    return { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: -Math.cos(e) * Math.cos(a) };
  }

  /* ---------- cameras ---------- */
  const CAMERAS = ['chase', 'orbit', 'top', 'city'];
  const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const lerp = (a, b, f) => a + (b - a) * f;
  /** Blend two camera poses {px,py,pz,tx,ty,tz,fov}. */
  function lerpPose(a, b, f) {
    const o = {};
    for (const k of ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'fov']) o[k] = lerp(a[k], b[k], f);
    return o;
  }
  /** Pose from an orbit spec around a target (three.js axes: y up, z south). az 0 = camera south of target. */
  function orbitPose(tx, ty, tz, az, pol, dist, fov) {
    const sp = Math.sin(pol);
    return { px: tx + dist * sp * Math.sin(az), py: ty + dist * Math.cos(pol), pz: tz + dist * sp * Math.cos(az), tx, ty, tz, fov };
  }
  /**
   * Chase camera: frames the drone and the pad together. drone = {x, y, z} in
   * three.js pad-relative axes. opt = {az, pol, zoom}.
   */
  function chasePose(drone, opt) {
    const alt = Math.max(0, drone.y);
    const tx = drone.x * 0.7, ty = Math.max(0.45, alt * 0.5), tz = drone.z * 0.7;
    const dist = (4 + alt * 1.0 + Math.hypot(drone.x, drone.z) * 0.6) * (opt.zoom || 1);
    return orbitPose(tx, ty, tz, opt.az, opt.pol, dist, 45);
  }
  /** Top-down camera above the pad, north up (a 1-degree tilt avoids a degenerate lookAt). */
  function topPose(drone, opt) {
    const h = Math.max(7, (drone ? Math.max(0, drone.y) : 0) + 5.5) * (opt.zoom || 1);
    return { px: 0, py: h, pz: h * 0.018, tx: 0, ty: 0, tz: 0, fov: 40 };
  }
  /** Wide establishing shot along the (obstacle-free) approach corridor; sways slowly with clock time (s). */
  function cityPose(clock, opt) {
    const az = (opt.az === undefined ? -0.25 : opt.az) + 0.22 * Math.sin(clock * 0.05);
    return orbitPose(0, -4, 0, az, 1.27, 190 * (opt.zoom || 1), 36);
  }

  /* ---------- URL params ---------- */
  /** Scene options from URL search params: cam, tod, q, wind=<from_deg>,<m/s>. Unknown values are dropped. */
  function sceneParams(search) {
    const p = new URLSearchParams(search || '');
    const o = {};
    const cam = p.get('cam');
    if (CAMERAS.includes(cam)) o.cam = cam;
    const tod = p.get('tod');
    if (TIMES.includes(tod)) o.tod = tod;
    const q = p.get('q');
    if (q === 'low' || q === 'high') o.q = q;
    const w = (p.get('wind') || '').split(',').map(Number);
    if (w.length === 2 && w.every(Number.isFinite) && w[1] >= 0 && w[1] <= 40) o.wind = { from_deg: ((w[0] % 360) + 360) % 360, speed_mps: w[1] };
    return o;
  }

  /** Lit-window pattern for an n x m facade tile: Uint8Array, 1 = lit. Fraction ~ f. */
  function litPattern(seed, cols, rows, f) {
    const R = rng(seed), out = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const floorBias = R() < 0.25 ? -0.35 : R() < 0.2 ? 0.3 : 0; // whole floors dark or busy
      for (let c = 0; c < cols; c++) out[r * cols + c] = R() < f + floorBias ? 1 : 0;
    }
    return out;
  }

  const api = {
    FACADES, TIMES, CAMERAS, rng, parseCity, streetLines, cityBlocks, buildingTiers, contextBuildings, sidewalkPoints,
    approachLimit, approachObstacles, windsockPose, timeOfDay, sunVector, easeInOut, lerpPose, orbitPose,
    chasePose, topPose, cityPose, sceneParams, litPattern,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PLVWorldCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
