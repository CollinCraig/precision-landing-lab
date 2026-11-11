# Viewer data contract: `viewer.json` (schema version 1)

The replay viewer runs in a browser and cannot read `flight.tlog`: the M1 run
format (`docs/run-format-m1.md`) stores telemetry only as a **binary,
pymavlink-compatible MAVLink tlog** (HEARTBEAT + GLOBAL_POSITION_INT). There is
no JSON/JSONL time series in the run directory. So the viewer reads one small
derived file next to the run's own files:

```
runs/<run_id>/
  manifest.json   (M1 contract, read by the viewer for mode/scenario)
  result.json     (M1 contract, read for pass/fail, results, events)
  flight.tlog     (M1 contract, NOT read by the viewer)
  viewer.json     (this document; derived from flight.tlog + result.json)
```

`manifest.json` and `result.json` are optional for the viewer (the header
degrades to "NO RESULT"); `viewer.json` is required. `plv check` ignores
`viewer.json` (unknown extra files are outside the M1 contract), and it is a
derived artifact: regenerate it, never treat it as evidence.

## Producer (follow-up for the M1 team)

A Python exporter in `lab/` (not part of this change) should write
`viewer.json` after the run is complete. Proposed mapping, all from the
filtered tlog plus `result.json`:

| viewer.json field | Source |
| --- | --- |
| `series.t` | `(record_timestamp_us - manifest.started_unix_us) / 1e6`, seconds, same time base as `result.json` events |
| `series.alt` | GLOBAL_POSITION_INT `relative_alt` / 1000 (m above home) |
| `series.n`, `series.e` | `lat`, `lon` (1e-7 deg) as a local flat-earth offset in metres from the **first sample** (home) |
| `series.d` | `-alt` (NED down, m). Same frame as `pad` |
| `series.vz` | GLOBAL_POSITION_INT `vz` / 100 (m/s). **NED, positive = descending**, as MAVLink. The viewer plots climb = `-vz` |
| `series.hdg` (optional) | GLOBAL_POSITION_INT `hdg` / 100 (deg, 0 = north, clockwise) |
| `series.mode` | HEARTBEAT `custom_mode` mapped to an ArduCopter mode name, held until the next heartbeat; index into `modes` |
| `series.armed` | HEARTBEAT `base_mode & 0x80` as 0/1, held until the next heartbeat |
| `series.state` (optional) | **Not in the tlog.** Mission state comes from the runner. Proposal: events in `result.json` whose `kind` starts with `state:` (e.g. `state:takeoff`) define the state at each time; the exporter emits the state index per sample. Omit `series.state` and `states` if the runner does not record states; the viewer then colours by flight mode |

Samples are one row per GLOBAL_POSITION_INT record (about 10 Hz in SITL).
Mission-state naming is the M1 mission author's choice; the viewer only
recognises a few words for colouring (`idle`, `takeoff`, `hold`, `land`,
`done`, `abort`/`fail`/`timeout`) and cycles a palette for anything else.
If the pad is not at home, set `pad`.

## Schema

```json
{
  "schema_version": 1,
  "run_id": "EXAMPLE",
  "source": {"kind": "tlog", "generator": "lab/export_viewer.py"},
  "frame": {"name": "NED", "origin": "home", "units": "m"},
  "pad": {"n": 0.0, "e": 0.0},
  "modes": ["STABILIZE", "GUIDED", "LAND"],
  "states": ["idle", "takeoff", "hold", "land", "done"],
  "series": {
    "t":     [0.0, 0.1, 0.2],
    "n":     [0.03, 0.03, 0.03],
    "e":     [-0.02, -0.02, -0.02],
    "d":     [0.0, 0.0, -0.01],
    "alt":   [0.0, 0.0, 0.01],
    "vz":    [0.0, 0.0, -0.1],
    "mode":  [0, 0, 1],
    "armed": [0, 0, 1],
    "state": [0, 0, 1],
    "hdg":   [20.0, 20.0, 20.0]
  }
}
```

Rules (enforced by `parseViewer` in `app.js`, tested in `tests/app.test.js`):

- `schema_version` is integer `1`. Anything else is rejected.
- `series` columns are equal-length arrays (zero samples is allowed: a failed
  run with an empty tlog loads with a warning).
- `t` finite, non-negative, nondecreasing. `n e d alt vz` (and `hdg` if
  present) are finite numbers in metres, m/s, degrees. No NaN/null.
- `mode` indexes `modes`; `armed` is 0 or 1; `state` (if present) indexes
  `states`. `modes` is required, `states` required only with `series.state`.
