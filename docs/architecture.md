# Architecture (proposed)

Status: draft — refined during M0/M1. Versions are pinned in M0.

## Components

```
Omarchy laptop (host)
└── Ubuntu container (distrobox/podman)
    ├── ArduPilot SITL (ArduCopter)        ← flight controller, unmodified
    ├── Gazebo + ardupilot_gazebo plugin   ← 3D world, camera (from M2)
    └── lab/ (Python package)
        ├── link.py        MAVLink connection helpers (pymavlink)
        ├── mission.py     takeoff / hold / land state machine      [Collin, M1]
        ├── perception/    AprilTag detection, camera model          [Collin, M2]
        ├── estimate.py    TargetEstimate producers (truth / camera) [Collin, M3]
        ├── guidance.py    sends LANDING_TARGET to ArduPilot
        ├── scenarios.py   seeded conditions (pad offset, light, wind)
        ├── metrics.py     landing error, touchdown speed, detector stats
        └── run.py         runs a scenario, writes the run directory
validator/  (Rust crate)   validates a run directory
reports/                   report + demo page generator (Sonnet)
runs/<run_id>/             git-ignored outputs
```

## Modes (keep the pieces separable)

| Mode | Target estimate from | Purpose |
|---|---|---|
| `truth` | Simulator ground truth | Tests guidance alone, with perfect perception. |
| `camera` | AprilTag on live camera frames | The real evaluation. **Must not read truth.** |
| `offline` | Recorded frames, scored vs truth | Tests detection alone, no flying. |

## Interfaces

**TargetEstimate** (produced each perception tick):
`t_sim` (s) · `valid` (bool) · `confidence` (0–1) · `frame` (e.g. `body_frd`,
`local_ned`) · `position_m` (x, y, z) · `source` (`truth`/`camera`) ·
`latency_s` (optional).

**Run directory** `runs/<run_id>/`:
- `manifest.json` — run_id, seed, scenario params, mode, versions (ArduPilot,
  Gazebo, container image ID), git commit + dirty flag, host, start time.
- `result.json` — success, failure_reason, horizontal_error_m,
  touchdown_speed_mps, time_to_land_s, detector stats (detection rate, mean
  error, loss events, latency), sim speed factor.
- `flight.tlog` / ArduPilot log, `frames/` (sampled), `video.mp4`.

**Validator (Rust)** `plv check runs/<run_id>`: required files present, schema
valid, timestamps monotonic, manifest/result consistent, and in `camera` mode
no estimate with `source=truth`. Exit code 0/1 plus a short report.

## Success definition (per run)

Landed and disarmed **and** horizontal error ≤ 0.25 m **and** touchdown speed
≤ 0.5 m/s *(proposed)* **and** finished within 120 s *(proposed)* **and** stays
disarmed on the ground for 5 s. Any failure records a `failure_reason`.

## Evaluation rules

- Development seeds and **fixed evaluation seeds** are kept separate.
- No promise of bit-exact physics replay; logs + frames make every run inspectable.
- Wind scenarios only after confirming wind support on the pinned Gazebo version.
