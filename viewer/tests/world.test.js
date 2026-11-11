// Run: node --test viewer/tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../world-core.js');
const raw = () => JSON.parse(JSON.stringify(require('../scene/city.json')));

test('city.json parses; vertiport pad sits on its building at deck height', () => {
  const c = W.parseCity(raw());
  const host = c.buildings.find((b) => b.id === c.vertiport.building);
  assert.ok(host.height >= 25 && host.height <= 35, 'vertiport building is mid-height');
  assert.ok(Math.abs(host.height + c.vertiport.deck_height - c.vertiport.pad.z) < 1e-9);
  const others = c.buildings.filter((b) => b.id !== host.id);
  assert.ok(others.length >= 10 && others.length <= 16, 'surrounding building count');
  for (const b of others) assert.ok(b.height >= 10 && b.height <= 80, b.id + ' height');
  assert.deepEqual([c.vertiport.tlof, c.vertiport.fato, c.vertiport.safety_area], [1, 2, 3]);
});

test('parseCity rejects bad layouts', () => {
  const bad = (mut, re) => { const o = raw(); mut(o); assert.throws(() => W.parseCity(o), re); };
  bad((o) => { o.schema_version = 2; }, /schema_version/);
  bad((o) => { o.buildings[1].footprint = [5, 5, 1, 9]; }, /footprint/);
  bad((o) => { o.buildings[2].id = o.buildings[1].id; }, /duplicate/);
  bad((o) => { o.buildings[1].facade = 'wood'; }, /facade/);
  bad((o) => { o.vertiport.pad.z = 40; }, /deck_height/);
  bad((o) => { o.vertiport.building = 'nope'; }, /building id/);
  bad((o) => { o.vertiport.pad.x = 500; o.vertiport.pad.z = o.buildings[0].height + 0.9; }, /inside/);
  bad((o) => { o.buildings[1].setbacks = [{ at: 99, inset: 2 }]; }, /setbacks/);
  bad((o) => { o.streets.road_width = 90; }, /room/);
});

test('buildings sit inside their blocks and do not overlap', () => {
  const c = W.parseCity(raw());
  const blocks = W.cityBlocks(c);
  const all = c.buildings.concat(W.contextBuildings(c));
  for (const b of all) {
    const f = b.footprint;
    assert.ok(blocks.some((k) => f[0] >= k.inner[0] - 1e-9 && f[1] >= k.inner[1] - 1e-9 && f[2] <= k.inner[2] + 1e-9 && f[3] <= k.inner[3] + 1e-9), b.id + ' inside a block');
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i].footprint, b = all[j].footprint;
    assert.ok(!(a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]), all[i].id + ' overlaps ' + all[j].id);
  }
});

test('buildingTiers stacks setbacks and narrows each tier', () => {
  const t = W.buildingTiers({ footprint: [0, 0, 20, 10], height: 50, setbacks: [{ at: 30, inset: 2 }, { at: 40, inset: 1 }] });
  assert.equal(t.length, 3);
  assert.deepEqual(t.map((x) => [x.z0, x.z1]), [[0, 30], [30, 40], [40, 50]]);
  assert.deepEqual([t[2].x0, t[2].y0, t[2].x1, t[2].y1], [3, 3, 17, 7]);
  // a setback that would leave less than 2 m is ignored; the building keeps its full height
  const s = W.buildingTiers({ footprint: [0, 0, 5, 5], height: 20, setbacks: [{ at: 10, inset: 2 }] });
  assert.deepEqual(s.map((x) => [x.z1, x.x1 - x.x0]), [[10, 5], [20, 5]]);
});

test('context buildings are deterministic, fill only empty blocks, and stay under the approach surfaces', () => {
  const c = W.parseCity(raw());
  const a = W.contextBuildings(c), b = W.contextBuildings(c);
  assert.deepEqual(a, b);
  assert.ok(a.length > 20);
  assert.deepEqual(W.approachObstacles(c, a), []);
  const c2 = W.parseCity(Object.assign(raw(), { context: null }));
  assert.deepEqual(W.contextBuildings(c2), []);
});

test('approach surface: 8:1 from the FATO edge, only inside the corridor', () => {
  const c = W.parseCity(raw());
  const z = c.vertiport.pad.z;
  assert.equal(W.approachLimit(c, 0, -9, 180), z + 8 / 8);    // 8 m south of the FATO edge
  assert.equal(W.approachLimit(c, 0, -0.5, 180), Infinity);   // over the FATO
  assert.equal(W.approachLimit(c, 30, -9, 180), Infinity);    // outside the corridor
  assert.equal(W.approachLimit(c, 0, 9, 180), Infinity);      // wrong side
  assert.equal(W.approachLimit(c, 0, 9, 0), z + 1);           // reciprocal path
  // a tall building in the corridor is flagged
  const o = raw(); o.buildings.push({ id: 'blocker', footprint: [-5, -60, 5, -32], height: 60 });
  o.buildings = o.buildings.filter((x) => x.id !== 'south-office');
  assert.ok(W.approachObstacles(W.parseCity(o)).some((h) => h.id === 'blocker'));
});

