# M1 Brief — First flight, no 3D

Status: **draft, awaiting Collin's approval** · Timebox: 2–3 weeks wall-clock

## Goal

A simulated copter (ArduPilot SITL, built-in physics) takes off to 5 m, holds
5 s, lands and disarms — flown by **Collin's** `mission.py`, with every run
saved and checked automatically.

## Setup — approved in M0 review (A1, A2, A3, A7)

**Host steps (Collin runs these himself; agents never get the host password):**
1. Normal Omarchy update: `omarchy-update`. Reboot only if it asks, and only when convenient.
2. `sudo pacman -S --needed podman distrobox`

**Agent steps (no host sudo):**
- A2: create the `landing-lab` distrobox from the pinned Ubuntu 24.04 digest,
  with a dedicated home **outside** the project folder. Verify rootless podman works.
- A3: inside the container, review ArduPilot's `install-prereqs-ubuntu.sh` at the
  pinned commit *before* running it (log what it will install), build `Copter-4.7.2`
  SITL, create `requirements-m1.lock` (pymavlink etc., hashed).
- A7: add the official Apache-2.0 `LICENSE` and a `NOTICE`.

## What agents build

| Piece | Notes |
|---|---|
| `scripts/sitl-up` | Starts SITL in the container; prints the MAVLink endpoint. |
| `lab/link.py` | Connection helpers (connect, wait heartbeat, recv with timeout). |
| `lab/run.py` | Runs a mission, writes `runs/<run_id>/` (manifest, result, tlog). |
| Wall-power guard (A4 artifact) | Inside the runner: refuse heavy runs unless AC is online; watch AC; on unplug stop the whole process group, log the reason, no auto-resume. **Repo code only** — no system unit or logind change. |
| `validator/` (Rust, `plv check`) | Required files, schema, monotonic timestamps, manifest/result consistency. |
| Altitude plot + demo page | Sonnet builds, Opus accepts. Private by default. |
| Plumbing smoke test | Agents prove the pipeline with an ArduPilot **AUTO** waypoint mission (not GUIDED), so they never need to write Collin's solution. |

## Collin's piece: `mission.py` (skeleton + tests)

Agents deliver: state-machine skeleton (signatures and docstrings only), failing
tests that run against a **fake autopilot** (fast, no simulator) plus one
integration test against SITL, a hint ladder (`hints/m1/`, levels 1–3), and a
short primer 01 on how the tests and the fake autopilot work.

Steps (30–60 min each):
1. CONNECT → WAIT_READY
2. SET_GUIDED → ARM (confirm from the heartbeat, not just the ACK)
3. TAKEOFF → CLIMB (≥ 4.75 m) → HOLD 5 s
4. LAND → WAIT_DISARM, timeouts with failure reasons on every wait

**Agents must not write the mission logic.** The reviewer checks for this.

## Acceptance (demo, < 30 min)

- 5 consecutive runs of Collin's `mission.py` pass `plv check`.
- The guard refuses to start on battery (shown once).
- Video: animated altitude plot with a console replay, on the private demo page.
- Collin explains each state transition and answers primer 00's questions.

## How agents work in M1

- Sol is a **lean coordinator**: each task goes to a fresh worker with a short
  brief. One worker plus one reviewer. Claude reviews important Sol code
  (cross-provider). Sonnet does the plot and page; Opus accepts visuals.
- Branch per task (`m1/<task>`); merge to `main` after review.
- Output hygiene: cap command output at about 3k chars, keep a `local/m1/STATE.md`, and
  log every command to `local/m1/commands.log` from the start.
- Effort: start at default (medium). Raise effort only after a task fails review
  twice. Record effort, wall time and rework per task (this is the calibration).

## Boundaries

No host sudo or host config/service changes. Sudo inside the `landing-lab`
container only. No T3 service install, linger, logind changes or reboot. No
Gazebo, GPU or OpenCV. No GitHub repo creation or push. Lid/remote tests
(A10) are **not** approved; they get proposed at the M1 demo. Stop and ask the
planning thread if anything needs to cross these lines, or if the timebox is about to run out.
