// Run: node --test viewer/tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../app.js');

const good = () => ({
  schema_version: 1, run_id: 'x', modes: ['STABILIZE', 'GUIDED'], states: ['idle', 'takeoff'],
  series: {
    t: [0, 1, 2], n: [0, 0, 0], e: [0, 0, 0], d: [0, -1, -2], alt: [0, 1, 2], vz: [0, -1, -1],
    mode: [0, 1, 1], armed: [0, 1, 1], state: [0, 1, 1], hdg: [350, 10, 10],
  },
});

test('parseViewer accepts a valid file and exposes columns', () => {
  const s = P.parseViewer(good());
  assert.equal(s.length, 3);
  assert.equal(s.endTime, 2);
  assert.equal(s.hasState, true);
});

test('parseViewer rejects bad schema, length, order and indices', () => {
  const bad = (mut, re) => { const o = good(); mut(o); assert.throws(() => P.parseViewer(o), re); };
  bad((o) => { o.schema_version = 2; }, /schema_version/);
  bad((o) => { o.series.alt.pop(); }, /series\.alt has length/);
  bad((o) => { o.series.t[1] = -1; }, /negative|nondecreasing/);
  bad((o) => { o.series.t = [0, 2, 1]; }, /nondecreasing/);
  bad((o) => { o.series.mode[0] = 5; }, /modes/);
  bad((o) => { o.series.armed[0] = 2; }, /armed/);
  bad((o) => { o.series.vz[0] = null; }, /finite/);
  bad((o) => { delete o.states; }, /states/);
});

test('mission state is optional; labels fall back to flight mode', () => {
  const o = good(); delete o.series.state; delete o.states;
  const s = P.parseViewer(o);
  assert.equal(s.hasState, false);
  assert.deepEqual(s.labelTable().names, ['STABILIZE', 'GUIDED']);
});

test('sampleAt interpolates numbers, holds steps, wraps heading', () => {
  const s = P.parseViewer(good());
  const a = s.sampleAt(0.5);
  assert.equal(a.alt, 0.5);
  assert.equal(a.mode, 0);          // step value from the earlier sample
  assert.ok(Math.abs(a.hdg - 0) < 1e-9 || Math.abs(a.hdg - 360) < 1e-9); // 350 -> 10 passes through north
  assert.equal(s.sampleAt(-5).index, 0);
  assert.equal(s.sampleAt(99).alt, 2);
});

test('append keeps time monotonic (live-source path)', () => {
  const s = P.parseViewer(good());
  s.append({ t: 3, n: 0, e: 0, d: -2, alt: 2, vz: 0, mode: 1, armed: 1, state: 1, hdg: 10 });
  assert.equal(s.length, 4);
  assert.throws(() => s.append({ t: 1, n: 0, e: 0, d: 0, alt: 0, vz: 0, mode: 0, armed: 0, state: 0, hdg: 0 }), /backwards/);
});

test('runLengths groups codes and closes the last run at tEnd', () => {
  assert.deepEqual(P.runLengths([0, 1, 2, 3], [0, 0, 1, 1], 5).map((r) => [r.code, r.t0, r.t1]), [[0, 0, 2], [1, 2, 5]]);
  assert.deepEqual(P.runLengths([], [], 5), []);
});

test('niceTicks and formatTime', () => {
  const t = P.niceTicks(0, 6.4, 5);
  assert.deepEqual(t.ticks, [0, 2, 4, 6, 8]);
  assert.equal(P.niceTicks(3, 3, 5).ticks.length > 1, true);
  assert.equal(P.formatTime(65.25), '1:05.3');
  assert.equal(P.formatTime(-1), '0:00.0');
});

test('summarizeResult: verdict, failure rows, derived values', () => {
  const store = P.parseViewer(good());
  const ok = P.summarizeResult({ success: true, failure_reason: null, duration_us: 2000000, seed: 1, scenario: { name: 's' } }, { mode: 'truth' }, store);
  assert.equal(ok.verdict, 'pass'); assert.equal(ok.mode, 'truth');
  assert.ok(ok.rows.some((r) => r.k === 'Peak altitude' && r.derived));
  const bad = P.summarizeResult({ success: false, failure_reason: { code: 'timeout', detail: 'late' } }, null, null);
  assert.equal(bad.verdict, 'fail');
  assert.ok(bad.rows.some((r) => r.k === 'Failure' && r.v === 'timeout'));
  assert.equal(P.summarizeResult(null, null, null).verdict, 'unknown');
});