test('sidewalkPoints keep clear of intersections', () => {
  const c = W.parseCity(raw());
  const p = W.sidewalkPoints(c, 10, 1, 1.3, 0);
  assert.ok(p.length > 50);
  const L = W.streetLines(c), half = c.streets.road_width / 2;
  for (const q of p) {
    const nearX = L.xs.some((x) => Math.abs(q.x - x) < half + 3.9), nearY = L.ys.some((y) => Math.abs(q.y - y) < half + 3.9);
    assert.ok(!(nearX && nearY), 'point in an intersection corner');
  }
});

test('windsockPose points downwind and lifts with wind speed', () => {
  assert.equal(W.windsockPose(360, 4).towardDeg, 180);
  assert.equal(W.windsockPose(270, 4).towardDeg, 90);
  assert.equal(W.windsockPose(-90, 4).towardDeg, 90);
  assert.equal(W.windsockPose(0, 0).droop, 90);
  assert.equal(W.windsockPose(0, 7.7).droop, 0);
  assert.equal(W.windsockPose(0, 30).droop, 0);
  assert.ok(W.windsockPose(0, 3).droop > W.windsockPose(0, 5).droop);
});

test('timeOfDay presets and sun vector', () => {
  assert.deepEqual(W.TIMES, ['day', 'golden', 'dusk']);
  assert.equal(W.timeOfDay('nope').name, 'day');
  const d = W.timeOfDay('day'), k = W.timeOfDay('dusk');
  assert.ok(k.windows > d.windows && k.lights > d.lights && k.bloom > d.bloom, 'dusk glows');
  assert.ok(d.sunElev > W.timeOfDay('golden').sunElev && W.timeOfDay('golden').sunElev > k.sunElev);
  const s = W.sunVector(0, 90); // east, on the horizon
  assert.ok(Math.abs(s.x - 1) < 1e-9 && Math.abs(s.y) < 1e-9 && Math.abs(s.z) < 1e-9);
  const n = W.sunVector(0, 0); // north = -z in three.js axes
  assert.ok(Math.abs(n.z + 1) < 1e-9);
  const up = W.sunVector(90, 123);
  assert.ok(Math.abs(up.y - 1) < 1e-9);
});

test('camera poses: easing, blending, chase framing, top-down', () => {
  assert.equal(W.easeInOut(0), 0); assert.equal(W.easeInOut(1), 1); assert.equal(W.easeInOut(0.5), 0.5);
  assert.equal(W.easeInOut(-1), 0); assert.equal(W.easeInOut(2), 1);
  const a = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 40 }, b = { px: 10, py: 20, pz: -10, tx: 1, ty: 2, tz: 3, fov: 60 };
  assert.deepEqual(W.lerpPose(a, b, 0.5), { px: 5, py: 10, pz: -5, tx: 0.5, ty: 1, tz: 1.5, fov: 50 });
  const o = W.orbitPose(0, 0, 0, 0, Math.PI / 2, 10, 40);
  assert.ok(Math.abs(o.pz - 10) < 1e-9 && Math.abs(o.py) < 1e-9, 'az 0 puts the camera south');
  const low = W.chasePose({ x: 0, y: 0, z: 0 }, { az: 0, pol: 1.2 }), high = W.chasePose({ x: 0, y: 6, z: 0 }, { az: 0, pol: 1.2 });
  const dist = (p) => Math.hypot(p.px - p.tx, p.py - p.ty, p.pz - p.tz);
  assert.ok(dist(high) > dist(low), 'chase pulls back as the drone climbs');
  assert.ok(high.ty > 0 && high.ty < 6, 'chase target sits between pad and drone');
  const t = W.topPose({ x: 0, y: 3, z: 0 }, {});
  assert.ok(t.py > 3 && t.tx === 0 && t.tz === 0 && t.pz > 0 && t.pz < t.py * 0.05, 'top-down, near vertical');
  const c0 = W.cityPose(0, {}), c1 = W.cityPose(30, {});
  assert.ok(Math.hypot(c0.px, c0.pz) > 100, 'city shot is wide');
  assert.notDeepEqual(c0, c1);
});

test('sceneParams reads cam, tod, q and wind; drops bad values', () => {
  assert.deepEqual(W.sceneParams('?cam=city&tod=dusk&q=low&wind=270,5'), { cam: 'city', tod: 'dusk', q: 'low', wind: { from_deg: 270, speed_mps: 5 } });
  assert.deepEqual(W.sceneParams('?cam=drone&tod=noon&q=ultra&wind=abc'), {});
  assert.deepEqual(W.sceneParams('?wind=-90,2').wind, { from_deg: 270, speed_mps: 2 });
  assert.deepEqual(W.sceneParams('?wind=0,99'), {});
  assert.deepEqual(W.sceneParams(''), {});
});

test('litPattern is deterministic with the requested size', () => {
  const p = W.litPattern(5, 8, 8, 0.4);
  assert.equal(p.length, 64);
  assert.deepEqual(Array.from(p), Array.from(W.litPattern(5, 8, 8, 0.4)));
  const lit = p.reduce((s, v) => s + v, 0);
  assert.ok(lit > 5 && lit < 60);
  assert.equal(W.litPattern(5, 8, 8, 0).reduce((s, v) => s + v, 0) <= 8 * 2, true);
});
