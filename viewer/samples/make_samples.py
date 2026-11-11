#!/usr/bin/env python3
"""Generate the SYNTHETIC sample runs for the replay viewer.

Python standard library only. Run from anywhere:

    python3 viewer/samples/make_samples.py

Each sample directory gets manifest.json and result.json (shaped like
docs/run-format-m1.md) and viewer.json (the derived time series described in
viewer/FORMAT.md). No flight.tlog is written: these are not real flights and
`plv check` is not expected to accept them. Output is deterministic.
"""
import json
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent
DT = 0.1  # 10 Hz, like GLOBAL_POSITION_INT from SITL
HOLD_ALT = 6.0  # metres; placeholder from the design page

START_US = 1_800_000_000_000_000  # same placeholder anchor as the contract example
PLACEHOLDER_GIT = "0" * 40
PLACEHOLDER_IMAGE = "ubuntu@sha256:" + "0" * 64


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def keyframes(points, t):
    """Piecewise altitude; each leg eased with smoothstep. points: (t, alt)."""
    if t <= points[0][0]:
        return points[0][1]
    for (t0, a0), (t1, a1) in zip(points, points[1:]):
        if t <= t1:
            return a0 + (a1 - a0) * smooth((t - t0) / (t1 - t0))
    return points[-1][1]


def build(profile, seed, wobble, drift_to):
    """Return columnar series for a profile dict."""
    rng = random.Random(seed)
    steps = int(round(profile["duration"] / DT)) + 1
    s = {k: [] for k in ("t", "n", "e", "d", "alt", "vz", "mode", "armed", "state", "hdg")}
    prev_base = 0.0
    for i in range(steps):
        t = round(i * DT, 3)
        base = keyframes(profile["alt"], t)
        flying = base > 0.05
        alt = max(0.0, base + (rng.gauss(0, 0.012) if flying else 0.0))
        vz_down = -(base - prev_base) / DT if i else 0.0  # NED: positive = descending (noise-free derivative)
        prev_base = base
        k = min(1.0, base / 2.0)
        n = 0.03 + k * wobble * math.sin(0.35 * t + 0.4) + drift_to[0] * smooth((t - profile["drift"][0]) / (profile["drift"][1] - profile["drift"][0])) + rng.gauss(0, 0.004 * k)
        e = -0.02 + k * wobble * math.cos(0.29 * t) + drift_to[1] * smooth((t - profile["drift"][0]) / (profile["drift"][1] - profile["drift"][0])) + rng.gauss(0, 0.004 * k)
        s["t"].append(t)
        s["n"].append(round(n, 3))
        s["e"].append(round(e, 3))
        s["d"].append(round(-alt, 3))
        s["alt"].append(round(alt, 3))
        s["vz"].append(round(vz_down + (rng.gauss(0, 0.015) if flying else 0.0), 3))
        s["mode"].append(lookup(profile["modes"], t))
        s["armed"].append(1 if profile["arm"][0] <= t < profile["arm"][1] else 0)
        s["state"].append(lookup(profile["states"], t))
        s["hdg"].append(round((20 + 4 * math.sin(0.2 * t) * k) % 360, 1))
    return s


def lookup(table, t):
    """table: list of (start_time, index); last entry whose start <= t."""
    cur = table[0][1]
    for start, idx in table:
        if t >= start:
            cur = idx
    return cur


