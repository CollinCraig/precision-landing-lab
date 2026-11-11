/* Precision Landing Lab: pure helpers for the onboard camera preview and the
 * M3 HUD overlay (design/vertiport-concept.html, section C).
 *
 * No DOM and no three.js in this file. It is shared by the browser
 * (window.PLVHud) and the node tests (require).
 *
 * Scope note: the pinhole math here only places HUD marks over the viewer's
 * own simulated preview image. It is NOT the perception camera model (that
 * is the owner's M2 learning piece in lab/perception/). Do not import it there.
 *
 * Frames
 *   NED: n north, e east, d down, metres, same frame as viewer.json series.
 *   Image: u right, v down, pixels, origin at the top-left corner of the
 *   sensor image (default 640 x 480). The camera looks straight down
 *   (nadir, roll/pitch stabilised); the image top points along the heading.
 */
(function (root) {
  'use strict';

  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const RAD = Math.PI / 180;

  const CAMERA_DEFAULT = { width: 640, height: 480, hfov_deg: 70, mount_up_m: 0.08 }; // lens height above the skid feet
  const LIMIT_M = 0.25;          // horizontal pass limit (docs/architecture.md, success definition)
  const MIN_CONF = 0.6;          // placeholder threshold drawn on the confidence bar (design C)
  const TAG_BLACK_M = 0.24;      // tag36h11 black edge (docs/research/vertiport-design.md)

  /* ---------- pinhole camera ---------- */
  /** Ideal pinhole intrinsics from the image size and the horizontal FOV. */
  function cameraIntrinsics(width, height, hfovDeg) {
    const w = isNum(width) && width > 0 ? width : CAMERA_DEFAULT.width;
    const h = isNum(height) && height > 0 ? height : CAMERA_DEFAULT.height;
    const hf = clamp(isNum(hfovDeg) ? hfovDeg : CAMERA_DEFAULT.hfov_deg, 10, 150);
    const fx = (w / 2) / Math.tan((hf * RAD) / 2);
    const vfov = (2 * Math.atan((h / 2) / fx)) / RAD;
    return { width: w, height: h, fx, fy: fx, cx: w / 2, cy: h / 2, hfov: hf, vfov, aspect: w / h };
  }

  /**
   * Project an NED point into the nadir camera. cam = {n, e, d, yawDeg}
   * (yaw = heading, 0 = north, clockwise). Returns {u, v, z, inFront, inImage}.
   * z is the depth below the camera in metres.
   */
  function projectNadir(intr, cam, p) {
    const dn = p.n - cam.n, de = p.e - cam.e, dz = p.d - cam.d;
    const y = (cam.yawDeg || 0) * RAD, c = Math.cos(y), s = Math.sin(y);
    const xr = -dn * s + de * c;        // starboard (image right)
    const fwd = dn * c + de * s;        // forward (image up)
    const inFront = dz > 1e-6;
    const z = inFront ? dz : 1e-6;
    const u = intr.cx + (intr.fx * xr) / z, v = intr.cy - (intr.fy * fwd) / z;
    return { u, v, z: dz, inFront, inImage: inFront && u >= 0 && u <= intr.width && v >= 0 && v <= intr.height };
  }

  /**
   * Corners of a square marker centred on the pad, in NED. Order: NW, NE, SE,
   * SW in the pad's own frame (before yaw). yawDeg rotates the square clockwise.
   */
  function squareCorners(center, sizeM, yawDeg) {
    const h = sizeM / 2, y = (yawDeg || 0) * RAD, c = Math.cos(y), s = Math.sin(y);
    return [[-h, h], [h, h], [h, -h], [-h, -h]].map(([e, n]) => ({
      n: center.n + (-e * s + n * c), e: center.e + (e * c + n * s), d: center.d,
    }));
  }

  /**
   * Fit the HUD frame (16:9) into a container and the camera image (camAspect)
   * into the frame's height. All values in container pixels.
   */
  function hudLayout(cw, ch, camAspect, frameAspect) {
    const fa = frameAspect || 16 / 9, ca = camAspect || 4 / 3;
    let fw = cw, fh = cw / fa;
    if (fh > ch) { fh = ch; fw = ch * fa; }
    const frame = { x: (cw - fw) / 2, y: (ch - fh) / 2, w: fw, h: fh, scale: fw / 1280 };
    let iw = fh * ca, ih = fh;
    if (iw > fw) { iw = fw; ih = fw / ca; }
    const image = { x: frame.x + (fw - iw) / 2, y: frame.y + (fh - ih) / 2, w: iw, h: ih };
    return { frame, image };
  }

  /** Map a sensor pixel to the 1280 x 720 HUD viewBox, given the camera aspect. */
  function imageToHud(u, v, intr) {
    const fa = 16 / 9, ca = intr.aspect;
    let iw = 720 * ca, ih = 720;
    if (iw > 1280) { iw = 1280; ih = 1280 / ca; }
    const x0 = (1280 - iw) / 2, y0 = (720 - ih) / 2;
    return { x: x0 + (u / intr.width) * iw, y: y0 + (v / intr.height) * ih, sx: iw / intr.width, sy: ih / intr.height, fa };
  }

  /* ---------- HUD state mapping ---------- */
  /** HUD category for a mission-state / flight-mode name. */
  function hudCategory(name) {
    const n = String(name || '').toLowerCase();
    if (/abort|fail|timeout|error|lost|crash|go.?around/.test(n)) return 'abort';
    if (/^(landed|done|complete|touchdown|disarm)/.test(n)) return 'landed';
    if (/land|descen|touch/.test(n)) return 'descend';
    if (/search|scan|acquir/.test(n)) return 'search';
    if (/approach|align|hold|hover|loiter|settle|transit|poshold/.test(n)) return 'approach';
    if (/takeoff|climb|ascen/.test(n)) return 'climb';
    return 'idle';
  }
  // Colours from design C: perception cyan, truth white, aircraft/error yellow, good green, caution amber, abort red.
  const CAT_COLOR = {
    search: '#e9f3f6', approach: '#19e6ff', descend: '#19e6ff', climb: '#8fb1ff', abort: '#ff4a3d', landed: '#2fd16b', idle: '#9aa6ae',
  };
  const HUD_COLORS = { perception: '#19e6ff', truth: '#ffffff', aircraft: '#ffd34d', good: '#2fd16b', caution: '#f2a516', bad: '#ff4a3d', limit: '#ff6b5b', ink: '#e9f3f6' };

  /** State chips: one per distinct name, in order; the active one carries its colour. */
  function hudChips(names, activeIndex) {
    const seen = new Set(), out = [];
    (names || []).forEach((nm, i) => {
      const label = String(nm).toUpperCase();
      if (seen.has(label)) return;
      seen.add(label);
      const cat = hudCategory(nm);
      const active = i === activeIndex || (activeIndex >= 0 && String(names[activeIndex]).toUpperCase() === label);
      out.push({ label, cat, active, color: CAT_COLOR[cat], fg: active ? (cat === 'abort' || cat === 'climb' ? '#ffffff' : '#061016') : 'rgba(233,243,246,.7)' });
    });
    return out;
  }

  /** Confidence tone against the minimum threshold: good >= min, caution >= 2/3 min, else bad. */
  function confidenceTone(c, min) {
    const m = isNum(min) ? min : MIN_CONF;
    if (!isNum(c)) return 'bad';
    return c >= m ? 'good' : c >= m * (2 / 3) ? 'caution' : 'bad';
  }
  /** Error tone against the horizontal limit: good below 60 % of the limit, caution up to the limit, bad above. */
  function errorTone(errM, limitM) {
    const L = isNum(limitM) ? limitM : LIMIT_M;
    if (!isNum(errM)) return 'bad';
    return errM <= L * 0.6 ? 'good' : errM <= L ? 'caution' : 'bad';
  }
  /** Error in cm with one decimal below 100 cm, else no decimals. */
  function formatCm(m) {
    if (!isNum(m)) return '—';
    const cm = m * 100;
    return cm >= 100 ? cm.toFixed(0) : cm.toFixed(1);
  }

  /**
   * ABORT / LANDED banner, or null. ctx = {cat, name, armed, alt, verdict,
   * result (result.json or null), failure (code or null), limit}.
   */
  function hudBanner(ctx) {
    const L = isNum(ctx.limit) ? ctx.limit : LIMIT_M;
    if (ctx.cat === 'abort') {
      const parts = ['ABORT'];
      if (ctx.failure) parts.push(String(ctx.failure).toUpperCase().replace(/_/g, ' '));
      else if (ctx.name && hudCategory(ctx.name) === 'abort') parts.push(String(ctx.name).toUpperCase());
      parts.push(ctx.armed ? 'ARMED' : 'DISARMED');
      return { kind: 'abort', color: '#cf3a2c', text: parts.join(' · ') };
    }
    if (ctx.cat === 'landed' || (ctx.cat === 'descend' && !ctx.armed && isNum(ctx.alt) && ctx.alt < 0.2)) {
      const r = ctx.result || {};
      const parts = ['LANDED'];
      if (isNum(r.horizontal_error_m)) parts.push('ERROR ' + formatCm(r.horizontal_error_m) + ' cm');
      if (isNum(r.touchdown_speed_mps)) parts.push('TOUCHDOWN ' + r.touchdown_speed_mps.toFixed(2) + ' m/s');
      if (isNum(r.horizontal_error_m)) parts.push(r.horizontal_error_m <= L ? 'WITHIN ' + Math.round(L * 100) + ' cm' : 'OUTSIDE ' + Math.round(L * 100) + ' cm');
      if (ctx.verdict === 'pass') parts.push('RUN PASS');
      else if (ctx.verdict === 'fail') parts.push('RUN FAIL');
      const bad = ctx.verdict === 'fail' || (isNum(r.horizontal_error_m) && r.horizontal_error_m > L);
      return { kind: 'landed', color: bad ? '#b4651a' : '#1d8f4a', text: parts.join(' · ') };
    }
    return null;
  }

  /* ---------- proposed v2 perception block (FORMAT.md) ---------- */
  const EST_COLS = ['t', 'valid', 'confidence', 'n', 'e'];
  /**
   * Read the optional "perception" block of viewer.json (proposed v2, see
   * FORMAT.md). Returns {data, warning}. data is null when the block is
   * absent or malformed; a malformed block never breaks a v1 replay.
   */
  function parsePerception(obj) {
    if (!isObj(obj) || obj.perception === undefined) return { data: null, warning: null };
    const p = obj.perception;
    const bad = (why) => ({ data: null, warning: 'perception block ignored: ' + why });
    if (!isObj(p)) return bad('not an object');
    if (p.version !== 1) return bad('unsupported perception.version ' + JSON.stringify(p.version));
    const cam = isObj(p.camera) ? p.camera : {};
    const camera = {
      width: isNum(cam.width) && cam.width > 0 ? cam.width : CAMERA_DEFAULT.width,
      height: isNum(cam.height) && cam.height > 0 ? cam.height : CAMERA_DEFAULT.height,
      hfov_deg: isNum(cam.hfov_deg) && cam.hfov_deg > 0 && cam.hfov_deg < 180 ? cam.hfov_deg : null,
      rate_hz: isNum(cam.rate_hz) && cam.rate_hz > 0 ? cam.rate_hz : null,
    };
    const lim = isObj(p.limits) ? p.limits : {};
    const limits = {
      horizontal_m: isNum(lim.horizontal_m) && lim.horizontal_m > 0 ? lim.horizontal_m : LIMIT_M,
      min_confidence: isNum(lim.min_confidence) && lim.min_confidence >= 0 && lim.min_confidence <= 1 ? lim.min_confidence : MIN_CONF,
    };
    const cols = (block, names, opt) => {
      if (!isObj(block)) return null;
      const len = Array.isArray(block.t) ? block.t.length : -1;
      if (len < 0) throw new Error('t must be an array');
      const out = {};
      for (const k of names.concat(opt || [])) {
        if (block[k] === undefined && opt && opt.includes(k)) continue;
        if (!Array.isArray(block[k]) || block[k].length !== len) throw new Error(k + ' must be an array of length ' + len);
        for (let i = 0; i < len; i++) if (!isNum(block[k][i])) throw new Error(k + '[' + i + '] is not a finite number');
        out[k] = block[k].slice();
      }
      for (let i = 1; i < len; i++) if (out.t[i] < out.t[i - 1]) throw new Error('t is not nondecreasing at ' + i);
      out.length = len;
      return out;
    };
    let estimate = null, truth = null, detection = null;
    try {
      estimate = cols(p.estimate, EST_COLS, ['latency_s']);
      if (estimate) {
        for (let i = 0; i < estimate.length; i++) {
          if (estimate.valid[i] !== 0 && estimate.valid[i] !== 1) throw new Error('valid[' + i + '] must be 0 or 1');
          if (estimate.confidence[i] < 0 || estimate.confidence[i] > 1) throw new Error('confidence[' + i + '] must be in [0, 1]');
        }
        estimate.source = typeof p.estimate.source === 'string' ? p.estimate.source : null;
      }
    } catch (e) { return bad('estimate.' + e.message); }
    try { truth = cols(p.truth, ['t', 'n', 'e', 'd']); } catch (e) { return bad('truth.' + e.message); }
    if (isObj(p.detection)) {
      const D = p.detection;
      try {
        detection = cols({ t: D.t, margin: D.margin }, ['t'], ['margin']);
        if (!Array.isArray(D.corners) || D.corners.length !== detection.length) throw new Error('corners must have one entry per t');
        detection.corners = D.corners.map((c, i) => {
          if (c === null) return null;
          if (!Array.isArray(c) || c.length !== 8 || !c.every(isNum)) throw new Error('corners[' + i + '] must be null or 8 numbers');
          return c.slice();
        });
      } catch (e) { return bad('detection.' + e.message); }
    }
    if (!estimate && !truth && !detection) return bad('no estimate, truth or detection stream');
    return { data: { camera, limits, estimate, truth, detection }, warning: null };
  }

  /** Last index with a[i] <= t, or -1 (a sorted ascending). */
  function lastAtOrBefore(a, t) {
    let lo = 0, hi = a.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (a[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  /** Linear interpolation of numeric columns at t (clamped at the ends); null if empty. */
  function interpAt(block, keys, t) {
    if (!block || !block.length) return null;
    let i = lastAtOrBefore(block.t, t);
    if (i < 0) i = 0;
    const j = Math.min(i + 1, block.length - 1);
    const f = j > i && t > block.t[i] ? Math.min(1, (t - block.t[i]) / (block.t[j] - block.t[i] || 1)) : 0;
    const o = { index: i };
    for (const k of keys) o[k] = block[k][i] + (block[k][j] - block[k][i]) * f;
    return o;
  }

  /** Latest estimate at or before t (estimates are discrete ticks, so no interpolation). */
  function estimateAt(est, t) {
    if (!est || !est.length) return null;
    const i = lastAtOrBefore(est.t, t);
    if (i < 0) return null;
    return {
      index: i, t: est.t[i], age: t - est.t[i], valid: est.valid[i] === 1, confidence: est.confidence[i],
      n: est.n[i], e: est.e[i], latency_s: est.latency_s ? est.latency_s[i] : null,
    };
  }

  /**
   * Horizontal offset history for the sparkline: [{t, err}] over the last
   * `win` seconds before t, at `step` spacing. pos(t) returns {n, e} or null.
   */
  function offsetHistory(pos, pad, t, win, step) {
    const out = [];
    const w = win || 10, st = step || 0.2;
    for (let k = Math.ceil(w / st); k >= 0; k--) {
      const tt = t - k * st;
      if (tt < 0) continue;
      const p = pos(tt);
      if (p) out.push({ t: tt - t, err: Math.hypot(p.n - pad.n, p.e - pad.e) });
    }
    return out;
  }

  /**
   * Full HUD model for one instant. in = {sample (store.sampleAt), store,
   * per (parsePerception().data or null), result, verdict, failure, mode, t,
   * intr, pad: {n, e, d}, padYawDeg, tagSize, mountUp (camera height above
   * the skid feet, m)}.
   * Every optional panel has a show flag; v1 data hides estimate and confidence.
   */
  function hudModel(inp) {
    const s = inp.sample, st = inp.store, per = inp.per || null;
    const limit = per ? per.limits.horizontal_m : LIMIT_M;
    const minConf = per ? per.limits.min_confidence : MIN_CONF;
    const names = st.hasState ? st.states : st.modes;
    const active = s ? (st.hasState ? s.state : s.mode) : -1;
    const name = active >= 0 ? names[active] : '';
    const cat = hudCategory(name);
    // aircraft position: simulator truth if the run has it, else telemetry
    let ac = s ? { n: s.n, e: s.e, d: s.d } : null, posSrc = 'telemetry';
    if (per && per.truth) { const tr = interpAt(per.truth, ['n', 'e', 'd'], inp.t); if (tr) { ac = tr; posSrc = 'truth'; } }
    const pad = inp.pad;
    const err = ac ? Math.hypot(ac.n - pad.n, ac.e - pad.e) : null;
    const est = per ? estimateAt(per.estimate, inp.t) : null;
    const estErr = est && est.valid ? Math.hypot(est.n - pad.n, est.e - pad.e) : null;
    const cam = s ? { n: s.n, e: s.e, d: s.d - (inp.mountUp || 0), yawDeg: s.hdg } : null;
    const proj = (p) => (cam ? projectNadir(inp.intr, cam, p) : null);
    const tag = cam ? squareCorners(pad, inp.tagSize || TAG_BLACK_M, inp.padYawDeg || 0).map(proj) : null;
    let det = null;
    if (per && per.detection) {
      const i = lastAtOrBefore(per.detection.t, inp.t);
      const rate = per.camera.rate_hz || 30;
      if (i >= 0 && inp.t - per.detection.t[i] <= 2 / rate && per.detection.corners[i]) {
        const c = per.detection.corners[i];
        det = { corners: [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]], [c[6], c[7]]], margin: per.detection.margin ? per.detection.margin[i] : null };
      }
    }
    return {
      name, cat, color: CAT_COLOR[cat], chips: hudChips(names, active),
      alt: s ? s.alt : null, vdown: s ? s.vz : null, armed: s ? !!s.armed : false,
      err, errTone: errorTone(err, limit), posSrc, limit,
      truthPx: cam ? proj(pad) : null, tagPx: tag,
      tagVisible: !!tag && tag.every((q) => q.inFront) && tag.some((q) => q.inImage),
      det,
      showEstimate: !!est, est, estErr, estPx: est && est.valid && cam ? proj({ n: est.n, e: est.e, d: pad.d }) : null,
      offsetNE: ac ? { n: pad.n - ac.n, e: pad.e - ac.e } : null,
      estOffsetNE: est && est.valid && ac ? { n: est.n - ac.n, e: est.e - ac.e } : null,
      showConfidence: !!est, confidence: est ? est.confidence : null, confTone: est ? confidenceTone(est.confidence, minConf) : null, minConf,
      latency: est && isNum(est.latency_s) ? est.latency_s : null, rate: per ? per.camera.rate_hz : null,
      source: est ? (per.estimate.source || null) : null,
      banner: s ? hudBanner({ cat, name, armed: !!s.armed, alt: s.alt, verdict: inp.verdict, result: inp.result, failure: inp.failure, limit }) : null,
      mode: inp.mode || null,
    };
  }

  const api = {
    CAMERA_DEFAULT, LIMIT_M, MIN_CONF, TAG_BLACK_M, CAT_COLOR, HUD_COLORS,
    cameraIntrinsics, projectNadir, squareCorners, hudLayout, imageToHud,
    hudCategory, hudChips, confidenceTone, errorTone, formatCm, hudBanner,
    parsePerception, estimateAt, interpAt, offsetHistory, hudModel,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PLVHud = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
