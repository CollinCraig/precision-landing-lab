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
| `cam` | `chase`, `orbit`, `top`, `city` | `chase` |
| `tod` | `day`, `golden`, `dusk` | `day` |
| `q` | `low`, `high` | `low` on touch devices, else `high`; the last choice is remembered |
| `wind` | `<from_deg>,<m/s>`, for example `270,5` | `vertiport.wind` in `city.json` |

Keys: `C` cycles the camera, `L` cycles the time of day, `Q` toggles quality.

## Live telemetry (M2+)

The UI renders from a `TelemetryStore` (columnar, same columns as above).
Replay fills it once; a live source only has to call
`store.append({t, n, e, d, alt, vz, mode, armed, state, hdg})` per sample
(time must not go backwards; `modes`/`states` tables must contain the indices
used). The websocket bridge is out of scope here. The viewer does not yet
follow a growing store: timeline length and trail rebuild would be added
with that bridge.

## Samples

`viewer/samples/make_samples.py` writes two **synthetic** runs
(`sample-clean-hold`, `sample-timeout-failure`) with `manifest.json`,
`result.json`, `viewer.json`. They have **no `flight.tlog`**, so
`plv check` rejects them by design; they are viewer fixtures, not evidence.
All hashes and the git commit in their manifests are placeholders.