- `source`, `frame`, `run_id` are informational. `source.kind: "synthetic"`
  shows a "synthetic" badge.
- Unknown top-level keys are ignored (the viewer is a reader, not a validator).
- Coordinates: NED relative to home. `d` is down, so altitude is `-d`.
  The viewer draws the deck top at altitude 0 and the pad at `pad` (default 0,0).

## Loading

- `viewer/index.html?run=<dir>` reads `<dir>/viewer.json`, `result.json`,
  `manifest.json` (same origin only). `<dir>` is relative to the page, e.g.
  `?run=samples/sample-clean-hold` or `?run=../runs/<run_id>`. A path ending in
  `.json` is taken as the viewer file, siblings alongside.
- "Load files…" (or drag and drop): pick `viewer.json`, optionally with
  `result.json` and `manifest.json`.
- Duration is the larger of `result.duration_us` and the last sample time.
  Events from `result.json` appear as ticks on the timeline.

## 3D scene options

The 3D view draws a procedural city block around the rooftop vertiport. The
layout is in `scene/city.json` (fields: `scene/README.md`). The scene does not
change the data contract above: the deck top is still altitude 0 and the pad
is still at `pad`.

URL parameters for the scene (all optional):

| Parameter | Values | Default |
|---|---|---|
| `cam` | `chase`, `orbit`, `top`, `city`, `pad` (low view across the pad) | `chase` |
| `tod` | `day`, `golden`, `dusk` | `day` |
| `q` | `low`, `high` | `low` on touch devices, else `high`; the last choice is remembered |
| `wind` | `<from_deg>,<m/s>`, for example `270,5` | `vertiport.wind` in `city.json` |

| `pip` | `0`, `1`: onboard camera inset | `1`, or `0` on screens narrower than 640 px |
| `view` | `onboard`: the onboard camera fills the view | scene camera |
| `hud` | `0`, `1`: M3 HUD over the onboard view | `1` |
| `cfov` | onboard horizontal FOV in degrees, 10 to 150 | `perception.camera.hfov_deg`, else `70` |
| `cres` | onboard sensor size, for example `640x480` | `perception.camera`, else `640x480` |
| `cine` | `1`: start cinematic mode after the run loads | off |

Keys: `C` cycles the camera, `L` cycles the time of day, `Q` toggles quality,
`O` shows or hides the onboard inset, `V` swaps the main view and the inset,
`H` toggles the M3 HUD, `K` starts or stops cinematic mode.

## Onboard camera, M3 HUD and cinematic mode

The **onboard camera** is a second render of the same three.js scene from a
pinhole camera under the drone (lens 8 cm above the skid feet). It looks
straight down (roll and pitch stabilised) and the image top points along
`series.hdg`. It is a **simulated preview** only: real camera frames come from
Gazebo in M2. The drone model, trail, drop line and ruler are not visible to
it. The projection maths (`hud-core.js`) only places HUD marks over this
preview; it is not the perception camera model in `lab/perception/`.

The **M3 HUD** follows `design/vertiport-concept.html` section C. Each panel
shows only when the run has the data for it:

| HUD element | v1 data (`viewer.json` as above) | with the proposed v2 `perception` block |
|---|---|---|
| State chips | `states` (else `modes`), active = `series.state` | same |
| Tag box | projected from the known pad pose (dashed, "projected") | plus `perception.detection` corners (solid) |
| Truth marker, error line | pad centre projected into the preview | same |
| Horizontal error + 10 s sparkline vs limit | from `series.n/e` ("TELEMETRY") | from `perception.truth` ("TRUTH"), limit from `perception.limits` |
| Estimate ring, est − truth | hidden | `perception.estimate` (valid ticks only) |
| Confidence bar | hidden | `perception.estimate.confidence` vs `min_confidence` |
| Latency, rate | hidden | `estimate.latency_s`, `camera.rate_hz` |
| ABORT / LANDED banner | from the state name, `result.json` metrics and verdict | same |

**Cinematic mode** (`K` or `cine=1`) plays a fixed sequence on its own clock:
a wide city shot, a fly-in to the chase camera, the replay with automatic cuts
at mission-state changes (takeoff: chase, hold/search/approach: orbit,
land/descend: low pad view with the onboard inset, landed/done: top-down,
abort/fail: chase), lower-third titles (title, run id, result) and an outro
card. The cut plan is pure (`cine-core.js`) and tested.

To record a milestone video:

