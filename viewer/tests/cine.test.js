// Run: node --test viewer/tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../cine-core.js');
const P = require('../app.js');
const W = require('../world-core.js');

const runsOf = (times, codes, end) => P.runLengths(times, codes, end);

test('shotFor maps states to cameras', () => {
  assert.equal(K.shotFor('takeoff'), 'chase');
  assert.equal(K.shotFor('hold'), 'orbit'); assert.equal(K.shotFor('search'), 'orbit'); assert.equal(K.shotFor('approach'), 'orbit');
  assert.equal(K.shotFor('land'), 'pad'); assert.equal(K.shotFor('descend'), 'pad');
  assert.equal(K.shotFor('done'), 'top'); assert.equal(K.shotFor('landed'), 'top');
  assert.equal(K.shotFor('abort'), 'chase'); assert.equal(K.shotFor('idle'), 'chase'); assert.equal(K.shotFor('GUIDED'), 'chase');
  assert.ok(K.isTerminal('done') && K.isTerminal('failed') && !K.isTerminal('land'));
});

test('planShots: clean run cuts takeoff -> orbit -> pad -> top and covers the run', () => {
  const names = ['idle', 'takeoff', 'hold', 'land', 'done'];
  const shots = K.planShots(runsOf([0, 2, 8, 13, 21], [0, 1, 2, 3, 4], 22), names, 22);
  assert.deepEqual(shots.map((s) => s.cam), ['chase', 'orbit', 'pad', 'top'], 'idle and takeoff merge into one chase shot');
  assert.equal(shots[0].t0, 0); assert.equal(shots[shots.length - 1].t1, 22);
  for (let k = 1; k < shots.length; k++) assert.equal(shots[k].t0, shots[k - 1].t1, 'no gaps');
  assert.deepEqual(shots.map((s) => s.t0), [0, 8, 13, 21]);
  assert.equal(shots[2].pip, true, 'the descent shot shows the onboard inset');
  assert.equal(shots[3].terminal, true);
});

test('planShots folds short shots, keeps short terminal ones, and handles no states', () => {
  const names = ['takeoff', 'hold', 'land', 'done'];
  // a 0.5 s hold between takeoff and land folds into the takeoff shot
  const s1 = K.planShots(runsOf([0, 5, 5.5, 12], [0, 1, 2, 3], 12.6), names, 12.6, 1.6);
  assert.deepEqual(s1.map((s) => s.cam), ['chase', 'pad', 'top'], 'short final top shot is kept (terminal)');
  assert.equal(s1[1].t0, 5.5);
  // a short first shot folds forward
  const s2 = K.planShots(runsOf([0, 0.5], [1, 2], 10), names, 10, 1.6);
  assert.deepEqual(s2.map((s) => [s.cam, s.t0, s.t1]), [['pad', 0, 10]]);
  assert.deepEqual(K.planShots([], [], 5), [{ t0: 0, t1: 5, cam: 'chase', name: '', terminal: false, pip: false }]);
});

test('planCine phases and cineAt director state', () => {
  const names = ['idle', 'takeoff', 'hold', 'land', 'done'];
  const plan = K.planCine({ dur: 22, speed: 2, runs: runsOf([0, 2, 8, 13, 21], [0, 1, 2, 3, 4], 22), names });
  assert.equal(plan.introEnd, plan.establish + plan.flyin);
  assert.equal(plan.playEnd, plan.introEnd + 11, 'replay at 2x takes half the time');
  assert.ok(plan.outroStart > plan.playEnd && plan.total > plan.outroStart);
  const at = (c) => K.cineAt(plan, c);
  assert.equal(at(0).phase, 'establish'); assert.equal(at(0).cam, 'city'); assert.equal(at(0).t, 0);
  const f = at(plan.establish + 0.1);
  assert.equal(f.phase, 'flyin'); assert.equal(f.cam, 'chase'); assert.equal(f.blend, plan.flyin);
  const h = at(plan.introEnd + 5); // replay t = 10 s: hold
  assert.equal(h.phase, 'play'); assert.equal(h.t, 10); assert.equal(h.cam, 'orbit'); assert.equal(h.blend, 0, 'cuts are hard cuts');
  assert.equal(at(plan.introEnd + 7.5).cam, 'pad'); assert.equal(at(plan.introEnd + 7.5).pip, true);
  assert.equal(at(plan.playEnd + 0.1).phase, 'hold'); assert.equal(at(plan.playEnd + 0.1).t, 22);
  assert.ok(Math.abs(at(plan.outroStart + 0.4).outro - 0.5) < 1e-9);
  assert.equal(at(plan.total + 5).phase, 'end'); assert.equal(at(plan.total + 5).outro, 1);
  // lower thirds: title in the intro, run id after the fly-in, result at the terminal shot
  const kinds = plan.thirds.map((w) => w.kind);
  assert.deepEqual(kinds, ['title', 'run', 'result']);
  assert.ok(at(1.5).thirds.title > 0);
  assert.ok(at(plan.introEnd + 2).thirds.run > 0);
  assert.ok(at(plan.introEnd + 10.6).thirds.result > 0, 'result title during the landed shot');
  assert.equal(at(plan.outroStart + 1).thirds.result, undefined, 'titles end before the outro card');
});

test('windowAlpha fades in and out', () => {
  assert.equal(K.windowAlpha(0, 1, 3, 0.5), 0);
  assert.equal(K.windowAlpha(1.25, 1, 3, 0.5), 0.5);
  assert.equal(K.windowAlpha(2, 1, 3, 0.5), 1);
  assert.equal(K.windowAlpha(2.9, 1, 3, 0.5) < 0.25, true);
});

test('cineParams reads cine=1 only', () => {
  assert.equal(K.cineParams('?cine=1').cine, true);
  assert.equal(K.cineParams('?cine=0').cine, false);
  assert.equal(K.cineParams('').cine, false);
});

test('padPose: low camera beside the pad, looks up at the drone, drifts slowly', () => {
  const lo = W.padPose({ x: 0, y: 0, z: 0 }, 0, {}), hi = W.padPose({ x: 0, y: 5, z: 0 }, 0, {});
  assert.equal(lo.py, 0.35);
  assert.ok(Math.hypot(lo.px, lo.pz) > 1.5, 'outside the 3 m safety area half-width');
  assert.ok(hi.ty > lo.ty && hi.ty < 5, 'target rises with the drone');
  assert.notDeepEqual(W.padPose({ x: 0, y: 1, z: 0 }, 0, {}), W.padPose({ x: 0, y: 1, z: 0 }, 10, {}));
  assert.ok(W.CAMERAS.includes('pad'));
  assert.deepEqual(W.sceneParams('?cam=pad'), { cam: 'pad' });
});

test('dusk preset uses a blue gradient sky, not a brown physical sky', () => {
  const g = W.timeOfDay('dusk').skyGrad;
  assert.ok(g, 'dusk has skyGrad');
  const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  for (const k of ['zenith', 'mid', 'horizon']) { const [r, , b] = rgb(g[k]); assert.ok(b > r, k + ' is blue, not brown'); }
  assert.equal(W.timeOfDay('day').skyGrad, undefined);
});
