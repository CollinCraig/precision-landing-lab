/* Precision Landing Lab: flight replay viewer.
 *
 * Layout of this file
 *   1. Pure core (no DOM, no three.js): parsing/validation, TelemetryStore,
 *      interpolation, ticks, formatting. Unit-tested with node (tests/).
 *   2. Data sources. ReplaySource loads a saved run directory. A future
 *      LiveSource (M2+) only has to call store.append(sample) with the same
 *      sample shape; nothing else in the UI cares where samples come from.
 *   3. DOM + three.js (only runs in a browser).
 *
 * All run data is inserted with textContent / canvas, never innerHTML.
 */
(function (root) {
  'use strict';

  /* ===================================================================
   * 1. Pure core
   * =================================================================== */

  const SCHEMA_VERSION = 1;
  const NUM_COLS = ['t', 'n', 'e', 'd', 'alt', 'vz'];
  const COLS = ['t', 'n', 'e', 'd', 'alt', 'vz', 'mode', 'armed', 'state', 'hdg'];

  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

  /** Validate a parsed viewer.json (see FORMAT.md) and return a TelemetryStore. */
  function parseViewer(obj) {
    if (!isObj(obj)) throw new Error('viewer.json: expected a JSON object');
    if (obj.schema_version !== SCHEMA_VERSION) {
      throw new Error('viewer.json: unsupported schema_version ' + JSON.stringify(obj.schema_version) + ' (expected 1)');
    }
    const s = obj.series;
    if (!isObj(s)) throw new Error('viewer.json: missing "series" object');
    const modes = obj.modes;
    if (!Array.isArray(modes) || !modes.every((m) => typeof m === 'string' && m.trim())) {
      throw new Error('viewer.json: "modes" must be an array of non-empty strings');
    }
    const hasState = s.state !== undefined;
    const states = obj.states === undefined ? [] : obj.states;
    if (!Array.isArray(states) || !states.every((m) => typeof m === 'string' && m.trim())) {
      throw new Error('viewer.json: "states" must be an array of non-empty strings');
    }
    if (hasState && states.length === 0) throw new Error('viewer.json: series.state needs a "states" table');

    for (const k of ['t', 'n', 'e', 'd', 'alt', 'vz', 'mode', 'armed']) {
      if (!Array.isArray(s[k])) throw new Error('viewer.json: series.' + k + ' must be an array');
    }
    const len = s.t.length;
    const names = hasState ? COLS : COLS.filter((c) => c !== 'state');
    for (const k of names) {
      if (k === 'hdg' && s.hdg === undefined) continue;
      if (!Array.isArray(s[k]) || s[k].length !== len) {
        throw new Error('viewer.json: series.' + k + ' has length ' + (s[k] && s[k].length) + ', expected ' + len);
      }
    }
    for (let i = 0; i < len; i++) {
      for (const k of NUM_COLS) {
        if (!isNum(s[k][i])) throw new Error('viewer.json: series.' + k + '[' + i + '] is not a finite number');
      }
      if (s.t[i] < 0) throw new Error('viewer.json: series.t[' + i + '] is negative');
      if (i > 0 && s.t[i] < s.t[i - 1]) throw new Error('viewer.json: series.t is not nondecreasing at index ' + i);
      if (!Number.isInteger(s.mode[i]) || s.mode[i] < 0 || s.mode[i] >= modes.length) {
        throw new Error('viewer.json: series.mode[' + i + '] is not an index into "modes"');
      }
      if (s.armed[i] !== 0 && s.armed[i] !== 1) throw new Error('viewer.json: series.armed[' + i + '] must be 0 or 1');
      if (hasState && (!Number.isInteger(s.state[i]) || s.state[i] < 0 || s.state[i] >= states.length)) {
        throw new Error('viewer.json: series.state[' + i + '] is not an index into "states"');
      }
      if (s.hdg !== undefined && !isNum(s.hdg[i])) throw new Error('viewer.json: series.hdg[' + i + '] is not a finite number');
    }
    let pad = { n: 0, e: 0 };
    if (obj.pad !== undefined) {
      if (!isObj(obj.pad) || !isNum(obj.pad.n) || !isNum(obj.pad.e)) throw new Error('viewer.json: "pad" needs numeric n and e');
      pad = { n: obj.pad.n, e: obj.pad.e };
    }
    const store = new TelemetryStore({
      runId: typeof obj.run_id === 'string' ? obj.run_id : '',
      modes, states, pad, source: isObj(obj.source) ? obj.source : null,
      hasState, hasHdg: s.hdg !== undefined,
    });
    for (let i = 0; i < len; i++) {
      store.append({
        t: s.t[i], n: s.n[i], e: s.e[i], d: s.d[i], alt: s.alt[i], vz: s.vz[i],
        mode: s.mode[i], armed: s.armed[i], state: hasState ? s.state[i] : -1, hdg: s.hdg ? s.hdg[i] : 0,
      }, true);
    }
    return store;
  }

  function lerpAngle(a, b, f) {
    let d = ((b - a + 540) % 360) - 180;
    return (a + d * f + 360) % 360;
  }

  /** Columnar telemetry. Replay fills it in one go; a live source appends. */
  class TelemetryStore {
    constructor(meta) {
      meta = meta || {};
      this.runId = meta.runId || '';
      this.modes = (meta.modes || []).slice();
      this.states = (meta.states || []).slice();
      this.pad = meta.pad || { n: 0, e: 0 };
      this.source = meta.source || null;
      this.hasState = !!meta.hasState;
      this.hasHdg = !!meta.hasHdg;
      this.cols = {};
      COLS.forEach((c) => { this.cols[c] = []; });
      this.listeners = [];
    }
    get length() { return this.cols.t.length; }
    get endTime() { return this.length ? this.cols.t[this.length - 1] : 0; }
    onChange(fn) { this.listeners.push(fn); }
    append(sample, silent) {
      if (this.length && sample.t < this.endTime) throw new Error('append: time went backwards');
      COLS.forEach((c) => this.cols[c].push(sample[c] === undefined ? (c === 'state' ? -1 : 0) : sample[c]));
      if (!silent) this.listeners.forEach((fn) => fn(this));
    }
    /** Names/codes used to colour trail, band and altitude line. */
    labelTable() {
      return this.hasState ? { names: this.states, codes: this.cols.state } : { names: this.modes, codes: this.cols.mode };
    }
    /** Last index with t[i] <= t, or -1. */
    indexAt(t) {
      const a = this.cols.t;
      let lo = 0, hi = a.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (a[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return ans;
    }
    /** Interpolated sample at time t; step values (mode, armed, state) hold. */
    sampleAt(t) {
      const n = this.length;
      if (!n) return null;
      const c = this.cols;
      let i = this.indexAt(t);
      if (i < 0) i = 0;
      const j = Math.min(i + 1, n - 1);
      let f = 0;
      if (j > i && t > c.t[i]) f = Math.min(1, (t - c.t[i]) / (c.t[j] - c.t[i] || 1));
      const mix = (k) => c[k][i] + (c[k][j] - c[k][i]) * f;
      const state = c.state[i];
      return {
        t, index: i,
        n: mix('n'), e: mix('e'), d: mix('d'), alt: mix('alt'), vz: mix('vz'),
        hdg: lerpAngle(c.hdg[i], c.hdg[j], f),
        mode: c.mode[i], armed: c.armed[i], state,
        code: this.hasState ? state : c.mode[i],
      };
    }
  }

  /** Run-length encode integer codes: [{code, t0, t1, i0, i1}], last run ends at tEnd. */
  function runLengths(times, codes, tEnd) {
    const out = [];
    for (let i = 0; i < times.length; i++) {
      if (!out.length || out[out.length - 1].code !== codes[i]) {
        if (out.length) out[out.length - 1].t1 = times[i];
        out.push({ code: codes[i], t0: times[i], t1: tEnd, i0: i, i1: i });
      } else out[out.length - 1].i1 = i;
    }
    if (out.length) out[out.length - 1].t1 = Math.max(tEnd, out[out.length - 1].t0);
    return out;
  }

  function niceNum(x, round) {
    const exp = Math.floor(Math.log10(x));
    const f = x / Math.pow(10, exp);
    const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
    return nf * Math.pow(10, exp);
  }

  /** Round-number axis ticks covering [min, max]. */
  function niceTicks(min, max, count) {
    count = count || 5;
    if (!(max > min)) max = min + 1;
    const step = niceNum(niceNum(max - min, false) / (count - 1), true);
    const lo = Math.floor(min / step + 1e-9) * step;
    const hi = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return { ticks, min: lo, max: hi, step };
  }

  function formatTime(s) {
    if (!isNum(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
  }

  function fmt(v, digits, unit) {
    return isNum(v) ? v.toFixed(digits) + (unit ? ' ' + unit : '') : '–';
  }

  const EXTRA_RESULT = [
    ['horizontal_error_m', 'Horizontal error', 2, 'm'],
    ['touchdown_speed_mps', 'Touchdown speed', 2, 'm/s'],
    ['time_to_land_s', 'Time to land', 1, 's'],
  ];

  /** Header model from result.json / manifest.json (either may be null) and the store. */
  function summarizeResult(result, manifest, store) {
    const verdict = !result ? 'unknown' : result.success === true ? 'pass' : result.success === false ? 'fail' : 'unknown';
    const mode = (manifest && manifest.mode) || (result && result.mode) || null;
    const rows = [];
    const scenario = (result && result.scenario && result.scenario.name) || (manifest && manifest.scenario && manifest.scenario.name);
    if (scenario) rows.push({ k: 'Scenario', v: String(scenario) });
    if (result && isNum(result.duration_us)) rows.push({ k: 'Duration', v: (result.duration_us / 1e6).toFixed(1) + ' s' });
    if (result && isNum(result.seed)) rows.push({ k: 'Seed', v: String(result.seed) });
    if (result && result.failure_reason && typeof result.failure_reason === 'object') {
      rows.push({ k: 'Failure', v: String(result.failure_reason.code), tone: 'bad' });
      rows.push({ k: 'Detail', v: String(result.failure_reason.detail), tone: 'bad', wide: true });
    }
    if (result) {
      for (const [key, label, digits, unit] of EXTRA_RESULT) {
        if (isNum(result[key])) rows.push({ k: label, v: result[key].toFixed(digits) + ' ' + unit });
      }
      if (isNum(result.tlog_records)) rows.push({ k: 'Tlog records', v: String(result.tlog_records) });
    }
    if (store && store.length) {
      let peak = -Infinity, vmax = 0;
      for (let i = 0; i < store.length; i++) {
        peak = Math.max(peak, store.cols.alt[i]);
        vmax = Math.max(vmax, Math.abs(store.cols.vz[i]));
      }
      rows.push({ k: 'Peak altitude', v: peak.toFixed(1) + ' m', derived: true });
      rows.push({ k: 'Max |vz|', v: vmax.toFixed(1) + ' m/s', derived: true });
    }
    const operator = !!(result && typeof result.verdict_source === 'string' && /^operator/i.test(result.verdict_source));
    return { verdict, mode, rows, source: verdict === 'unknown' ? 'none' : operator ? 'operator' : 'runner' };
  }

  /** Texts that say where a PASS/FAIL comes from: the runner, or an operator who typed it (tlog export --verdict). */
  function verdictLabels(sum) {
    const word = sum.verdict === 'pass' ? 'PASS' : sum.verdict === 'fail' ? 'FAIL' : 'NO RESULT';
    if (sum.source === 'operator') {
      return {
        word,
        pill: word + ' (operator)',
        pillTitle: 'Verdict typed by the operator when the tlog was exported (--verdict). It is NOT a runner or validator result and was not checked by any software.',
        resultEy: 'RESULT · OPERATOR VERDICT, NOT A RUNNER RESULT',
        foot: ' PASS/FAIL is the operator\'s own verdict, typed at export. No runner or validator produced it, and it is not an acceptance decision.',
        note: 'PASS/FAIL is the operator\'s verdict, not a runner result, and not an acceptance decision.',
      };
    }
    return {
      word,
      pill: word,
      pillTitle: 'Outcome reported by the runner in result.json. Not independently checked; use `plv check` for structural validity.',
      resultEy: 'RESULT · REPORTED BY THE RUNNER',
      foot: ' PASS/FAIL is the runner\'s reported outcome, not an acceptance decision.',
      note: 'PASS/FAIL is the runner\'s reported outcome, not an acceptance decision.',
    };
  }

  /** Colour token for a mission-state / flight-mode name; stable per name. */
  const TOKEN_CYCLE = ['cyan', 'tdpc', 'vblue', 'lit', 'amber'];
  function stateToken(name, index) {
    const n = String(name || '').toLowerCase();
    if (/abort|fail|timeout|error|lost|crash/.test(n)) return 'red';
    if (/^(idle|wait|ready|disarm|done|complete|init)/.test(n)) return 'ink-3';
    if (/takeoff|climb|ascen/.test(n)) return 'vblue';
    if (/hold|hover|loiter|settle/.test(n)) return 'amber';
    if (/search|scan|acqui/.test(n)) return 'cyan';
    if (/approach|align|track/.test(n)) return 'tdpc';
    if (/landed|touchdown|on.?ground/.test(n)) return 'landed';
    if (/land|descen|touch/.test(n)) return 'lit';
    return TOKEN_CYCLE[Math.abs(index | 0) % TOKEN_CYCLE.length];
  }

  /** Relative luminance (WCAG 2.1) of a #rgb or #rrggbb colour; null if it is not a hex colour. */
  function luminance(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, '$&$&');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const lin = (i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  }
  /** WCAG 2.1 contrast ratio (1 to 21) of two hex colours; NaN if one is not a hex colour. */
  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    if (la === null || lb === null) return NaN;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  const INK_DARK = '#0d1115', INK_LIGHT = '#ffffff';
  /** Text colour (dark or white) with the higher contrast on the given background. */
  function readableOn(bg) {
    const d = contrastRatio(bg, INK_DARK), l = contrastRatio(bg, INK_LIGHT);
    return d >= l ? INK_DARK : INK_LIGHT; // NaN compares false: unknown colours get white text
  }

  /** Signed number with a true minus sign; a value that rounds to zero never shows "−0.00". */
  function fmtSigned(v, digits) {
    if (!isNum(v)) return '–';
    const r = Math.abs(v).toFixed(digits);
    return (v < 0 && Number(r) !== 0 ? '−' : '+') + r;
  }

  /** Readable text for an event kind: "state:hold" -> "State: hold", "mode_land" -> "Mode land". */
  function eventLabel(kind) {
    const k = String(kind === undefined || kind === null ? '' : kind).trim();
    if (!k) return '';
    const txt = k.replace(/_/g, ' ').replace(/\s*:\s*/g, ': ');
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  /** Resolve ?run= (directory or .json file) to the three URLs; same-origin only. */
  function runUrls(runParam, baseHref) {
    const base = new URL(baseHref);
    const u = new URL(runParam, base);
    if (u.origin !== base.origin) throw new Error('Only same-origin runs can be loaded (got ' + u.origin + ')');
    let dir;
    let viewerUrl;
    if (/\.json$/i.test(u.pathname)) {
      viewerUrl = u.href;
      dir = new URL('./', u);
    } else {
      if (!u.pathname.endsWith('/')) u.pathname += '/';
      dir = u;
      viewerUrl = new URL('viewer.json', dir).href;
    }
    return {
      dir: dir.href,
      viewer: viewerUrl,
      result: new URL('result.json', dir).href,
      manifest: new URL('manifest.json', dir).href,
    };
  }

  /* ===================================================================
   * 2. Data sources
   * =================================================================== */

  async function fetchJson(url, optional) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      if (optional) return null;
      throw new Error('HTTP ' + res.status + ' for ' + url);
    }
    try { return await res.json(); } catch (e) {
      if (optional) return null;
      throw new Error('Not valid JSON: ' + url);
    }
  }

  /** Replay: everything is already on disk. Returns {store, result, manifest, label}. */
  const ReplaySource = {
    async fromUrl(runParam, baseHref) {
      const urls = runUrls(runParam, baseHref);
      let raw;
      try { raw = await fetchJson(urls.viewer, false); } catch (e) {
        throw new Error(e.message + '. A run needs a viewer.json next to result.json (produced by the exporter, see viewer/FORMAT.md).');
      }
      const [result, manifest] = await Promise.all([fetchJson(urls.result, true), fetchJson(urls.manifest, true)]);
      return { store: parseViewer(raw), result, manifest, label: urls.dir, raw };
    },
    async fromFiles(fileList) {
      const files = Array.from(fileList);
      const byName = {};
      files.forEach((f) => { byName[f.name.toLowerCase()] = f; });
      const vf = byName['viewer.json'] || (files.length === 1 ? files[0] : null);
      if (!vf) throw new Error('Select viewer.json (and optionally result.json and manifest.json) together.');
      const read = async (f) => { if (!f) return null; try { return JSON.parse(await f.text()); } catch (e) { throw new Error(f.name + ' is not valid JSON'); } };
      const [raw, result, manifest] = await Promise.all([read(vf), read(byName['result.json']), read(byName['manifest.json'])]);
      return { store: parseViewer(raw), result, manifest, label: vf.name, raw };
    },
  };
  // M2+: LiveSource = { connect(url, store) } that calls store.append({t,n,e,d,alt,vz,mode,armed,state,hdg}).

  const api = {
    parseViewer, TelemetryStore, runLengths, niceTicks, formatTime, summarizeResult, verdictLabels, stateToken, runUrls,
    lerpAngle, ReplaySource, luminance, contrastRatio, readableOn, fmtSigned, eventLabel,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PLV = api;
  if (typeof document === 'undefined') return;

  /* ===================================================================
   * 3. DOM + three.js
   * =================================================================== */

  const GUTTER = 58, RGUTTER = 16;
  const SPEEDS = [0.5, 1, 2, 4];
  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
  const tokenColor = (tok) => css(tok);

  const state = {
    store: new TelemetryStore(), result: null, manifest: null, summary: null,
    t: 0, dur: 0, hasRun: false, playing: false, speed: 1, last: 0, scene: null, events: [], recMode: false, follow: false,
    lastEvt: '', per: null, city: null, cine: null,
  };
  // presentation: onboard inset (pip), which view fills the card (main), M3 HUD on/off, camera spec
  const pres = { pip: true, main: 'scene', hud: true, hfov: null, res: null, intr: null, hud3: null, pipOv: null, cineOv: null };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ---------- theme (the key is shared with learn/ and design/) ---------- */
  const THEME_KEY = 'pll-theme';
  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    try { if (theme) localStorage.setItem(THEME_KEY, theme); } catch (e) { /* storage unavailable */ }
    afterThemeChange();
  }
  function currentTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function afterThemeChange() {
    if (state.scene) state.scene.refreshTheme();
    drawCharts();
    buildBands();
  }

  /* ---------- charts ---------- */
  function drawChart(canvas, o) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const T = 8, B = 8, pw = w - GUTTER - RGUTTER, ph = h - T - B;
    const dur = o.dur || 1;
    const xs = (t) => GUTTER + (t / dur) * pw;
    const ys = niceTicks(o.min, o.max, 4);
    const y = (v) => T + ph - ((v - ys.min) / (ys.max - ys.min)) * ph;
    const ink3 = css('ink-3'), rule = css('rule');
    g.font = '11px ' + getComputedStyle(document.body).getPropertyValue('--mono');
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    ys.ticks.forEach((v) => {
      const yy = Math.round(y(v)) + 0.5;
      g.strokeStyle = v === 0 ? ink3 : rule;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(GUTTER, yy); g.lineTo(w - RGUTTER, yy); g.stroke();
      g.fillStyle = ink3;
      g.fillText(String(+v.toFixed(2)), GUTTER - 8, yy);
    });
    niceTicks(0, dur, 8).ticks.forEach((tv) => {
      if (tv > dur) return;
      const xx = Math.round(xs(tv)) + 0.5;
      g.strokeStyle = rule; g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, T + ph); g.stroke();
    });
    g.setLineDash([3, 4]);
    state.events.forEach((ev) => {
      const xx = Math.round(xs(ev.t)) + 0.5;
      g.strokeStyle = ev.failed ? css('red') : ink3;
      g.globalAlpha = ev.failed ? 0.9 : 0.35;
      g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, T + ph); g.stroke();
    });
    g.setLineDash([]); g.globalAlpha = 1;
    const st = state.store, tt = st.cols.t, vals = st.cols[o.key];
    if (!tt.length) return;
    const codes = st.labelTable();
    g.lineWidth = 2; g.lineJoin = 'round';
    let start = 0;
    for (let i = 1; i <= tt.length; i++) {
      if (i === tt.length || (o.byState && codes.codes[i] !== codes.codes[start])) {
        const end = Math.min(i, tt.length - 1);
        g.strokeStyle = o.byState ? tokenColor(stateToken(codes.names[codes.codes[start]], codes.codes[start])) : css(o.color);
        g.beginPath();
        for (let k = start; k <= end; k++) {
          const v = vals[k] * (o.sign || 1);
          k === start ? g.moveTo(xs(tt[k]), y(v)) : g.lineTo(xs(tt[k]), y(v));
        }
        g.stroke();
        start = i;
      }
    }
  }

  function chartRange(key, sign, includeZero) {
    const v = state.store.cols[key];
    let min = includeZero ? 0 : Infinity, max = includeZero ? 0 : -Infinity;
    for (let i = 0; i < v.length; i++) { const x = v[i] * sign; if (x < min) min = x; if (x > max) max = x; }
    if (!isFinite(min)) { min = 0; max = 1; }
    const pad = (max - min) * 0.08 || 0.5;
    return { min: includeZero && min === 0 ? 0 : min - pad, max: max + pad };
  }

  function drawCharts() {
    const dur = state.dur;
    const a = chartRange('alt', 1, true), v = chartRange('vz', -1, true);
    drawChart($('chartAlt'), { key: 'alt', min: a.min, max: a.max, dur, byState: true });
    drawChart($('chartVz'), { key: 'vz', sign: -1, min: v.min, max: v.max, dur, color: 'line-2' });
    const tk = $('timeTicks');
    tk.textContent = '';
    niceTicks(0, dur || 1, 8).ticks.forEach((tv) => {
      if (tv > dur) return;
      const s = el('span', 'tick', tv % 1 === 0 ? tv + 's' : tv.toFixed(1) + 's');
      s.style.left = (dur ? (tv / dur) * 100 : 0) + '%';
      tk.appendChild(s);
    });
  }

  /* ---------- state / mode bands ---------- */
  function bandRow(parent, runs, names, mkColor, mkTitle, labels) {
    const dur = state.dur || 1;
    runs.forEach((r) => {
      const seg = el('div', 'seg');
      seg.style.left = (r.t0 / dur) * 100 + '%';
      seg.style.width = Math.max(0, ((r.t1 - r.t0) / dur) * 100) + '%';
      const c = mkColor(r);
      if (c) { seg.style.background = c.bg; seg.style.color = c.fg; }
      seg.title = mkTitle(r);
      if (labels) seg.appendChild(el('span', null, names[r.code] !== undefined ? names[r.code] : ''));
      parent.appendChild(seg);
    });
  }

  function buildBands() {
    const st = state.store;
    ['bandState', 'bandMode', 'bandArmed', 'recBand'].forEach((id) => { $(id).textContent = ''; });
    if (!st.length) return;
    const tt = st.cols.t, end = state.dur;
    const lt = st.labelTable();
    const stateColor = (r) => {
      const tok = stateToken(lt.names[r.code], r.code);
      const bg = tokenColor(tok);
      return { bg, fg: readableOn(bg) };
    };
    const runsA = runLengths(tt, lt.codes, end);
    bandRow($('bandState'), runsA, lt.names, stateColor, (r) => lt.names[r.code] + ' · ' + r.t0.toFixed(1) + '–' + r.t1.toFixed(1) + ' s', true);
    bandRow($('recBand'), runsA, lt.names, stateColor, () => '', false);
    const runsM = runLengths(tt, st.cols.mode, end);
    bandRow($('bandMode'), runsM, st.modes, () => null, (r) => 'mode ' + st.modes[r.code] + ' · ' + r.t0.toFixed(1) + '–' + r.t1.toFixed(1) + ' s', true);
    const runsR = runLengths(tt, st.cols.armed, end);
    bandRow($('bandArmed'), runsR, ['disarmed', 'armed'], (r) => (r.code ? { bg: css('amber'), fg: INK_DARK } : null), (r) => (r.code ? 'armed' : 'disarmed') + ' · ' + r.t0.toFixed(1) + '–' + r.t1.toFixed(1) + ' s', false);
    // event ticks on the state band
    const ev = $('eventTicks');
    ev.textContent = '';
    state.events.forEach((e) => {
      const m = el('i', e.failed ? 'ev bad' : 'ev');
      m.style.left = (state.dur ? (e.t / state.dur) * 100 : 0) + '%';
      m.title = e.t.toFixed(1) + ' s · ' + eventLabel(e.kind);
      ev.appendChild(m);
    });
  }

  /* ---------- header ---------- */
  function renderHeader() {
    const sum = state.summary;
    const st = state.store;
    $('runId').textContent = st.runId || (state.result && state.result.run_id) || '(unnamed run)';
    const pills = $('pills');
    pills.textContent = '';
    if (sum.mode) pills.appendChild(el('span', 'pill mode', sum.mode));
    const vl = verdictLabels(sum);
    const v = el('span', 'pill ' + sum.verdict + (sum.source === 'operator' ? ' operator' : ''), vl.pill);
    v.title = vl.pillTitle;
    pills.appendChild(v);
    if (st.source && st.source.kind === 'synthetic') pills.appendChild(el('span', 'pill synth', 'synthetic'));
    const dl = $('results');
    dl.textContent = '';
    sum.rows.forEach((r) => {
      const d = el('div', 'kv' + (r.tone ? ' ' + r.tone : '') + (r.wide ? ' wide' : ''));
      d.appendChild(el('dt', null, r.k + (r.derived ? ' *' : '')));
      d.appendChild(el('dd', null, r.v));
      dl.appendChild(d);
    });
    $('derivedNote').hidden = !sum.rows.some((r) => r.derived) && sum.source !== 'operator';
    $('derivedNote').textContent = (sum.rows.some((r) => r.derived) ? '* derived from the telemetry samples, not from result.json. ' : '') + verdictLabels(sum).note;
    $('hudRun').textContent = $('runId').textContent;
    $('hudMode').textContent = sum.mode ? sum.mode.toUpperCase() : '';
    document.title = ($('runId').textContent || 'Replay') + ' · Replay viewer';
  }

  /* ---------- run loading ---------- */
  function showBanner(msg, kind) {
    const b = $('banner');
    b.hidden = !msg;
    b.textContent = msg || '';
    b.className = 'banner chrome' + (kind ? ' ' + kind : '');
    b.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  }

  function setRun(bundle) {
    state.store = bundle.store;
    state.hasRun = true;
    state.result = bundle.result;
    state.manifest = bundle.manifest;
    const res = bundle.result;
    const resDur = res && isNum(res.duration_us) ? res.duration_us / 1e6 : 0;
    state.dur = Math.max(resDur, bundle.store.endTime, 0.001);
    state.events = (res && Array.isArray(res.events) ? res.events : []).filter((e) => e && isNum(e.t_us)).map((e) => ({
      t: e.t_us / 1e6, kind: String(e.kind), failed: e.kind === 'run_failed',
    }));
    state.summary = summarizeResult(res, bundle.manifest, bundle.store);
    state.t = 0; state.playing = false; state.lastEvt = '';
    const pr = root.PLVHud ? root.PLVHud.parsePerception(bundle.raw) : { data: null, warning: null };
    state.per = pr.data;
    showBanner(bundle.store.length ? (pr.warning || '') : 'This run has no telemetry samples (empty series).', 'warn');
    syncEmpty();
    applyCamera();
    if (state.scene) state.scene.setData(bundle.store);
    renderHeader();
    buildBands();
    drawCharts();
    syncPlayButton();
    render();
    if (state.cine) startCine();
  }

  async function loadFromParam(runParam, remember) {
    showBanner('Loading ' + runParam + ' …', 'info');
    try {
      setRun(await ReplaySource.fromUrl(runParam, location.href));
      if (remember) {
        const u = new URL(location.href);
        u.searchParams.set('run', runParam);
        history.replaceState(null, '', u);
      }
    } catch (e) { showBanner('Could not load run: ' + e.message, 'bad'); }
  }

  async function loadFromFiles(files) {
    try { setRun(await ReplaySource.fromFiles(files)); } catch (e) { showBanner('Could not load files: ' + e.message, 'bad'); }
  }

  async function fillPicker(current) {
    const sel = $('runSelect');
    sel.textContent = '';
    const add = (label, items) => {
      if (!items.length) return;
      const g = document.createElement('optgroup');
      g.label = label;
      items.forEach((it) => { const o = el('option', null, it.label); o.value = it.path; g.appendChild(o); });
      sel.appendChild(g);
    };
    let idx = {};
    try { idx = (await fetchJson('samples/index.json', true)) || {}; } catch (e) { /* none */ }
    const ok = (list) => (Array.isArray(list) ? list : []).filter((s) => s && typeof s.path === 'string' && typeof s.label === 'string');
    add('Sample runs (synthetic)', ok(idx.samples));
    add('M3 preview (synthetic, proposed v2 data)', ok(idx.previews));
    const picks = $('emptyPicks');
    picks.textContent = '';
    ok(idx.samples).concat(ok(idx.previews)).slice(0, 4).forEach((it) => {
      const b = el('button', 'btn', it.label.replace(/\s*\(synthetic[^)]*\)\s*$/i, ''));
      b.type = 'button';
      b.addEventListener('click', () => { loadFromParam(it.path, true).then(() => fillPickerValue(it.path)); });
      picks.appendChild(b);
    });
    // Best effort: directory listing from python's http.server at ../runs/ (git-ignored local runs).
    let runs = [];
    try {
      const res = await fetch('../runs/', { cache: 'no-store' });
      if (res.ok && /html/.test(res.headers.get('content-type') || '')) {
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        runs = Array.from(doc.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'))
          .filter((h) => /^[A-Za-z0-9_-]+\/$/.test(h)).map((h) => ({ label: h.slice(0, -1), path: '../runs/' + h }));
      }
    } catch (e) { /* none */ }
    add('Local runs (runs/)', runs);
    const ph = el('option', null, 'Choose a run…');
    ph.value = '';
    sel.insertBefore(ph, sel.firstChild);
    fillPickerValue(current);
  }
  function fillPickerValue(current) {
    const sel = $('runSelect');
    const norm = (p) => (p || '').replace(/\/?$/, '/');
    const hit = Array.from(sel.options).find((o) => o.value && norm(o.value) === norm(current));
    sel.value = hit ? hit.value : '';
  }

  /* ---------- transport ---------- */
  function syncPlayButton() {
    const b = $('playBtn');
    const playing = state.cine ? !state.cine.paused && state.cine.d && state.cine.d.phase !== 'end' : state.playing;
    const label = playing ? 'Pause' : (state.t >= state.dur - 1e-6 && state.dur > 0.01 ? 'Replay' : 'Play');
    $('playLbl').textContent = label;
    b.dataset.state = label.toLowerCase();
    b.setAttribute('aria-pressed', playing ? 'true' : 'false');
    b.disabled = !state.store.length;
    document.querySelectorAll('#speeds button').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.speed === state.speed)));
  }
  function setTime(t) { if (state.cine) stopCine(); state.t = Math.min(Math.max(t, 0), state.dur); render(); syncPlayButton(); }
  function togglePlay() {
    if (!state.store.length) return;
    if (state.cine) {
      const k = state.cine;
      if (k.d && k.d.phase === 'end') startCine(); else k.paused = !k.paused;
      syncPlayButton();
      return;
    }
    if (!state.playing && state.t >= state.dur - 1e-6) state.t = 0;
    state.playing = !state.playing;
    state.last = performance.now();
    syncPlayButton();
  }
  function setSpeed(s) { state.speed = s; syncPlayButton(); }

  function render() {
    const s = state.store.sampleAt(state.t);
    const f = state.dur ? state.t / state.dur : 0;
    document.documentElement.style.setProperty('--f', String(f));
    const T = formatTime(state.t);
    $('timeNow').textContent = T + ' / ' + formatTime(state.dur);
    $('hudTime').textContent = T;
    $('scrub').setAttribute('aria-valuenow', state.t.toFixed(1));
    $('scrub').setAttribute('aria-valuemax', state.dur.toFixed(1));
    $('scrub').setAttribute('aria-valuetext', T);
    let evt = '';
    for (const e of state.events) if (e.t <= state.t + 1e-9) evt = e.kind;
    if (evt !== state.lastEvt) { state.lastEvt = evt; $('evtNow').textContent = eventLabel(evt); $('hudEvt').textContent = eventLabel(evt); }
    if (!s) { $('hudAlt').textContent = '–'; $('hudVs').textContent = '–'; if (state.scene) state.scene.update(null, 0); return; }
    const st = state.store;
    const lt = st.labelTable();
    const sname = st.hasState ? st.states[s.state] : st.modes[s.mode];
    const tok = stateToken(lt.names[s.code], s.code);
    $('hudAlt').textContent = s.alt.toFixed(2);
    $('hudVs').textContent = fmtSigned(-s.vz, 2);
    const chip = $('hudState');
    chip.textContent = sname || '';
    chip.style.background = tokenColor(tok);
    chip.style.color = readableOn(tokenColor(tok));
    $('hudFmode').textContent = st.modes[s.mode] || '';
    $('hudArm').textContent = s.armed ? 'ARMED' : 'DISARMED';
    $('hudArm').className = s.armed ? 'armed' : '';
    $('valAlt').textContent = s.alt.toFixed(2) + ' m';
    $('valVz').textContent = fmtSigned(-s.vz, 2) + ' m/s';
    if (state.scene) state.scene.update(s, state.playing ? 1 : 0);
    presentFrame(s, { label: sname || '', color: tokenColor(tok), fg: readableOn(tokenColor(tok)) });
  }

  function tick(now) {
    const dt = Math.min(0.1, (now - state.last) / 1000);
    state.last = now;
    if (state.cine) {
      cineStep(dt);
      if (state.scene) state.scene.frame(dt, state.cine && state.cine.d.phase === 'play' && !state.cine.paused);
      requestAnimationFrame(tick);
      return;
    }
    if (state.playing) {
      state.t += dt * state.speed;
      if (state.t >= state.dur) { state.t = state.dur; state.playing = false; syncPlayButton(); }
      render();
    }
    if (state.scene) state.scene.frame(dt, state.playing);
    requestAnimationFrame(tick);
  }

  /* ---------- scrubbing (scrubber and charts share the same x mapping) ---------- */
  function wireScrub() {
    const track = $('scrub');
    let dragging = false;
    const at = (ev) => {
      const r = track.getBoundingClientRect();
      setTime(((ev.clientX - r.left) / r.width) * state.dur);
    };
    document.querySelectorAll('[data-scrub]').forEach((zone) => {
      zone.addEventListener('pointerdown', (ev) => {
        dragging = true; zone.setPointerCapture(ev.pointerId); state.playing = false; syncPlayButton(); at(ev);
      });
      zone.addEventListener('pointermove', (ev) => { if (dragging) at(ev); });
      const end = () => { dragging = false; };
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
    });
    track.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 5 : 0.5;
      if (ev.key === 'ArrowLeft') { setTime(state.t - step); ev.preventDefault(); }
      if (ev.key === 'ArrowRight') { setTime(state.t + step); ev.preventDefault(); }
    });
  }

  /* ---------- recording mode ---------- */
  function setRecMode(on) {
    state.recMode = on;
    document.body.classList.toggle('rec', on);
    $('recBtn').setAttribute('aria-pressed', String(on));
    if (state.scene) state.scene.resize();
    drawCharts();
    layoutViews();
  }

  /* ---------- onboard camera, M3 HUD, cinematic mode ---------- */
  const clampN = (x, a, b) => Math.min(b, Math.max(a, x));
  function camIntr() {
    const Hc = root.PLVHud;
    const pc = state.per && state.per.camera;
    const w = pres.res ? pres.res[0] : pc ? pc.width : Hc.CAMERA_DEFAULT.width;
    const h = pres.res ? pres.res[1] : pc ? pc.height : Hc.CAMERA_DEFAULT.height;
    return Hc.cameraIntrinsics(w, h, pres.hfov || (pc && pc.hfov_deg) || Hc.CAMERA_DEFAULT.hfov_deg);
  }
  function applyCamera() {
    if (!root.PLVHud) return;
    pres.intr = camIntr();
    if (state.scene) state.scene.setOnboard({ width: pres.intr.width, height: pres.intr.height, hfov: pres.intr.hfov, mountUp: root.PLVHud.CAMERA_DEFAULT.mount_up_m });
    if (pres.hud3) pres.hud3.setCamera(pres.intr);
    if (pres.pipOv) pres.pipOv.setCamera(pres.intr);
    layoutViews();
  }
  /** What is on screen now; cinematic mode overrides the user's view choices. */
  function effectiveView() {
    if (state.cine) return { main: 'scene', pip: !!state.cine.pip, hud: false };
    if (!state.scene || !state.store.length) return { main: 'scene', pip: false, hud: false };
    return { main: pres.main, pip: pres.pip, hud: pres.hud && pres.main === 'onboard' };
  }
  const setHidden = (node, on) => { if (on) node.setAttribute('hidden', ''); else node.removeAttribute('hidden'); }; // works for SVG too
  const place = (node, r) => { node.style.left = r.x + 'px'; node.style.top = r.y + 'px'; node.style.width = r.w + 'px'; node.style.height = r.h + 'px'; };
  const roundRect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
  function layoutViews() {
    const card = $('sceneCard'), W = card.clientWidth, Hh = card.clientHeight;
    if (!W || !Hh || !root.PLVHud) return;
    const e = effectiveView(), intr = pres.intr || camIntr();
    const pip = $('pip'), hud = $('m3hud'), tag = $('onbTag');
    let inset = null, image = null;
    const lb = state.cine ? Math.max(0, Math.round((Hh - W / 2.0) / 2)) : 0; // cinematic letterbox to 2:1
    const below = (state.recMode ? 9 : 0) + lb;
    if (e.main === 'onboard') {
      const L = root.PLVHud.hudLayout(W, Hh, intr.aspect);
      image = roundRect(L.image);
      place(hud, roundRect(L.frame));
      setHidden(hud, !e.hud);
      setHidden(tag, e.hud);
      tag.style.left = (image.x + 12) + 'px'; tag.style.top = (image.y + 12) + 'px';
      if (e.pip) {
        const sc = L.frame.scale, iw = Math.max(150, 300 * sc), ih = (iw * 9) / 16;
        inset = roundRect({ x: L.frame.x + L.frame.w - iw - 40 * sc, y: L.frame.y + (e.hud ? 214 * sc : 14), w: iw, h: ih });
      }
    } else {
      setHidden(hud, true); setHidden(tag, true);
      if (e.pip) {
        const iw = clampN(W * 0.25, 150, 360), ih = iw / intr.aspect;
        inset = roundRect({ x: W - iw - 14, y: Hh - ih - 14 - below, w: iw, h: ih });
      }
    }
    pip.hidden = !inset;
    if (inset) {
      place(pip, inset);
      const sceneIn = e.main === 'onboard';
      pip.classList.toggle('scene-in', sceneIn);
      $('pipLabel').textContent = sceneIn ? 'SCENE · ' + String(state.scene ? state.scene.camera : sceneOpts.cam).toUpperCase() : 'ONBOARD ↓';
      $('pipSub').textContent = sceneIn ? '' : 'SIMULATED PREVIEW';
      $('pipSvg').style.display = sceneIn ? 'none' : '';
      $('pipSwap').hidden = !!state.cine;
    }
    card.classList.toggle('onb-main', e.main === 'onboard');
    card.classList.toggle('m3', e.hud);
    card.classList.toggle('cine-on', !!state.cine);
    if (pres.cineOv) pres.cineOv.setBars(lb);
    if (state.scene) state.scene.setViews({ main: e.main, inset, image });
    syncViewButtons();
    render();
  }
  function syncViewButtons() {
    const e = effectiveView(); // the buttons show what is on screen (cinematic mode overrides the choices)
    $('pipBtn').setAttribute('aria-pressed', String(e.pip));
    $('swapBtn').setAttribute('aria-pressed', String(e.main === 'onboard'));
    $('hudBtn').setAttribute('aria-pressed', String(e.hud));
    $('cineBtn').setAttribute('aria-pressed', String(!!state.cine));
  }
  /** View controls need the 3D scene and a run. */
  const canPresent = () => !!state.scene && state.store.length > 0;
  function syncEmpty() {
    const empty = !state.store.length;
    $('sceneCard').classList.toggle('norun', empty);
    $('emptyState').hidden = state.hasRun;
    ['pipBtn', 'swapBtn', 'hudBtn', 'cineBtn'].forEach((id) => { $(id).disabled = !canPresent(); });
  }
  function setPip(on) { if (!canPresent()) return; if (state.cine) stopCine(); pres.pip = on; layoutViews(); }
  function swapViews() {
    if (!canPresent()) return;
    if (state.cine) stopCine();
    pres.main = pres.main === 'onboard' ? 'scene' : 'onboard';
    if (pres.main === 'scene' && !pres.pip) pres.pip = true;
    layoutViews();
  }
  function toggleHud() {
    if (!canPresent()) return;
    if (state.cine) stopCine();
    if (pres.main !== 'onboard') { pres.main = 'onboard'; pres.hud = true; } else pres.hud = !pres.hud;
    layoutViews();
  }

  /** Per-frame overlay update: M3 HUD, PiP marks, cinematic telemetry chip. */
  function presentFrame(s, chip) {
    const Hc = root.PLVHud;
    if (!Hc || !pres.intr) return;
    const e = effectiveView();
    const needHud = e.hud && pres.hud3, needPip = e.pip && e.main === 'scene' && pres.pipOv;
    if (state.cine && pres.cineOv && state.cine.d) pres.cineOv.update(state.cine.d, { label: chip.label.toUpperCase(), color: chip.color, fg: chip.fg, alt: 'ALT ' + s.alt.toFixed(1) + ' m' });
    if (!needHud && !needPip) return;
    const st = state.store, pad = { n: st.pad.n, e: st.pad.e, d: 0 };
    const res = state.result;
    const m = Hc.hudModel({
      sample: s, store: st, per: state.per, result: res, verdict: state.summary.verdict,
      failure: res && res.failure_reason && typeof res.failure_reason === 'object' ? res.failure_reason.code : null,
      mode: state.summary.mode, t: state.t, intr: pres.intr, pad,
      padYawDeg: state.city ? state.city.vertiport.pad.yaw_deg : 0, tagSize: Hc.TAG_BLACK_M, mountUp: Hc.CAMERA_DEFAULT.mount_up_m,
    });
    if (needHud) {
      const tr = state.per && state.per.truth;
      const pos = tr ? (tt) => Hc.interpAt(tr, ['n', 'e'], tt) : (tt) => st.sampleAt(tt);
      pres.hud3.update(m, { t: state.t, runId: $('runId').textContent, hist: Hc.offsetHistory(pos, pad, state.t, 10, 0.2) });
    }
    if (needPip) pres.pipOv.update(m);
  }

  function cineContent() {
    const sum = state.summary, res = state.result || {}, st = state.store, man = state.manifest || {};
    const runId = $('runId').textContent;
    const scen = (res.scenario && res.scenario.name) || (man.scenario && man.scenario.name) || '';
    const synthetic = !!(st.source && st.source.kind === 'synthetic');
    const vl = verdictLabels(sum);
    const vtxt = vl.word;
    const tone = sum.verdict === 'pass' ? '#2fd16b' : sum.verdict === 'fail' ? '#cf3a2c' : '#77818b';
    const fr = res.failure_reason && typeof res.failure_reason === 'object' ? String(res.failure_reason.code) : '';
    const metrics = [];
    if (isNum(res.horizontal_error_m)) metrics.push('error ' + (res.horizontal_error_m * 100).toFixed(1) + ' cm');
    if (isNum(res.touchdown_speed_mps)) metrics.push('touchdown ' + res.touchdown_speed_mps.toFixed(2) + ' m/s');
    if (isNum(res.time_to_land_s)) metrics.push('land in ' + res.time_to_land_s.toFixed(1) + ' s');
    if (!metrics.length) sum.rows.filter((r) => r.derived).forEach((r) => metrics.push(r.k.toLowerCase() + ' ' + r.v + ' *'));
    const rows = sum.rows.filter((r) => !/^(Detail|Tlog records)$/.test(r.k)).slice(0, 8).map((r) => ({ k: r.k + (r.derived ? ' *' : ''), v: r.v }));
    return {
      title: { ey: 'PRECISION LANDING LAB', tt: 'Rooftop vertiport landing', sb: 'Simulation · procedural city, not a real place' },
      run: { ey: 'RUN', tt: runId, sb: [scen, sum.mode ? 'mode ' + sum.mode : '', isNum(res.seed) ? 'seed ' + res.seed : '', synthetic ? 'synthetic data' : ''].filter(Boolean).join(' · ') },
      result: { ey: vl.resultEy, tt: vtxt + (fr ? ' · ' + fr.replace(/_/g, ' ') : ''), sb: metrics.join(' · '), tone },
      outro: {
        ey: 'PRECISION LANDING LAB · REPLAY', tt: runId, verdict: vtxt + (fr ? ' · ' + fr.replace(/_/g, ' ').toUpperCase() : ''), tone, rows,
        foot: 'Simulation only.' + (synthetic ? ' Synthetic sample data.' : '') + vl.foot + (rows.some((r) => / \*$/.test(r.k)) ? ' * derived from telemetry.' : ''),
      },
    };
  }
  function startCine() {
    if (!canPresent() || !root.PLVCine || !pres.cineOv) return;
    const st = state.store, lt = st.labelTable();
    const plan = root.PLVCine.planCine({ dur: state.dur, speed: state.speed, runs: runLengths(st.cols.t, lt.codes, state.dur), names: lt.names });
    state.cine = { plan, c: 0, cam: null, paused: false, snap: true, pip: false, d: root.PLVCine.cineAt(plan, 0) };
    state.playing = false; state.t = 0;
    pres.cineOv.setContent(cineContent());
    $('cine').hidden = false;
    if (state.scene) state.scene.setCine(true);
    layoutViews();
    syncPlayButton();
  }
  function stopCine() {
    if (!state.cine) return;
    state.cine = null;
    $('cine').hidden = true;
    if (state.scene) { state.scene.setCine(false); state.scene.setCamera(sceneOpts.cam); }
    layoutViews();
    syncViewbar();
    syncPlayButton();
  }
  function cineStep(dt) {
    const k = state.cine;
    if (!k.paused) k.c += dt;
    const d = root.PLVCine.cineAt(k.plan, k.c);
    const wasEnd = k.d && k.d.phase === 'end';
    k.d = d;
    if (d.cam !== k.cam) {
      if (state.scene) state.scene.setCamera(d.cam, k.snap || d.blend === 0, d.blend || undefined);
      k.cam = d.cam; k.snap = false;
      if (!$('pip').hidden) layoutViews();
      syncViewbar();
    }
    if (d.pip !== k.pip) { k.pip = d.pip; layoutViews(); }
    if ((d.phase === 'end') !== wasEnd) syncPlayButton();
    state.t = d.t;
    render();
  }

  /* ===================== three.js scene (built in world.js) ===================== */
  // World: x = East, y = Up, z = South (right-handed). North is -z. Altitude above the deck = y.
  const sceneOpts = { cam: 'chase', tod: 'day', q: 'high', wind: null };
  const CAMS = ['chase', 'orbit', 'top', 'city', 'pad'], TODS = ['day', 'golden', 'dusk'];

  function createScene(container, city) {
    if (typeof THREE === 'undefined' || !root.PLVWorld) throw new Error('three.js did not load. Make sure that the network is available. The charts and the timeline continue to work.');
    return root.PLVWorld.createWorld({
      container, city, cam: sceneOpts.cam, tod: sceneOpts.tod, quality: sceneOpts.q,
      mono: css('mono') || 'monospace',
      follow: () => state.follow,
      wind: () => sceneOpts.wind || city.vertiport.wind,
      trailColor: (code) => { const lt = state.store.labelTable(); return tokenColor(stateToken(lt.names[code], code)); },
    });
  }

  async function loadCity() {
    const W = root.PLVWorldCore;
    if (!W) throw new Error('world-core.js did not load');
    const raw = await fetchJson('scene/city.json', false);
    return W.parseCity(raw);
  }

  function syncViewbar() {
    const sc = state.scene;
    const mark = (sel, attr, val) => document.querySelectorAll(sel).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset[attr] === val)));
    mark('#camSeg button', 'cam', sc ? sc.camera : sceneOpts.cam);
    mark('#todSeg button', 'tod', sc ? sc.timeOfDay : sceneOpts.tod);
    mark('#qSeg button', 'q', sc ? sc.quality : sceneOpts.q);
    $('followBtn').hidden = (sc ? sc.camera : sceneOpts.cam) !== 'orbit';
  }
  function setCam(c) { if (state.cine) stopCine(); sceneOpts.cam = c; if (state.scene) state.scene.setCamera(c); syncViewbar(); if (pres.main === 'onboard') layoutViews(); }
  function setTod(t) { sceneOpts.tod = t; if (state.scene) state.scene.setTimeOfDay(t); syncViewbar(); }
  function setQuality(q) {
    sceneOpts.q = q;
    try { localStorage.setItem('plv-quality', q); } catch (e) { /* storage unavailable */ }
    if (state.scene) state.scene.setQuality(q);
    syncViewbar();
  }
  const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];

  /* ---------- boot ---------- */
  function boot() {
    document.documentElement.style.setProperty('--gutter', GUTTER + 'px');
    document.documentElement.style.setProperty('--rgutter', RGUTTER + 'px');
    const params = new URLSearchParams(location.search);
    let theme = params.get('theme');
    if (theme !== 'light' && theme !== 'dark') { try { theme = localStorage.getItem(THEME_KEY) || localStorage.getItem('plv-theme'); } catch (e) { theme = null; } }
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);

    // scene options: URL (cam, tod, q, wind) > stored quality > device default
    const W = root.PLVWorldCore;
    const sp0 = W ? W.sceneParams(location.search) : {};
    let storedQ = null;
    try { storedQ = localStorage.getItem('plv-quality'); } catch (e) { storedQ = null; }
    const touch = (navigator.maxTouchPoints || 0) > 1 || /iPad|iPhone|Android/.test(navigator.userAgent);
    sceneOpts.q = sp0.q || (storedQ === 'low' || storedQ === 'high' ? storedQ : (touch ? 'low' : 'high'));
    if (sp0.cam) sceneOpts.cam = sp0.cam;
    if (sp0.tod) sceneOpts.tod = sp0.tod;
    if (sp0.wind) sceneOpts.wind = sp0.wind;
    // onboard camera + presentation: pip=0|1, view=onboard, hud=0|1, cfov=<deg>, cres=<w>x<h>
    pres.pip = params.has('pip') ? params.get('pip') !== '0' : window.innerWidth >= 640;
    if (params.get('view') === 'onboard') pres.main = 'onboard';
    if (params.get('hud') === '0') pres.hud = false;
    const cfov = parseFloat(params.get('cfov'));
    if (isNum(cfov) && cfov >= 10 && cfov <= 150) pres.hfov = cfov;
    const cres = /^(\d{2,4})x(\d{2,4})$/.exec(params.get('cres') || '');
    if (cres) pres.res = [+cres[1], +cres[2]];
    if (root.PLVPresent) {
      pres.hud3 = root.PLVPresent.createM3Hud($('m3hud'));
      pres.pipOv = root.PLVPresent.createPipOverlay($('pipSvg'));
      pres.cineOv = root.PLVPresent.createCineOverlay($('cine'));
    }
    applyCamera();
    const sceneReady = (async () => {
      try {
        const city = await loadCity();
        state.city = city;
        state.scene = createScene($('scene'), city);
        if (state.store.length) state.scene.setData(state.store);
        applyCamera();
        state.scene.onTap = () => { if (state.recMode) togglePlay(); };
        if (state.store.length) state.scene.setData(state.store);
        render();
      } catch (e) {
        $('scene').appendChild(el('div', 'noscene', 'The 3D view is not available. ' + e.message));
        $('sceneCard').classList.add('no3d');
        document.querySelectorAll('#camSeg button, #todSeg button, #qSeg button, #resetBtn, #followBtn').forEach((b) => { b.disabled = true; });
      }
      $('sceneLoading').hidden = true;
      syncEmpty();
      syncViewbar();
    })();
    root.PLVDebug = {
      stats: () => (state.scene ? state.scene.stats() : null),
      // jump the cinematic clock (seconds) and pause it, for deterministic captures
      cineSeek: (c) => { if (!state.cine) startCine(); if (state.cine) { state.cine.c = c; state.cine.paused = true; state.cine.snap = true; state.cine.cam = null; } },
    };

    $('themeBtn').addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
    $('recBtn').addEventListener('click', () => setRecMode(!state.recMode));
    $('recExit').addEventListener('click', () => setRecMode(false));
    $('playBtn').addEventListener('click', togglePlay);
    $('followBtn').addEventListener('click', () => { state.follow = !state.follow; $('followBtn').setAttribute('aria-pressed', String(state.follow)); });
    $('resetBtn').addEventListener('click', () => { state.follow = false; if (state.scene) state.scene.resetView(); $('followBtn').setAttribute('aria-pressed', 'false'); });
    document.querySelectorAll('#camSeg button').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
    document.querySelectorAll('#todSeg button').forEach((b) => b.addEventListener('click', () => setTod(b.dataset.tod)));
    document.querySelectorAll('#qSeg button').forEach((b) => b.addEventListener('click', () => setQuality(b.dataset.q)));
    $('pipBtn').addEventListener('click', () => setPip(!pres.pip));
    $('swapBtn').addEventListener('click', swapViews);
    $('hudBtn').addEventListener('click', toggleHud);
    $('cineBtn').addEventListener('click', () => (state.cine ? stopCine() : startCine()));
    $('pip').addEventListener('click', () => { if (!state.cine) swapViews(); });
    new ResizeObserver(() => layoutViews()).observe($('sceneCard'));
    syncViewbar();
    document.querySelectorAll('#speeds button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
    $('runSelect').addEventListener('change', (ev) => { if (ev.target.value) loadFromParam(ev.target.value, true); });
    $('fileBtn').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', (ev) => { if (ev.target.files.length) loadFromFiles(ev.target.files); ev.target.value = ''; });
    window.addEventListener('dragover', (ev) => ev.preventDefault());
    window.addEventListener('drop', (ev) => { ev.preventDefault(); if (ev.dataTransfer && ev.dataTransfer.files.length) loadFromFiles(ev.dataTransfer.files); });
    window.addEventListener('keydown', (ev) => {
      if (ev.target && /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const onControl = !!(ev.target && ev.target.closest && ev.target.closest('button, a[href], summary, label'));
      if (ev.key === ' ') { if (onControl) return; togglePlay(); ev.preventDefault(); }
      else if (ev.key === 'Enter' && onControl) return;
      else if (ev.key === '?') toggleHelp();
      else if (ev.key === 'r' || ev.key === 'R') setRecMode(!state.recMode);
      else if (ev.key === 'Escape' && state.recMode) setRecMode(false);
      else if (ev.key === 't' || ev.key === 'T') applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      else if (ev.key === 'Home') setTime(0);
      else if (ev.key === 'End') setTime(state.dur);
      else if (ev.key === 'ArrowLeft' && ev.target === document.body) setTime(state.t - (ev.shiftKey ? 5 : 0.5));
      else if (ev.key === 'ArrowRight' && ev.target === document.body) setTime(state.t + (ev.shiftKey ? 5 : 0.5));
      else if (ev.key >= '1' && ev.key <= '4') setSpeed(SPEEDS[+ev.key - 1]);
      else if (ev.key === 'c' || ev.key === 'C') setCam(cycle(CAMS, state.scene ? state.scene.camera : sceneOpts.cam));
      else if (ev.key === 'l' || ev.key === 'L') setTod(cycle(TODS, state.scene ? state.scene.timeOfDay : sceneOpts.tod));
      else if (ev.key === 'q' || ev.key === 'Q') setQuality((state.scene ? state.scene.quality : sceneOpts.q) === 'high' ? 'low' : 'high');
      else if (ev.key === 'o' || ev.key === 'O') setPip(!pres.pip);
      else if (ev.key === 'v' || ev.key === 'V') swapViews();
      else if (ev.key === 'h' || ev.key === 'H') toggleHud();
      else if (ev.key === 'k' || ev.key === 'K') { if (state.cine) stopCine(); else startCine(); }
    });
    new ResizeObserver(() => { drawCharts(); }).observe($('panel'));
    wireScrub();
    window.matchMedia && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!document.documentElement.getAttribute('data-theme')) afterThemeChange(); });

    const sp = parseFloat(params.get('speed'));
    if (SPEEDS.includes(sp)) state.speed = sp;
    renderHeaderEmpty();
    const run = params.get('run');
    fillPicker(run);
    const start = async () => {
      if (run) await loadFromParam(run, false);
      await sceneReady;
      const t0 = parseFloat(params.get('t'));
      if (isNum(t0)) setTime(t0);
      if (params.get('rec') === '1') setRecMode(true);
      if (root.PLVCine && root.PLVCine.cineParams(location.search).cine) startCine();
      else if (params.get('autoplay') === '1') togglePlay();
      layoutViews();
      document.documentElement.setAttribute('data-ready', '1');
    };
    state.last = performance.now();
    requestAnimationFrame(tick);
    start();
    syncPlayButton();
  }

  function renderHeaderEmpty() {
    $('runId').textContent = 'No run loaded';
    state.summary = { verdict: 'unknown', mode: null, rows: [], source: 'none' };
    $('pills').textContent = '';
    showBanner('');
    syncEmpty();
  }
  function toggleHelp() {
    const d = $('help');
    d.open = !d.open;
    if (d.open && d.scrollIntoView) d.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