def write_json(path, obj):
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def write_viewer(path, run_id, modes, states, series, perception=None):
    """Header keys one per line, each series on its own line (small diffs)."""
    head = {
        "schema_version": 1,
        "run_id": run_id,
        "source": {"kind": "synthetic", "generator": "viewer/samples/make_samples.py"},
        "frame": {"name": "NED", "origin": "home", "units": "m"},
        "pad": {"n": 0.0, "e": 0.0},
        "modes": modes,
        "states": states,
    }
    lines = ["{"]
    for k, v in head.items():
        lines.append(f"  {json.dumps(k)}: {json.dumps(v)},")
    lines.append('  "series": {')
    keys = list(series)
    for i, k in enumerate(keys):
        comma = "," if i < len(keys) - 1 else ""
        lines.append(f"    {json.dumps(k)}: {json.dumps(series[k], separators=(',', ':'))}{comma}")
    if perception is None:
        lines.append("  }")
    else:
        # proposed v2 perception block (viewer/FORMAT.md), one stream per line
        lines.append("  },")
        lines.append('  "perception": {')
        pkeys = list(perception)
        for i, k in enumerate(pkeys):
            comma = "," if i < len(pkeys) - 1 else ""
            v = perception[k]
            if isinstance(v, dict) and any(isinstance(x, list) for x in v.values()):
                lines.append(f"    {json.dumps(k)}: {{")
                sub = list(v)
                for j, sk in enumerate(sub):
                    c2 = "," if j < len(sub) - 1 else ""
                    lines.append(f"      {json.dumps(sk)}: {json.dumps(v[sk], separators=(',', ':'))}{c2}")
                lines.append(f"    }}{comma}")
            else:
                lines.append(f"    {json.dumps(k)}: {json.dumps(v)}{comma}")
        lines.append("  }")
    lines.append("}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_run(run_id, label, profile, series, modes, states, events, success, failure, seed,
              scenario="m1-first-flight", mode="truth", perception=None, extra_result=None):
    d = OUT / run_id
    d.mkdir(exist_ok=True)
    duration_us = int(round(profile["duration"] * 1_000_000))
    # lifecycle events bracket the free-text ones (docs/run-format-m1.md)
    all_events = [{"t_us": 0, "kind": "run_started", "source": "runner"}]
    all_events += [{"t_us": int(round(t * 1e6)), "kind": k, "source": "runner"} for t, k in events]
    all_events.append({"t_us": duration_us, "kind": "run_succeeded" if success else "run_failed", "source": "runner"})
    manifest = {
        "schema_version": 1,
        "run_id": run_id,
        "seed": seed,
        "scenario": {"name": scenario},
        "mode": mode,
        "versions": {"ardupilot": "Copter-SYNTHETIC", "container": PLACEHOLDER_IMAGE},
        "git": {"commit": PLACEHOLDER_GIT, "dirty": False},
        "host": "synthetic-sample",
        "started_unix_us": START_US,
        "input_sources": ["runner", "autopilot"],
    }
    result = {
        "schema_version": 1,
        "run_id": run_id,
        "seed": seed,
        "scenario": {"name": scenario},
        "mode": mode,
        "success": success,
        "failure_reason": failure,
        "duration_us": duration_us,
        # what a 10 Hz position + 1 Hz heartbeat filtered tlog would hold; no tlog is shipped
        "tlog_records": len(series["t"]) + int(profile["duration"]) + 1,
        "events": all_events,
    }
    if extra_result:
        events_ = result.pop("events")
        result.update(extra_result)
        result["events"] = events_
    write_json(d / "manifest.json", manifest)
    write_json(d / "result.json", result)
    write_viewer(d / "viewer.json", run_id, modes, states, series, perception)
    return {"id": run_id, "label": label, "path": f"samples/{run_id}/"}


def clean():
    modes = ["STABILIZE", "GUIDED", "LAND"]
    states = ["idle", "takeoff", "hold", "land", "done"]
    profile = {
        "duration": 22.0,
        "alt": [(0, 0), (3.0, 0), (8.0, HOLD_ALT), (13.0, HOLD_ALT), (18.0, 1.0), (20.0, 0.0), (22.0, 0.0)],
        "modes": [(0, 0), (1.5, 1), (13.0, 2)],
        "states": [(0, 0), (2.0, 1), (8.0, 2), (13.0, 3), (21.0, 4)],
        "arm": (2.0, 21.0),
        "drift": (13.0, 20.0),
    }
    series = build(profile, seed=7, wobble=0.07, drift_to=(0.08, 0.05))
    events = [
        (1.5, "mode_guided"), (2.0, "armed"), (2.0, "state:takeoff"), (8.0, "altitude_reached"),
        (8.0, "state:hold"), (13.0, "hold_complete"), (13.0, "state:land"), (20.0, "touchdown"),
        (21.0, "disarmed"), (21.0, "state:done"),
    ]
    return write_run("sample-clean-hold", "Clean: takeoff, hold 5 s, land (synthetic)", profile, series,
                     modes, states, events, True, None, 7)


