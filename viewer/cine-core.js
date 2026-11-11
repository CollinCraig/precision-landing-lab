/* Precision Landing Lab: cinematic mode director (pure, no DOM, no three.js).
 *
 * The director runs on its own clock `c` (wall-clock seconds since cinematic
 * mode started), so a recording is deterministic:
 *
 *   establish  wide city shot, replay held at t = 0
 *   flyin      eased fly-in from the city shot to the first flight shot
 *   play       replay runs at `speed`; camera cuts at mission-state changes
 *   hold       replay ended; last shot held for a moment
 *   outro      outro card fades in, then stays (phase "end")
 *
 * Shared by the browser (window.PLVCine) and the node tests (require).
 */
(function (root) {
  'use strict';

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

  const DEFAULTS = { establish: 3.2, flyin: 2.8, hold: 1.4, outro: 6, minShot: 1.6, fade: 0.45, runTitle: 4.5 };

  /** Camera for a mission-state (or flight-mode) name. */
  function shotFor(name) {
    const n = String(name || '').toLowerCase();
    if (/abort|fail|timeout|error|lost|crash|go.?around/.test(n)) return 'chase';
    if (/^(landed|done|complete|touchdown|disarm)/.test(n)) return 'top';
    if (/land|descen|touch/.test(n)) return 'pad';
    if (/approach|align|hold|hover|loiter|settle|search|scan|poshold/.test(n)) return 'orbit';
    return 'chase'; // takeoff, climb, idle, guided, anything else
  }
  /** True for names that end a flight (landed or failed). */
  function isTerminal(name) {
    const n = String(name || '').toLowerCase();
    return /^(landed|done|complete|touchdown|disarm)|abort|fail|timeout|error|lost|crash/.test(n);
  }

  /**
   * Shot list covering [0, dur] from state runs ({code, t0, t1}, as runLengths
   * returns) and their names. Short shots (< minShot) fold into the previous
   * shot unless they are terminal; neighbours with the same camera merge.
   */
  function planShots(runs, names, dur, minShot) {
    const ms = isNum(minShot) ? minShot : DEFAULTS.minShot;
    const D = Math.max(0, dur || 0);
    let shots = (runs || []).map((r) => {
      const name = names && names[r.code] !== undefined ? String(names[r.code]) : '';
      return { t0: r.t0, t1: r.t1, cam: shotFor(name), name, terminal: isTerminal(name), pip: shotFor(name) === 'pad' };
    }).filter((s) => s.t1 > s.t0 || s.t0 >= D);
    if (!shots.length) return [{ t0: 0, t1: D, cam: 'chase', name: '', terminal: false, pip: false }];
    // fold short, non-terminal shots into the previous one
    const folded = [];
    for (const s of shots) {
      const prev = folded[folded.length - 1];
      if (prev && s.t1 - s.t0 < ms && !s.terminal) { prev.t1 = s.t1; continue; }
      folded.push(Object.assign({}, s));
    }
    // a short first shot folds forward instead
    if (folded.length > 1 && folded[0].t1 - folded[0].t0 < ms && !folded[0].terminal) { folded[1].t0 = folded[0].t0; folded.shift(); }
    // merge equal cameras
    shots = [];
    for (const s of folded) {
      const prev = shots[shots.length - 1];
      if (prev && prev.cam === s.cam) { prev.t1 = s.t1; prev.terminal = prev.terminal || s.terminal; prev.pip = prev.pip || s.pip; continue; }
      shots.push(s);
    }
    shots[0].t0 = 0;
    shots[shots.length - 1].t1 = Math.max(D, shots[shots.length - 1].t0);
    for (let k = 1; k < shots.length; k++) shots[k].t0 = shots[k - 1].t1;
    return shots;
  }

  /** Index of the shot that holds replay time t (clamped to the list). */
  function shotIndexAt(shots, t) {
    if (!shots.length) return -1;
    for (let k = shots.length - 1; k >= 0; k--) if (t >= shots[k].t0) return k;
    return 0;
  }

  /**
   * Full cinematic plan. o = {dur, speed, runs, names, ...timing overrides}.
   * Returns clock times (seconds of cinematic clock) for every phase, the shot
   * list (replay time) and lower-third windows (clock time).
   */
  function planCine(o) {
    const P = Object.assign({}, DEFAULTS, o || {});
    const speed = isNum(P.speed) && P.speed > 0 ? P.speed : 1;
    const dur = Math.max(0, P.dur || 0);
    const shots = planShots(P.runs, P.names, dur, P.minShot);
    const introEnd = P.establish + P.flyin;
    const playEnd = introEnd + dur / speed;
    const outroStart = playEnd + P.hold;
    const total = outroStart + P.outro;
    const toClock = (t) => introEnd + t / speed;
    const last = shots[shots.length - 1];
    const resultT = last.terminal ? last.t0 : Math.max(0, dur - Math.min(3, dur * 0.15));
    const thirds = [
      { kind: 'title', c0: 0.5, c1: P.establish + P.flyin * 0.55 },
      { kind: 'run', c0: introEnd + 0.4, c1: Math.min(introEnd + 0.4 + P.runTitle, Math.max(introEnd + 0.8, toClock(resultT) - 0.2)) },
      { kind: 'result', c0: Math.max(toClock(resultT), introEnd + 0.4 + P.runTitle + 0.2), c1: outroStart },
    ].filter((w) => w.c1 - w.c0 > 0.6);
    return { speed, dur, establish: P.establish, flyin: P.flyin, introEnd, playEnd, outroStart, total, fade: P.fade, shots, thirds };
  }

  /** Opacity of a [c0, c1] window at clock c with a linear fade at both ends. */
  function windowAlpha(c, c0, c1, fade) {
    if (c < c0 || c > c1) return 0;
    const f = fade || DEFAULTS.fade;
    return clamp(Math.min((c - c0) / f, (c1 - c) / f), 0, 1);
  }

  /**
   * Director state at clock c: {phase, t (replay time), shot, cam, blend
   * (seconds of eased move into this camera, or 0 for a hard cut), thirds:
   * {kind: alpha}, outro (0..1), pip}.
   */
  function cineAt(plan, c) {
    const out = { phase: 'establish', t: 0, shot: -1, cam: 'city', blend: 0, thirds: {}, outro: 0, pip: false };
    for (const w of plan.thirds) { const a = windowAlpha(c, w.c0, w.c1, plan.fade); if (a > 0) out.thirds[w.kind] = a; }
    if (c < plan.establish) return out;
    if (c < plan.introEnd) {
      out.phase = 'flyin'; out.shot = 0; out.cam = plan.shots[0].cam; out.blend = plan.flyin;
      return out;
    }
    if (c < plan.playEnd) {
      out.phase = 'play';
      out.t = clamp((c - plan.introEnd) * plan.speed, 0, plan.dur);
    } else {
      out.t = plan.dur;
      out.phase = c < plan.outroStart ? 'hold' : c < plan.total ? 'outro' : 'end';
      out.outro = c < plan.outroStart ? 0 : clamp((c - plan.outroStart) / 0.8, 0, 1);
    }
    out.shot = shotIndexAt(plan.shots, out.t);
    const s = plan.shots[out.shot];
    out.cam = s.cam; out.pip = s.pip;
    return out;
  }

  /** Cinematic options from URL search params: cine=1. */
  function cineParams(search) {
    const p = new URLSearchParams(search || '');
    return { cine: p.get('cine') === '1' };
  }

  const api = { DEFAULTS, shotFor, isTerminal, planShots, shotIndexAt, planCine, windowAlpha, cineAt, cineParams };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PLVCine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