test('operator verdict is labelled as operator, never as a runner result', () => {
  const op = P.summarizeResult({ derived: true, success: true, verdict: 'PASS', verdict_source: 'operator' }, null, null);
  assert.equal(op.source, 'operator');
  for (const success of [true, false]) {
    const sum = P.summarizeResult({ success, verdict_source: 'operator' }, null, null);
    const l = P.verdictLabels(sum);
    assert.match(l.pill, /operator/i);
    assert.match(l.resultEy, /OPERATOR/);
    for (const text of [l.pillTitle, l.resultEy, l.foot, l.note]) assert.doesNotMatch(text, /reported (by the runner|outcome)|runner's reported/i);
    assert.match(l.foot, /operator/i);
  }
  const rn = P.summarizeResult({ success: true }, null, null);
  assert.equal(rn.source, 'runner');
  assert.match(P.verdictLabels(rn).resultEy, /RUNNER/);
  assert.equal(P.summarizeResult(null, null, null).source, 'none');
});

test('stateToken is stable and flags failures red', () => {
  assert.equal(P.stateToken('timeout', 0), 'red');
  assert.equal(P.stateToken('takeoff', 3), 'vblue');
  assert.equal(P.stateToken('mystery', 1), P.stateToken('mystery', 1));
});

test('runUrls: directory, file, and cross-origin rejection', () => {
  const base = 'http://127.0.0.1:8765/viewer/index.html';
  const d = P.runUrls('samples/a', base);
  assert.equal(d.viewer, 'http://127.0.0.1:8765/viewer/samples/a/viewer.json');
  assert.equal(d.result, 'http://127.0.0.1:8765/viewer/samples/a/result.json');
  assert.equal(P.runUrls('/runs/R1/viewer.json', base).manifest, 'http://127.0.0.1:8765/runs/R1/manifest.json');
  assert.throws(() => P.runUrls('https://example.com/x/', base), /same-origin/);
});

test('shipped sample runs parse and agree with their result.json', () => {
  const dir = path.join(__dirname, '..', 'samples');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).samples;
  assert.equal(index.length, 2);
  for (const e of index) {
    const base = path.join(dir, e.path.replace(/^samples\//, ''));
    const store = P.parseViewer(JSON.parse(fs.readFileSync(path.join(base, 'viewer.json'), 'utf8')));
    const result = JSON.parse(fs.readFileSync(path.join(base, 'result.json'), 'utf8'));
    assert.ok(store.length > 100);
    assert.ok(store.endTime <= result.duration_us / 1e6 + 1e-9);
    assert.equal(result.run_id, store.runId);
  }
});

test('stateToken gives each M3 phase its own colour', () => {
  const toks = ['takeoff', 'search', 'approach', 'descend', 'landed'].map((n, i) => P.stateToken(n, i));
  assert.equal(new Set(toks).size, toks.length);
  assert.equal(P.stateToken('land', 3), 'lit');
  assert.equal(P.stateToken('landed', 5), 'landed');
  assert.equal(P.stateToken('target_lost', 2), 'red');
});

test('contrastRatio follows WCAG 2.1 and readableOn picks the stronger text colour', () => {
  assert.equal(P.contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(P.contrastRatio('#fff', '#ffffff'), 1);
  assert.ok(Math.abs(P.contrastRatio('#777777', '#ffffff') - 4.48) < 0.01);
  assert.ok(Number.isNaN(P.contrastRatio('rgb(0,0,0)', '#fff')));
  assert.equal(P.luminance('not a colour'), null);
  assert.equal(P.readableOn('#2a5bd7'), '#ffffff'); // light-theme blue
  assert.equal(P.readableOn('#7d9dff'), '#0d1115'); // dark-theme blue: white text has 2.6:1 only
  assert.equal(P.readableOn('#f0c02e'), '#0d1115');
  assert.equal(P.readableOn('var(--x)'), '#ffffff');
  for (const bg of ['#2a5bd7', '#7d9dff', '#626a73', '#8a949e', '#06788f', '#3fd0ee', '#f0c02e', '#2fd16b', '#1a7a3e', '#1f9a52', '#d98a00', '#cf3a2c']) {
    assert.ok(P.contrastRatio(bg, P.readableOn(bg)) >= 4.5, bg + ' label contrast');
  }
});

test('fmtSigned never shows a negative zero', () => {
  assert.equal(P.fmtSigned(1.756, 2), '+1.76');
  assert.equal(P.fmtSigned(-0.32, 2), '−0.32');
  assert.equal(P.fmtSigned(-0.004, 2), '+0.00');
  assert.equal(P.fmtSigned(0, 2), '+0.00');
  assert.equal(P.fmtSigned(-0.005, 1), '+0.0');
  assert.equal(P.fmtSigned(NaN, 2), '–');
});

test('eventLabel makes event kinds readable', () => {
  assert.equal(P.eventLabel('state:hold'), 'State: hold');
  assert.equal(P.eventLabel('mode_land'), 'Mode land');
  assert.equal(P.eventLabel('wait_altitude_timeout'), 'Wait altitude timeout');
  assert.equal(P.eventLabel(''), '');
  assert.equal(P.eventLabel(undefined), '');
});
