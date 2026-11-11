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

  /* ===================== three.js scene (built in world.js) ===================== */
  // World: x = East, y = Up, z = South (right-handed). North is -z. Altitude above the deck = y.
  const sceneOpts = { cam: 'chase', tod: 'day', q: 'high', wind: null };
  const CAMS = ['chase', 'orbit', 'top', 'city'], TODS = ['day', 'golden', 'dusk'];

  function createScene(container, city) {
    if (typeof THREE === 'undefined' || !root.PLVWorld) throw new Error('three.js did not load (offline?). Charts and timeline still work.');
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
  function setCam(c) { sceneOpts.cam = c; if (state.scene) state.scene.setCamera(c); syncViewbar(); }
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
    if (theme !== 'light' && theme !== 'dark') { try { theme = localStorage.getItem('plv-theme'); } catch (e) { theme = null; } }
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
    const sceneReady = (async () => {
      try {
        const city = await loadCity();
        state.scene = createScene($('scene'), city);
        state.scene.onTap = () => { if (state.recMode) togglePlay(); };
        if (state.store.length) state.scene.setData(state.store);
        render();
      } catch (e) {
        $('scene').appendChild(el('div', 'noscene', '3D view unavailable: ' + e.message));
      }
      syncViewbar();
    })();
    root.PLVDebug = { stats: () => (state.scene ? state.scene.stats() : null) };

    $('themeBtn').addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
    $('recBtn').addEventListener('click', () => setRecMode(!state.recMode));
    $('recExit').addEventListener('click', () => setRecMode(false));
    $('playBtn').addEventListener('click', togglePlay);
    $('followBtn').addEventListener('click', () => { state.follow = !state.follow; $('followBtn').setAttribute('aria-pressed', String(state.follow)); });
    $('resetBtn').addEventListener('click', () => { state.follow = false; if (state.scene) state.scene.resetView(); $('followBtn').setAttribute('aria-pressed', 'false'); });
    document.querySelectorAll('#camSeg button').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
    document.querySelectorAll('#todSeg button').forEach((b) => b.addEventListener('click', () => setTod(b.dataset.tod)));
    document.querySelectorAll('#qSeg button').forEach((b) => b.addEventListener('click', () => setQuality(b.dataset.q)));
    syncViewbar();
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
      else if (ev.key === 'c' || ev.key === 'C') setCam(cycle(CAMS, state.scene ? state.scene.camera : sceneOpts.cam));
      else if (ev.key === 'l' || ev.key === 'L') setTod(cycle(TODS, state.scene ? state.scene.timeOfDay : sceneOpts.tod));
      else if (ev.key === 'q' || ev.key === 'Q') setQuality((state.scene ? state.scene.quality : sceneOpts.q) === 'high' ? 'low' : 'high');
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
