// Run: node --test viewer/tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../hud-core.js');
const P = require('../app.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < (eps || 1e-9), (msg || '') + ' expected ' + b + ', got ' + a);

test('cameraIntrinsics: pinhole focal length and vertical FOV from the horizontal FOV', () => {
  const k = H.cameraIntrinsics(640, 480, 90);
  near(k.fx, 320, 1e-9, 'fx at 90 deg');
  assert.equal(k.cx, 320); assert.equal(k.cy, 240); assert.equal(k.fy, k.fx);
  near(k.vfov, (2 * Math.atan(240 / 320) * 180) / Math.PI, 1e-9);
  const d = H.cameraIntrinsics();
  assert.equal(d.width, 640); assert.equal(d.height, 480); assert.equal(d.hfov, 70);
  assert.equal(H.cameraIntrinsics(640, 480, 500).hfov, 150, 'FOV is clamped');
});

test('projectNadir: centre, axes, heading and scale', () => {
  const k = H.cameraIntrinsics(640, 480, 90); // fx = 320
  const cam = { n: 0, e: 0, d: -4, yawDeg: 0 }; // 4 m up, facing north
  const c = H.projectNadir(k, cam, { n: 0, e: 0, d: 0 });
  near(c.u, 320); near(c.v, 240); assert.equal(c.z, 4); assert.ok(c.inImage);
  const east = H.projectNadir(k, cam, { n: 0, e: 1, d: 0 });
  near(east.u, 320 + 320 / 4, 1e-9, 'east is right when facing north'); near(east.v, 240);
  const north = H.projectNadir(k, cam, { n: 1, e: 0, d: 0 });
  near(north.v, 240 - 80, 1e-9, 'north is up when facing north'); near(north.u, 320);
  // facing east (yaw 90): a point to the east is ahead (up), a point to the south is right
  const camE = Object.assign({}, cam, { yawDeg: 90 });
  const ahead = H.projectNadir(k, camE, { n: 0, e: 1, d: 0 });
  near(ahead.u, 320); near(ahead.v, 160);
  const south = H.projectNadir(k, camE, { n: -1, e: 0, d: 0 });
  near(south.u, 400); near(south.v, 240);
  // behind the camera (above it) is flagged, far off-axis is outside the image
  const above = H.projectNadir(k, cam, { n: 0, e: 0, d: -5 });
  assert.equal(above.inFront, false); assert.equal(above.inImage, false);
  assert.equal(H.projectNadir(k, cam, { n: 0, e: 10, d: 0 }).inImage, false);
});

test('squareCorners: size, order and yaw (clockwise, compass)', () => {
  const q = H.squareCorners({ n: 1, e: 2, d: 0 }, 0.24, 0);
  assert.deepEqual(q.map((p) => [+(p.n - 1).toFixed(6), +(p.e - 2).toFixed(6)]), [[0.12, -0.12], [0.12, 0.12], [-0.12, 0.12], [-0.12, -0.12]]);
  const r = H.squareCorners({ n: 0, e: 0, d: 0 }, 2, 90); // NW corner turns to NE
  near(r[0].n, 1); near(r[0].e, 1);
  // projected square side ~ fx * size / height
  const k = H.cameraIntrinsics(640, 480, 90);
  const px = H.squareCorners({ n: 0, e: 0, d: 0 }, 0.24, 0).map((p) => H.projectNadir(k, { n: 0, e: 0, d: -2, yawDeg: 0 }, p));
  near(px[1].u - px[0].u, (320 * 0.24) / 2, 1e-9);
});

test('hudLayout and imageToHud: 16:9 frame, camera image pillarboxed inside', () => {
  const L = H.hudLayout(1280, 720, 4 / 3);
  assert.deepEqual(L.frame, { x: 0, y: 0, w: 1280, h: 720, scale: 1 });
  assert.deepEqual(L.image, { x: 160, y: 0, w: 960, h: 720 });
  const wide = H.hudLayout(2000, 500, 4 / 3); // container wider than 16:9
  near(wide.frame.h, 500); near(wide.frame.x, (2000 - 500 * 16 / 9) / 2);
  near(wide.image.w, 500 * 4 / 3);
  const tall = H.hudLayout(400, 800, 4 / 3); // narrow: frame fits the width
  near(tall.frame.w, 400); near(tall.frame.h, 225); near(tall.image.h, 225);
  const k = H.cameraIntrinsics(640, 480, 70);
  const a = H.imageToHud(0, 0, k), b = H.imageToHud(640, 480, k);
  near(a.x, 160); near(a.y, 0); near(b.x, 1120); near(b.y, 720);
});

test('hudCategory and hudChips map mission states to HUD colours', () => {
  const cat = (n) => H.hudCategory(n);
  assert.equal(cat('search'), 'search'); assert.equal(cat('APPROACH'), 'approach'); assert.equal(cat('hold'), 'approach');
  assert.equal(cat('descend'), 'descend'); assert.equal(cat('land'), 'descend');
  assert.equal(cat('landed'), 'landed'); assert.equal(cat('done'), 'landed');
  assert.equal(cat('abort'), 'abort'); assert.equal(cat('failed'), 'abort'); assert.equal(cat('go-around'), 'abort');
  assert.equal(cat('takeoff'), 'climb'); assert.equal(cat('idle'), 'idle'); assert.equal(cat(''), 'idle');
  const chips = H.hudChips(['idle', 'takeoff', 'land', 'done', 'land'], 2);
  assert.deepEqual(chips.map((c) => c.label), ['IDLE', 'TAKEOFF', 'LAND', 'DONE'], 'one chip per distinct name');
  assert.deepEqual(chips.map((c) => c.active), [false, false, true, false]);
  assert.equal(chips[2].color, H.CAT_COLOR.descend);
  assert.equal(H.hudChips(['abort'], 0)[0].fg, '#ffffff', 'white text on red');
});

test('confidence and error tones, cm formatting', () => {
  assert.equal(H.confidenceTone(0.8, 0.6), 'good'); assert.equal(H.confidenceTone(0.45, 0.6), 'caution');
  assert.equal(H.confidenceTone(0.2, 0.6), 'bad'); assert.equal(H.confidenceTone(null), 'bad');
  assert.equal(H.errorTone(0.1, 0.25), 'good'); assert.equal(H.errorTone(0.2, 0.25), 'caution'); assert.equal(H.errorTone(0.3, 0.25), 'bad');
  assert.equal(H.formatCm(0.0742), '7.4'); assert.equal(H.formatCm(1.444), '144'); assert.equal(H.formatCm(NaN), '—');
});

test('hudBanner: ABORT and LANDED texts use only the fields the run has', () => {
  const ab = H.hudBanner({ cat: 'abort', name: 'abort', armed: true, alt: 4, failure: 'timeout' });
  assert.equal(ab.kind, 'abort'); assert.equal(ab.text, 'ABORT · TIMEOUT · ARMED');
  const l1 = H.hudBanner({ cat: 'landed', name: 'done', armed: false, alt: 0, verdict: 'pass', result: {} });
  assert.equal(l1.text, 'LANDED · RUN PASS');
  const l2 = H.hudBanner({ cat: 'landed', armed: false, alt: 0, verdict: 'pass', result: { horizontal_error_m: 0.061, touchdown_speed_mps: 0.31 } });
  assert.equal(l2.text, 'LANDED · ERROR 6.1 cm · TOUCHDOWN 0.31 m/s · WITHIN 25 cm · RUN PASS');
  const l3 = H.hudBanner({ cat: 'landed', armed: false, alt: 0, verdict: 'fail', result: { horizontal_error_m: 0.4 } });
  assert.match(l3.text, /OUTSIDE 25 cm · RUN FAIL/); assert.notEqual(l3.color, l2.color);
  assert.equal(H.hudBanner({ cat: 'descend', armed: true, alt: 2 }), null);
  assert.equal(H.hudBanner({ cat: 'descend', armed: false, alt: 0.05, result: null }).kind, 'landed', 'disarmed on the deck counts as landed');
});

const v1 = () => ({
  schema_version: 1, run_id: 'x', modes: ['GUIDED', 'LAND'], states: ['takeoff', 'descend', 'landed'],
  series: {
    t: [0, 1, 2, 3], n: [0.5, 0.3, 0.1, 0.05], e: [0, 0, 0, 0], d: [-4, -3, -1, 0], alt: [4, 3, 1, 0], vz: [0, 1, 1, 0],
    mode: [0, 0, 1, 1], armed: [1, 1, 1, 0], state: [0, 1, 1, 2], hdg: [0, 0, 0, 0],
  },
});
const withPerception = () => Object.assign(v1(), {
  perception: {
    version: 1, camera: { width: 640, height: 480, hfov_deg: 80, rate_hz: 30 }, limits: { horizontal_m: 0.2, min_confidence: 0.5 },
    estimate: { source: 'camera', t: [0.5, 1.5, 2.5], valid: [0, 1, 1], confidence: [0.1, 0.8, 0.9], n: [0, 0.02, 0.01], e: [0, 0, 0.01], latency_s: [0.04, 0.04, 0.04] },
    truth: { t: [0, 3], n: [0.5, 0.04], e: [0, 0], d: [-4, 0] },
    detection: { t: [1.5, 2.5], corners: [null, [1, 2, 3, 4, 5, 6, 7, 8]], margin: [0, 40] },
  },
});

test('parsePerception: absent block is fine, valid block is read, bad blocks are ignored with a warning', () => {
  assert.deepEqual(H.parsePerception(v1()), { data: null, warning: null });
  const ok = H.parsePerception(withPerception());
  assert.equal(ok.warning, null);
  assert.equal(ok.data.camera.hfov_deg, 80); assert.equal(ok.data.limits.horizontal_m, 0.2);
  assert.equal(ok.data.estimate.length, 3); assert.equal(ok.data.estimate.source, 'camera');
  assert.equal(ok.data.truth.length, 2); assert.equal(ok.data.detection.corners[0], null);
  const bad = (mut, re) => { const o = withPerception(); mut(o.perception); const r = H.parsePerception(o); assert.equal(r.data, null); assert.match(r.warning, re); };
  bad((p) => { p.version = 2; }, /version/);
  bad((p) => { p.estimate.valid[0] = 2; }, /valid/);
  bad((p) => { p.estimate.confidence[1] = 1.5; }, /confidence/);
  bad((p) => { p.estimate.n.pop(); }, /length/);
  bad((p) => { p.estimate.t = [1, 0, 2]; }, /nondecreasing/);
  bad((p) => { p.truth.n[0] = null; }, /finite/);
  bad((p) => { p.detection.corners[1] = [1, 2]; }, /8 numbers/);
  bad((p) => { delete p.estimate; delete p.truth; delete p.detection; }, /no estimate/);
  // a v1 reader is unaffected by the block
  assert.equal(P.parseViewer(withPerception()).length, 4);
});

test('estimateAt holds the last tick; interpAt interpolates truth', () => {
  const per = H.parsePerception(withPerception()).data;
  assert.equal(H.estimateAt(per.estimate, 0.2), null, 'nothing before the first tick');
  const e = H.estimateAt(per.estimate, 1.7);
  assert.equal(e.valid, true); assert.equal(e.confidence, 0.8); near(e.age, 0.2, 1e-9);
  const tr = H.interpAt(per.truth, ['n', 'd'], 1.5);
  near(tr.n, 0.27, 1e-9); near(tr.d, -2, 1e-9);
});

test('offsetHistory samples the last window at a fixed step', () => {
  const h = H.offsetHistory((t) => ({ n: t, e: 0 }), { n: 0, e: 0 }, 10, 10, 1);
  assert.equal(h.length, 11); near(h[0].t, -10); near(h[10].t, 0); near(h[10].err, 10);
  assert.equal(H.offsetHistory((t) => ({ n: t, e: 0 }), { n: 0, e: 0 }, 2, 10, 1).length, 3, 'nothing before t = 0');
});

test('hudModel: v1 data hides estimate and confidence; v2 data shows them', () => {
  const k = H.cameraIntrinsics(640, 480, 70);
  const base = (raw, t) => {
    const store = P.parseViewer(raw);
    return H.hudModel({
      sample: store.sampleAt(t), store, per: H.parsePerception(raw).data, result: { horizontal_error_m: 0.05 }, verdict: 'pass',
      mode: 'camera', t, intr: k, pad: { n: 0, e: 0, d: 0 }, padYawDeg: 0, tagSize: 0.24, mountUp: 0.08,
    });
  };
  const a = base(v1(), 1);
  assert.equal(a.cat, 'descend'); assert.equal(a.posSrc, 'telemetry');
  assert.equal(a.showEstimate, false); assert.equal(a.showConfidence, false); assert.equal(a.estPx, null);
  near(a.err, 0.3, 1e-9); assert.equal(a.errTone, 'bad'); assert.equal(a.limit, 0.25);
  assert.ok(a.tagVisible && a.tagPx.length === 4);
  assert.deepEqual(a.chips.map((c) => c.active), [false, true, false]);
  const b = base(withPerception(), 1.6);
  assert.equal(b.posSrc, 'truth'); assert.equal(b.showEstimate, true); assert.equal(b.showConfidence, true);
  assert.equal(b.confidence, 0.8); assert.equal(b.confTone, 'good'); assert.equal(b.limit, 0.2); assert.equal(b.minConf, 0.5);
  near(b.estErr, 0.02, 1e-9); assert.ok(b.estPx && b.estPx.inFront);
  assert.equal(b.det, null, 'null corners mean no detection on that frame');
  assert.ok(base(withPerception(), 2.51).det.corners.length === 4);
  assert.equal(base(withPerception(), 3).banner.kind, 'landed');
  // the camera sits mountUp above the skid feet: on the deck it is still 8 cm above the tag
  near(base(v1(), 3).truthPx.z, 0.08, 1e-9);
});

test('shipped M3 preview sample carries a valid perception block', () => {
  const dir = path.join(__dirname, '..', 'samples');
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.ok(Array.isArray(idx.previews) && idx.previews.length >= 1);
  for (const e of idx.previews) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, e.path.replace(/^samples\//, ''), 'viewer.json'), 'utf8'));
    const store = P.parseViewer(raw);
    const per = H.parsePerception(raw);
    assert.equal(per.warning, null);
    assert.ok(per.data.estimate.length > 50 && per.data.truth.length === store.length);
  }
});