1. Start the server with `viewer/serve.sh`.
2. Open `viewer/index.html?run=<dir>&rec=1&cine=1&speed=2&tod=golden&q=high`.
3. Start the screen recording before the page loads, or press `K` two times to restart the sequence.
4. Stop the recording when the outro card is on the screen.

## Proposed v2: `perception` block (M3) — PROPOSAL, NOT YET IN THE CONTRACT

Status: **proposed**. The M3 exporter can add this optional top-level block
now. It does not change v1: `schema_version` stays `1`, `parseViewer` ignores
unknown top-level keys, and a malformed block is dropped with a warning
banner (the replay still loads). When the M3 team accepts the proposal,
`schema_version` becomes `2` and the block becomes part of the contract.
`samples/sample-m3-preview` is a synthetic example (listed under `previews`
in `samples/index.json`).

```json
"perception": {
  "version": 1,
  "camera":  {"width": 640, "height": 480, "hfov_deg": 70, "rate_hz": 30},
  "limits":  {"horizontal_m": 0.25, "min_confidence": 0.6},
  "estimate": {
    "source": "camera",
    "t": [7.5, 7.6], "valid": [0, 1], "confidence": [0.0, 0.71],
    "n": [0.0, 0.012], "e": [0.0, -0.008], "latency_s": [0.038, 0.041]
  },
  "truth":     {"t": [0.0, 0.1], "n": [0.0, 0.0], "e": [0.0, 0.0], "d": [0.0, 0.0]},
  "detection": {"t": [7.6], "corners": [[301.2, 220.4, 339.0, 221.1, 338.2, 259.0, 300.5, 258.3]], "margin": [41.0]}
}
```

| Field | Meaning | Source (proposal) |
|---|---|---|
| `version` | Block version, integer `1` | exporter |
| `camera.width/height` | Sensor size in px | Gazebo camera sensor |
| `camera.hfov_deg` | Horizontal FOV in degrees | Gazebo `horizontal_fov` |
| `camera.rate_hz` | Frame rate | Gazebo `update_rate` |
| `limits.horizontal_m` | Pass limit drawn on the HUD | scenario / success definition (0.25 m) |
| `limits.min_confidence` | Threshold tick on the confidence bar | `safety.py` threshold (owner's M3 piece) |
| `estimate.t` | Seconds, same time base as `series.t`, nondecreasing | `TargetEstimate.t_sim` |
| `estimate.valid` | 0 or 1 | `TargetEstimate.valid` |
| `estimate.confidence` | 0 to 1 | `TargetEstimate.confidence` |
| `estimate.n/e` | Estimated **pad centre** in the local NED frame of `series` (m) | `TargetEstimate.position_m`, converted to `local_ned` |
| `estimate.latency_s` (optional) | Seconds | `TargetEstimate.latency_s` |
| `estimate.source` | `camera` or `truth` | `TargetEstimate.source` |
| `truth.t/n/e/d` | Simulator ground-truth **vehicle** position, NED (m). Evaluation only | Gazebo model pose |
| `detection.t` | Frame times (s) | detector |
| `detection.corners` | Per frame: `null` (no detection) or 8 numbers, the tag corners `u0 v0 … u3 v3` in sensor px | detector |
| `detection.margin` (optional) | AprilTag decision margin | detector |

Rules (enforced by `parsePerception` in `hud-core.js`, tested in
`tests/hud.test.js`): every stream is columnar with equal-length arrays of
finite numbers; `t` is nondecreasing; `valid` is 0 or 1; `confidence` is in
[0, 1]; at least one of `estimate`, `truth`, `detection` is present. The HUD
draws truth markers only in this post-flight presentation render; in `camera`
mode the controller never reads truth (see `docs/architecture.md`).

## Live telemetry (M2+)

The UI renders from a `TelemetryStore` (columnar, same columns as above).
Replay fills it once; a live source only has to call
`store.append({t, n, e, d, alt, vz, mode, armed, state, hdg})` per sample
(time must not go backwards; `modes`/`states` tables must contain the indices
used). The websocket bridge is out of scope here. The viewer does not yet
follow a growing store: timeline length and trail rebuild would be added
with that bridge.

## Samples

`viewer/samples/make_samples.py` writes three **synthetic** runs
(`sample-clean-hold`, `sample-timeout-failure`, and `sample-m3-preview` with
the proposed v2 `perception` block) with `manifest.json`, `result.json`,
`viewer.json`. They have **no `flight.tlog`**, so
`plv check` rejects them by design; they are viewer fixtures, not evidence.
All hashes and the git commit in their manifests are placeholders.