def timeout():
    modes = ["STABILIZE", "GUIDED", "LAND"]
    states = ["idle", "takeoff", "abort", "failed"]
    profile = {
        "duration": 25.0,
        # climbs, then stalls near 4.1 m and never reaches the 5.7 m target
        "alt": [(0, 0), (3.0, 0), (8.0, 3.6), (11.0, 4.2), (15.0, 4.1), (23.0, 0.0), (25.0, 0.0)],
        "modes": [(0, 0), (1.5, 1), (15.0, 2)],
        "states": [(0, 0), (2.0, 1), (15.0, 2), (24.0, 3)],
        "arm": (2.0, 24.0),
        "drift": (9.0, 15.0),
    }
    series = build(profile, seed=11, wobble=0.18, drift_to=(0.55, -0.35))
    events = [
        (1.5, "mode_guided"), (2.0, "armed"), (2.0, "state:takeoff"), (3.0, "wait_altitude_started"),
        (15.0, "wait_altitude_timeout"), (15.0, "state:abort"), (15.0, "mode_land"),
        (23.0, "touchdown"), (24.0, "disarmed"), (24.0, "state:failed"),
    ]
    failure = {"code": "timeout", "detail": "Timed out after 12 s waiting for altitude >= 5.7 m"}
    return write_run("sample-timeout-failure", "Failure: altitude timeout, abort and land (synthetic)", profile, series,
                     modes, states, events, False, failure, 11)


def ease_path(legs, t):
    """Piecewise 2D position; legs: [(t, n, e)], each leg eased with smoothstep."""
    if t <= legs[0][0]:
        return legs[0][1], legs[0][2]
    for (t0, n0, e0), (t1, n1, e1) in zip(legs, legs[1:]):
        if t <= t1:
            f = smooth((t - t0) / (t1 - t0))
            return n0 + (n1 - n0) * f, e0 + (e1 - e0) * f
    return legs[-1][1], legs[-1][2]


