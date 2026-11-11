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
    return { verdict, mode, rows };
  }

  /** Colour token for a mission-state / flight-mode name; stable per name. */
  const TOKEN_CYCLE = ['cyan', 'tdpc', 'vblue', 'lit', 'amber'];
  function stateToken(name, index) {
    const n = String(name || '').toLowerCase();
    if (/abort|fail|timeout|error|lost|crash/.test(n)) return 'red';
    if (/^(idle|wait|ready|disarm|done|complete|init)/.test(n)) return 'ink-3';
    if (/takeoff|climb|ascen/.test(n)) return 'vblue';
    if (/hold|hover|loiter|settle/.test(n)) return 'amber';
    if (/land|descen|touch/.test(n)) return 'lit';
    return TOKEN_CYCLE[Math.abs(index | 0) % TOKEN_CYCLE.length];
  }
  const DARK_TEXT_TOKENS = new Set(['cyan', 'tdpc', 'lit', 'amber']);

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
      return { store: parseViewer(raw), result, manifest, label: urls.dir };
    },
    async fromFiles(fileList) {
      const files = Array.from(fileList);
      const byName = {};
      files.forEach((f) => { byName[f.name.toLowerCase()] = f; });
      const vf = byName['viewer.json'] || (files.length === 1 ? files[0] : null);
      if (!vf) throw new Error('Select viewer.json (and optionally result.json and manifest.json) together.');
      const read = async (f) => { if (!f) return null; try { return JSON.parse(await f.text()); } catch (e) { throw new Error(f.name + ' is not valid JSON'); } };
      const [raw, result, manifest] = await Promise.all([read(vf), read(byName['result.json']), read(byName['manifest.json'])]);
      return { store: parseViewer(raw), result, manifest, label: vf.name };
    },
  };
  // M2+: LiveSource = { connect(url, store) } that calls store.append({t,n,e,d,alt,vz,mode,armed,state,hdg}).

  const api = {
    parseViewer, TelemetryStore, runLengths, niceTicks, formatTime, summarizeResult, stateToken, runUrls,
    lerpAngle, ReplaySource,
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
    t: 0, dur: 0, playing: false, speed: 1, last: 0, scene: null, events: [], recMode: false, follow: false,
    lastEvt: '',
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    try { if (theme) localStorage.setItem('plv-theme', theme); } catch (e) { /* storage unavailable */ }
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
      return { bg: tokenColor(tok), fg: DARK_TEXT_TOKENS.has(tok) ? '#0d1115' : '#ffffff' };
    };
    const runsA = runLengths(tt, lt.codes, end);
    bandRow($('bandState'), runsA, lt.names, stateColor, (r) => lt.names[r.code] + ' · ' + r.t0.toFixed(1) + '–' + r.t1.toFixed(1) + ' s', true);
    bandRow($('recBand'), runsA, lt.names, stateColor, () => '', false);
    const runsM = runLengths(tt, st.cols.mode, end);
    bandRow($('bandMode'), runsM, st.modes, () => null, (r) => 'mode ' + st.modes[r.code] + ' · ' + r.t0.toFixed(1) + '–' + r.t1.toFixed(1) + ' s', true);
    const runsR = runLengths(tt, st.cols.armed, end);
    bandRow($('bandArmed'), runsR, ['disarmed', 'armed'], (r) => (r.code ? { bg: css('amber'), fg: '#0d1115' } : null), (r) => (r.code ? 'armed' : 'disarmed') + ' · ' + r.t0.toFixed(1) + '–' + r.t1.toFixed(1) + ' s', false);
    // event ticks on the state band
    const ev = $('eventTicks');
    ev.textContent = '';
    state.events.forEach((e) => {
      const m = el('i', e.failed ? 'ev bad' : 'ev');
      m.style.left = (state.dur ? (e.t / state.dur) * 100 : 0) + '%';
      m.title = e.t.toFixed(1) + ' s · ' + e.kind;
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
    const v = el('span', 'pill ' + sum.verdict, sum.verdict === 'pass' ? 'PASS' : sum.verdict === 'fail' ? 'FAIL' : 'NO RESULT');
    v.title = 'Outcome reported by the runner in result.json. Not independently checked; use `plv check` for structural validity.';
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
    $('derivedNote').hidden = !sum.rows.some((r) => r.derived);
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
  }

  function setRun(bundle) {
    state.store = bundle.store;
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
    showBanner(bundle.store.length ? '' : 'This run has no telemetry samples (empty series).', 'warn');
    if (state.scene) state.scene.setData(bundle.store);
    renderHeader();
    buildBands();
    drawCharts();
    syncPlayButton();
    render();
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
    let samples = [];
    try { samples = ((await fetchJson('samples/index.json', true)) || {}).samples || []; } catch (e) { /* none */ }
    add('Sample runs (synthetic)', samples.filter((s) => s && typeof s.path === 'string' && typeof s.label === 'string'));
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
    const norm = (p) => (p || '').replace(/\/?$/, '/');
    const hit = Array.from(sel.options).find((o) => o.value && norm(o.value) === norm(current));
    sel.value = hit ? hit.value : '';
  }

  /* ---------- transport ---------- */
  function syncPlayButton() {
    const b = $('playBtn');
    b.textContent = state.playing ? 'Pause' : (state.t >= state.dur - 1e-6 && state.dur > 0.01 ? 'Replay' : 'Play');
    b.setAttribute('aria-pressed', state.playing ? 'true' : 'false');
    document.querySelectorAll('#speeds button').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.speed === state.speed)));
  }
  function setTime(t) { state.t = Math.min(Math.max(t, 0), state.dur); render(); syncPlayButton(); }
  function togglePlay() {
    if (!state.store.length) return;
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
    if (evt !== state.lastEvt) { state.lastEvt = evt; $('evtNow').textContent = evt; $('hudEvt').textContent = evt; }
    if (!s) { $('hudAlt').textContent = '–'; $('hudVs').textContent = '–'; if (state.scene) state.scene.update(null, 0); return; }
    const st = state.store;
    const lt = st.labelTable();
    const sname = st.hasState ? st.states[s.state] : st.modes[s.mode];
    const tok = stateToken(lt.names[s.code], s.code);
    $('hudAlt').textContent = s.alt.toFixed(2);
    $('hudVs').textContent = (-s.vz >= 0 ? '+' : '−') + Math.abs(s.vz).toFixed(2);
    const chip = $('hudState');
    chip.textContent = sname || '';
    chip.style.background = tokenColor(tok);
    chip.style.color = DARK_TEXT_TOKENS.has(tok) ? '#0d1115' : '#fff';
    $('hudFmode').textContent = st.modes[s.mode] || '';
    $('hudArm').textContent = s.armed ? 'ARMED' : 'DISARMED';
    $('hudArm').className = s.armed ? 'armed' : '';
    $('valAlt').textContent = s.alt.toFixed(2) + ' m';
    $('valVz').textContent = (-s.vz >= 0 ? '+' : '−') + Math.abs(s.vz).toFixed(2) + ' m/s';
    if (state.scene) state.scene.update(s, state.playing ? 1 : 0);
  }

  function tick(now) {
    const dt = Math.min(0.1, (now - state.last) / 1000);
    state.last = now;
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
  }

  /* ===================== three.js scene ===================== */
  // World: x = East, y = Up, z = South (right-handed). North is -z. Altitude above the deck = y.
  const DRONE_SCALE = 1.5; // drawn larger than a 0.6 m airframe so it reads at distance

  function createScene(container) {
    if (typeof THREE === 'undefined') throw new Error('three.js did not load (offline?). Charts and timeline still work.');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a8, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.38);
    sun.position.set(-6, 12, 8);
    scene.add(sun);

    const M = (c) => new THREE.MeshLambertMaterial({ color: c });
    const roofMat = M(0xcccccc), parapetMat = M(0x999999), plinthMat = M(0x888888);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 10), roofMat);
    roof.position.set(0, -0.95, 0);
    scene.add(roof);
    [[0, -5, 14, 0.25], [0, 5, 14, 0.25], [-7, 0, 0.25, 10], [7, 0, 0.25, 10]].forEach((p) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p[2], 0.4, p[3]), parapetMat);
      m.position.set(p[0], -0.75, p[1]);
      scene.add(m);
    });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.8, 2.7), plinthMat);
    plinth.position.set(0, -0.5, 0);
    scene.add(plinth);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 3), M(0x555555));
    slab.position.set(0, -0.05, 0);
    scene.add(slab);

    const padCanvas = document.createElement('canvas');
    padCanvas.width = padCanvas.height = 1536;
    const padTex = new THREE.CanvasTexture(padCanvas);
    if (THREE.sRGBEncoding) padTex.encoding = THREE.sRGBEncoding;
    padTex.anisotropy = 8;
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: padTex }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.003;
    scene.add(pad);

    // Drone: forward is -z (north); heading rotates about y, clockwise from north.
    const drone = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.2), new THREE.MeshLambertMaterial({ color: 0x20262c }));
    drone.add(body);
    const armMat = new THREE.MeshLambertMaterial({ color: 0x3a434b });
    [Math.PI / 4, -Math.PI / 4].forEach((a) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.02, 0.03), armMat);
      arm.rotation.y = a;
      drone.add(arm);
    });
    const rotors = [];
    const rotorMat = new THREE.MeshBasicMaterial({ color: 0x3fd0ee, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach((q) => {
      const g = new THREE.Group();
      g.position.set(q[0] * 0.22, 0.04, q[1] * 0.22);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), rotorMat);
      disc.rotation.x = -Math.PI / 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.004, 0.025), new THREE.MeshBasicMaterial({ color: 0xe9f3f6 }));
      g.add(disc, blade);
      drone.add(g);
      rotors.push(blade);
    });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 8), new THREE.MeshBasicMaterial({ color: 0xffb000 }));
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0, -0.16);
    drone.add(nose);
    drone.scale.setScalar(DRONE_SCALE);
    scene.add(drone);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.28 * DRONE_SCALE, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);
    const dropGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]);
    const dropMat = new THREE.LineBasicMaterial({ color: 0x3fd0ee, transparent: true, opacity: 0.55 });
    const drop = new THREE.Line(dropGeo, dropMat);
    scene.add(drop);

    // Trail: one cylinder instance per segment, coloured per segment by mission state.
    let trail = null, pts = [], segMats = [], headIdx = -1, ruler = null;
    const yAxis = new THREE.Vector3(0, 1, 0);
    function segMatrix(a, b, out) {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const q = new THREE.Quaternion();
      if (len > 1e-9) q.setFromUnitVectors(yAxis, dir.divideScalar(len));
      out.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(0.028, Math.max(len, 1e-6), 0.028));
      return out;
    }

    const colors = {};
    function readColors() {
      ['roof', 'parapet', 'deck', 'deck-sa', 'tlof', 'mark', 'tdpc', 'vblue', 'lit', 'ink-2', 'ink-3', 'sky'].forEach((k) => { colors[k] = css(k); });
    }

    function drawPad() {
      const g = padCanvas.getContext('2d');
      const S = padCanvas.width, ppm = S / 3, cx = S / 2;
      const m = (v) => v * ppm;
      g.fillStyle = colors['deck-sa']; g.fillRect(0, 0, S, S);
      g.fillStyle = colors.deck; g.fillRect(cx - m(1), cx - m(1), m(2), m(2));
      g.fillStyle = colors.tlof; g.fillRect(cx - m(0.5), cx - m(0.5), m(1), m(1));
      g.strokeStyle = colors.mark; g.lineWidth = m(0.04);
      g.setLineDash([m(0.15), m(0.15)]);
      g.strokeRect(cx - m(0.97), cx - m(0.97), m(1.94), m(1.94));
      g.setLineDash([]);
      g.lineWidth = m(0.03);
      g.strokeRect(cx - m(0.485), cx - m(0.485), m(0.97), m(0.97));
      g.strokeStyle = colors.tdpc; g.lineWidth = m(0.04);
      g.beginPath(); g.arc(cx, cx, m(0.27), 0, Math.PI * 2); g.stroke();
      // Decorative 10x10-module tag (1-module quiet zone, black border, pseudo-random 6x6 payload).
      // Not a real AprilTag id; the Gazebo world supplies the real tag in M2.
      const cell = m(0.03), x0 = cx - cell * 5;
      g.fillStyle = '#ffffff'; g.fillRect(x0, x0, cell * 10, cell * 10);
      g.fillStyle = '#111111'; g.fillRect(x0 + cell, x0 + cell, cell * 8, cell * 8);
      let seed = 11;
      for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        g.fillStyle = (seed >> 16) & 1 ? '#ffffff' : '#111111';
        g.fillRect(x0 + cell * (2 + c), x0 + cell * (2 + r), cell, cell);
      }
      // V ident and approach bar to the south
      g.fillStyle = colors.vblue; g.beginPath(); g.arc(cx, cx + m(0.38), m(0.1), 0, Math.PI * 2); g.fill();
      g.strokeStyle = colors.mark; g.lineWidth = m(0.022); g.lineJoin = 'miter';
      g.beginPath(); g.moveTo(cx - m(0.055), cx + m(0.335)); g.lineTo(cx, cx + m(0.435)); g.lineTo(cx + m(0.055), cx + m(0.335)); g.stroke();
      g.fillStyle = colors.mark; g.fillRect(cx - m(0.125), cx + m(0.44), m(0.25), m(0.03));
      // perimeter lights: 16 around the TLOF, 8 around the FATO
      const light = (x, y) => {
        const gr = g.createRadialGradient(x, y, 0, x, y, m(0.07));
        gr.addColorStop(0, 'rgba(125,255,174,0.95)'); gr.addColorStop(0.4, 'rgba(47,209,107,0.55)'); gr.addColorStop(1, 'rgba(47,209,107,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, m(0.07), 0, Math.PI * 2); g.fill();
        g.fillStyle = '#c9ffe0'; g.beginPath(); g.arc(x, y, m(0.016), 0, Math.PI * 2); g.fill();
      };
      const ring = (half, n) => {
        for (let k = 0; k < n; k++) {
          const s = (k / n) * 8 * half; // along the square perimeter
          const side = Math.floor(s / (2 * half)), u = s - side * 2 * half - half;
          const p = [[u, -half], [half, u], [-u, half], [-half, -u]][side];
          light(cx + m(p[0]), cx + m(p[1]));
        }
      };
      ring(0.55, 16);
      ring(1.07, 8);
      padTex.needsUpdate = true;
    }

    function textSprite(text) {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 48;
      const g = c.getContext('2d');
      g.font = '600 34px ' + (getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace');
      g.fillStyle = colors['ink-2']; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillText(text, 6, 26);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
      sp.scale.set(1.0, 0.375, 1);
      sp.center.set(0, 0.5);
      return sp;
    }

    function buildRuler(maxAlt) {
      if (ruler) { scene.remove(ruler); ruler.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }
      ruler = new THREE.Group();
      const top = Math.max(2, Math.ceil(maxAlt + 1));
      const v = [0, 0, 0, 0, top, 0];
      for (let a = 1; a <= top; a++) { const L = a % 5 === 0 ? 0.28 : 0.14; v.push(0, a, 0, L, a, 0); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      ruler.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(colors['ink-3']) })));
      const every = top > 12 ? 5 : 2;
      for (let a = every; a <= top; a += every) { const s = textSprite(a + ' m'); s.position.set(0.32, a, 0); ruler.add(s); }
      ruler.position.set(-1.9, 0, 1.9);
      scene.add(ruler);
    }

    function refreshTheme() {
      readColors();
      roofMat.color.set(colors.roof); parapetMat.color.set(colors.parapet); plinthMat.color.set(colors.parapet);
      scene.background = new THREE.Color(colors.sky);
      drawPad();
      if (state.store.length) { buildRuler(maxAltOf(state.store)); recolorTrail(); } else buildRuler(6);
      dirty = true;
    }
    const maxAltOf = (st) => st.cols.alt.reduce((a, b) => Math.max(a, b), 0);

    function recolorTrail() {
      if (!trail) return;
      const lt = state.store.labelTable();
      const c = new THREE.Color();
      pts.forEach((p, i) => { c.set(tokenColor(stateToken(lt.names[p.code], p.code))); trail.setColorAt(i, c); });
      if (trail.instanceColor) trail.instanceColor.needsUpdate = true;
    }

    const toWorld = (s, out) => out.set(s.e - state.store.pad.e, -s.d, -(s.n - state.store.pad.n));

    function setData(st) {
      if (trail) { scene.remove(trail); trail.geometry.dispose(); trail.material.dispose(); trail = null; }
      pts = []; segMats = []; headIdx = -1;
      const stride = Math.max(1, Math.ceil(st.length / 3000));
      let lastP = null;
      for (let i = 0; i < st.length; i += stride) {
        const p = new THREE.Vector3(st.cols.e[i] - st.pad.e, -st.cols.d[i], -(st.cols.n[i] - st.pad.n));
        const tt = st.cols.t[i];
        if (lastP && p.distanceTo(lastP.p) < 0.02 && tt - lastP.t < 0.25 && st.cols.state[i] === st.cols.state[lastP.i]) continue;
        const rec = { p, t: tt, i, code: st.hasState ? st.cols.state[i] : st.cols.mode[i] };
        pts.push(rec); lastP = rec;
      }
      if (pts.length) {
        trail = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), new THREE.MeshBasicMaterial(), pts.length);
        trail.frustumCulled = false;
        for (let i = 0; i < pts.length; i++) {
          const m = new THREE.Matrix4();
          segMatrix(pts[i].p, pts[Math.min(i + 1, pts.length - 1)].p, m);
          segMats.push(m); trail.setMatrixAt(i, m);
        }
        scene.add(trail);
        recolorTrail();
        trail.count = 0;
      }
      buildRuler(maxAltOf(st));
      const f = st.length ? st.sampleAt(0) : null;
      if (f) { orbit.target.set(0, Math.max(2.2, maxAltOf(st) * 0.5), 0); orbit.dist = Math.max(10, maxAltOf(st) * 1.7 + 5.5); }
      dirty = true;
    }

    // ---- camera orbit: drag to rotate, wheel / pinch to zoom ----
    const orbit = { az: 0.6, pol: 1.12, dist: 13, target: new THREE.Vector3(0, 2.5, 0) };
    const home = { az: 0.6, pol: 1.12 };
    function placeCamera() {
      const sp = Math.sin(orbit.pol);
      camera.position.set(orbit.target.x + orbit.dist * sp * Math.sin(orbit.az), orbit.target.y + orbit.dist * Math.cos(orbit.pol), orbit.target.z + orbit.dist * sp * Math.cos(orbit.az));
      camera.lookAt(orbit.target);
    }
    const pointers = new Map();
    let moved = 0, dirty = true, pinch0 = 0;
    canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture(ev.pointerId); pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); moved = 0; pinch0 = 0; });
    canvas.addEventListener('pointermove', (ev) => {
      const p = pointers.get(ev.pointerId);
      if (!p) return;
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
      p.x = ev.clientX; p.y = ev.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 1) {
        orbit.az -= dx * 0.007;
        orbit.pol = Math.min(1.5, Math.max(0.12, orbit.pol - dy * 0.007));
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0) orbit.dist = Math.min(60, Math.max(2.5, orbit.dist * (pinch0 / d)));
        pinch0 = d;
      }
      dirty = true;
    });
    const up = (ev) => {
      pointers.delete(ev.pointerId);
      pinch0 = 0;
      if (ev.type === 'pointerup' && pointers.size === 0 && moved < 5 && api.onTap) api.onTap();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); orbit.dist = Math.min(60, Math.max(2.5, orbit.dist * Math.exp(ev.deltaY * 0.001))); dirty = true; }, { passive: false });

    function resize() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      canvas.style.width = '100%'; canvas.style.height = '100%';
      camera.aspect = w / h;
      // keep the pad framed on tall/narrow viewports
      camera.fov = camera.aspect < 1.1 ? 52 : 40;
      camera.updateProjectionMatrix();
      dirty = true;
    }
    new ResizeObserver(resize).observe(container);

    const tmp = new THREE.Vector3();
    let spin = 0, curArmed = 0, curAlt = 0, hasSample = false;
    function update(s) {
      hasSample = !!s;
      if (!s) { drone.visible = shadow.visible = drop.visible = false; if (trail) trail.count = 0; dirty = true; return; }
      drone.visible = shadow.visible = drop.visible = true;
      toWorld(s, tmp);
      drone.position.copy(tmp).y += 0.05 * DRONE_SCALE;
      drone.rotation.y = -(s.hdg * Math.PI) / 180;
      curArmed = s.armed; curAlt = s.alt;
      const onPad = Math.abs(tmp.x) < 1.6 && Math.abs(tmp.z) < 1.6;
      const gy = onPad ? 0.006 : -0.89;
      shadow.position.set(tmp.x, gy, tmp.z);
      const k = Math.max(0.35, 1 - (tmp.y - gy) * 0.06);
      shadow.scale.setScalar(k); shadow.material.opacity = 0.32 * k;
      drop.position.set(tmp.x, tmp.y, tmp.z);
      drop.scale.set(1, Math.max(0.001, tmp.y - gy), 1);
      // trail up to t, with a live head segment ending at the drone
      if (trail) {
        let lo = 0, hi = pts.length - 1, k2 = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (pts[mid].t <= s.t) { k2 = mid; lo = mid + 1; } else hi = mid - 1; }
        if (headIdx >= 0 && headIdx < segMats.length) trail.setMatrixAt(headIdx, segMats[headIdx]);
        headIdx = -1;
        if (k2 >= 0) {
          const hm = new THREE.Matrix4();
          segMatrix(pts[k2].p, tmp, hm);
          trail.setMatrixAt(k2, hm);
          headIdx = k2;
        }
        trail.count = k2 + 1;
        trail.instanceMatrix.needsUpdate = true;
      }
      if (state.follow) orbit.target.lerp(tmp, 0.18);
      dirty = true;
    }
    function frame(dt, playing) {
      if (playing && hasSample && curArmed) { spin += dt * 60; rotors.forEach((r, i) => { r.rotation.y = spin * (i % 2 ? 1 : -1); }); dirty = true; }
      if (dirty) { dirty = false; placeCamera(); renderer.render(scene, camera); }
    }
    function resetView() { orbit.az = home.az; orbit.pol = home.pol; orbit.dist = Math.max(10, maxAltOf(state.store) * 1.7 + 5.5); orbit.target.set(0, Math.max(2.2, maxAltOf(state.store) * 0.5), 0); state.follow = false; dirty = true; }

    const api = { setData, update, frame, resize, refreshTheme, resetView, onTap: null };
    readColors();
    refreshTheme();
    resize();
    return api;
  }

  /* ---------- boot ---------- */
  function boot() {
    document.documentElement.style.setProperty('--gutter', GUTTER + 'px');
    document.documentElement.style.setProperty('--rgutter', RGUTTER + 'px');
    const params = new URLSearchParams(location.search);
    let theme = params.get('theme');
    if (theme !== 'light' && theme !== 'dark') { try { theme = localStorage.getItem('plv-theme'); } catch (e) { theme = null; } }
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);

    try {
      state.scene = createScene($('scene'));
      state.scene.onTap = () => { if (state.recMode) togglePlay(); };
    } catch (e) {
      $('scene').appendChild(el('div', 'noscene', '3D view unavailable: ' + e.message));
    }

    $('themeBtn').addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
    $('recBtn').addEventListener('click', () => setRecMode(!state.recMode));
    $('recExit').addEventListener('click', () => setRecMode(false));
    $('playBtn').addEventListener('click', togglePlay);
    $('followBtn').addEventListener('click', () => { state.follow = !state.follow; $('followBtn').setAttribute('aria-pressed', String(state.follow)); });
    $('resetBtn').addEventListener('click', () => { if (state.scene) state.scene.resetView(); $('followBtn').setAttribute('aria-pressed', 'false'); });
    document.querySelectorAll('#speeds button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
    $('runSelect').addEventListener('change', (ev) => { if (ev.target.value) loadFromParam(ev.target.value, true); });
    $('fileInput').addEventListener('change', (ev) => { if (ev.target.files.length) loadFromFiles(ev.target.files); ev.target.value = ''; });
    window.addEventListener('dragover', (ev) => ev.preventDefault());
    window.addEventListener('drop', (ev) => { ev.preventDefault(); if (ev.dataTransfer && ev.dataTransfer.files.length) loadFromFiles(ev.dataTransfer.files); });
    window.addEventListener('keydown', (ev) => {
      if (ev.target && /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === ' ') { togglePlay(); ev.preventDefault(); }
      else if (ev.key === 'r' || ev.key === 'R') setRecMode(!state.recMode);
      else if (ev.key === 'Escape' && state.recMode) setRecMode(false);
      else if (ev.key === 't' || ev.key === 'T') applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      else if (ev.key === 'Home') setTime(0);
      else if (ev.key === 'End') setTime(state.dur);
      else if (ev.key === 'ArrowLeft' && ev.target === document.body) setTime(state.t - (ev.shiftKey ? 5 : 0.5));
      else if (ev.key === 'ArrowRight' && ev.target === document.body) setTime(state.t + (ev.shiftKey ? 5 : 0.5));
      else if (ev.key >= '1' && ev.key <= '4') setSpeed(SPEEDS[+ev.key - 1]);
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
      const t0 = parseFloat(params.get('t'));
      if (isNum(t0)) setTime(t0);
      if (params.get('autoplay') === '1') togglePlay();
      if (params.get('rec') === '1') setRecMode(true);
      document.documentElement.setAttribute('data-ready', '1');
    };
    state.last = performance.now();
    requestAnimationFrame(tick);
    start();
    syncPlayButton();
  }

  function renderHeaderEmpty() {
    $('runId').textContent = 'No run loaded';
    state.summary = { verdict: 'unknown', mode: null, rows: [] };
    $('pills').textContent = '';
    showBanner('Pick a sample run above, add ?run=<directory> to the URL, or load viewer.json (plus result.json and manifest.json) from disk.', 'info');
  }

  boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
