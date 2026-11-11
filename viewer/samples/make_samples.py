#!/usr/bin/env python3
"""Generate the two SYNTHETIC sample runs for the replay viewer.

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


def write_viewer(path, run_id, modes, states, series):
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
    lines.append("  }")
    lines.append("}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_run(run_id, label, profile, series, modes, states, events, success, failure, seed):
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
        "scenario": {"name": "m1-first-flight"},
        "mode": "truth",
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
        "scenario": {"name": "m1-first-flight"},
        "mode": "truth",
        "success": success,
        "failure_reason": failure,
        "duration_us": duration_us,
        # what a 10 Hz position + 1 Hz heartbeat filtered tlog would hold; no tlog is shipped
        "tlog_records": len(series["t"]) + int(profile["duration"]) + 1,
        "events": all_events,
    }
    write_json(d / "manifest.json", manifest)
    write_json(d / "result.json", result)
    write_viewer(d / "viewer.json", run_id, modes, states, series)
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


if __name__ == "__main__":
    index = [clean(), timeout()]
    write_json(OUT / "index.json", {"samples": index})
    print("wrote", ", ".join(e["id"] for e in index))