def m3_preview():
    """M3-shaped run with the proposed v2 perception block (estimate + truth). Synthetic."""
    modes = ["STABILIZE", "GUIDED", "LAND"]
    states = ["idle", "takeoff", "search", "approach", "descend", "landed"]
    duration = 34.0
    alt_keys = [(0, 0), (2.5, 0), (7.5, 7.0), (12.0, 7.0), (18.0, 6.0), (29.6, 0.0), (34.0, 0.0)]
    path = [(0, 0.0, 0.0), (7.5, 0.0, 0.0), (11.0, 1.45, 1.15), (12.0, 1.45, 1.15), (18.0, 0.12, -0.08), (29.6, 0.046, -0.041), (34.0, 0.046, -0.041)]
    state_tab = [(0, 0), (2.0, 1), (7.5, 2), (12.0, 3), (18.0, 4), (29.8, 5)]
    rng = random.Random(23)
    steps = int(round(duration / DT)) + 1
    s = {k: [] for k in ("t", "n", "e", "d", "alt", "vz", "mode", "armed", "state", "hdg")}
    tr = {"t": [], "n": [], "e": [], "d": []}
    prev = 0.0
    for i in range(steps):
        t = round(i * DT, 3)
        base = keyframes(alt_keys, t)
        flying = base > 0.05
        k = min(1.0, base / 2.0)
        pn, pe = ease_path(path, t)
        n_true = pn + k * 0.035 * math.sin(0.41 * t + 0.3)
        e_true = pe + k * 0.035 * math.cos(0.33 * t)
        alt = max(0.0, base + (rng.gauss(0, 0.01) if flying else 0.0))
        tr["t"].append(t)
        tr["n"].append(round(n_true, 4))
        tr["e"].append(round(e_true, 4))
        tr["d"].append(round(-alt, 4))
        # telemetry = truth + a small EKF error
        s["t"].append(t)
        s["n"].append(round(n_true + rng.gauss(0, 0.006 * k), 3))
        s["e"].append(round(e_true + rng.gauss(0, 0.006 * k), 3))
        s["d"].append(round(-alt, 3))
        s["alt"].append(round(alt, 3))
        s["vz"].append(round((-(base - prev) / DT if i else 0.0) + (rng.gauss(0, 0.012) if flying else 0.0), 3))
        prev = base
        s["mode"].append(lookup([(0, 0), (1.5, 1), (27.0, 2)], t))
        s["armed"].append(1 if 2.0 <= t < 31.0 else 0)
        s["state"].append(lookup(state_tab, t))
        s["hdg"].append(round((15 + 6 * math.sin(0.15 * t) * k) % 360, 1))
    est = {"t": [], "valid": [], "confidence": [], "n": [], "e": [], "latency_s": []}
    for i in range(steps):
        t = s["t"][i]
        if t < 7.5 or t > 31.0:
            continue
        alt = s["alt"][i]
        dropout = 23.3 <= t < 23.9
        valid = 1 if t >= 9.2 and not dropout else 0
        conf = 0.0
        if valid:
            conf = min(0.97, 0.66 + 0.035 * max(0.0, 7.0 - alt) + rng.gauss(0, 0.015))
        elif dropout:
            conf = 0.18 + rng.gauss(0, 0.03)
        sig = 0.006 + 0.004 * alt
        est["t"].append(t)
        est["valid"].append(valid)
        est["confidence"].append(round(max(0.0, min(1.0, conf)), 3))
        est["n"].append(round(0.012 + rng.gauss(0, sig), 4) if valid else 0.0)
        est["e"].append(round(-0.008 + rng.gauss(0, sig), 4) if valid else 0.0)
        est["latency_s"].append(round(0.036 + abs(rng.gauss(0, 0.004)), 4))
    est = {"source": "camera", **est}
    perception = {
        "version": 1,
        "camera": {"width": 640, "height": 480, "hfov_deg": 70, "rate_hz": 10},
        "limits": {"horizontal_m": 0.25, "min_confidence": 0.6},
        "estimate": est,
        "truth": tr,
    }
    err = math.hypot(tr["n"][-1], tr["e"][-1])
    profile = {"duration": duration}
    events = [
        (1.5, "mode_guided"), (2.0, "armed"), (2.0, "state:takeoff"), (7.5, "state:search"),
        (9.2, "target_acquired"), (12.0, "state:approach"), (18.0, "state:descend"),
        (23.3, "target_lost"), (23.9, "target_reacquired"), (27.0, "mode_land"),
        (29.6, "touchdown"), (29.8, "state:landed"), (31.0, "disarmed"),
    ]
    extra = {"horizontal_error_m": round(err, 3), "touchdown_speed_mps": 0.31, "time_to_land_s": 11.6}
    return write_run("sample-m3-preview", "M3 preview: search, approach, descend with estimates (synthetic)", profile, s,
                     modes, states, events, True, None, 23, scenario="m3-camera-preview", mode="camera",
                     perception=perception, extra_result=extra)


if __name__ == "__main__":
    index = [clean(), timeout()]
    # runs that use the proposed v2 perception block (FORMAT.md) are listed separately
    previews = [m3_preview()]
    write_json(OUT / "index.json", {"samples": index, "previews": previews})
    print("wrote", ", ".join(e["id"] for e in index + previews))
