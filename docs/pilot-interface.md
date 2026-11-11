# Pilot interface

Procedures in this repository follow ASD-STE100 Simplified Technical English.

This page describes how the platform runs the owner's code (D-038).
The owner's code is in a separate repository, `landing-pilot`. The platform never contains it.

## Two repositories

| Repository | Owner | Contents |
|---|---|---|
| Platform (this repository) | Agents build it. Collin directs it. | Runner, validator, viewer, fake autopilot, step tests, `scripts/learn`, learning pages. |
| `landing-pilot` | Collin | `mission.py`, notes, `progress.md`, a copy of the hints, a platform pin. |

`landing-pilot` starts with one commit, "starter code from the platform", made with an agent identity.
Collin makes every later commit. The pilot repository has no remote.

## The pilot folder contract

The pilot folder holds a file `mission.py`. The file must contain:

- `PLATFORM_INTERFACE = 1`. The platform refuses a different value.
- `run(ap, budgets)`. The runner calls it once.

`run()` must end with `ap.succeed()` or `ap.fail(code, detail)`. A return with no result is a failed run (`mission_exception`).
Helper modules in the same folder can be imported.

### `ap` (class `Autopilot`, file `lab/pilot_api.py`)

| Item | Meaning |
|---|---|
| `ap.receive(type=None, timeout=1.0)` | Return the next decoded message, or `None` after `timeout` seconds. With `type`, other messages are stored and skipped. |
| `ap.latest` | A dictionary: message type name to the last message of that type. |
| `ap.acks`, `ap.texts` | Every COMMAND_ACK and every STATUSTEXT seen. They are also printed to stderr. |
| `ap.send_command(command, *params)` | Send COMMAND_LONG. The reply from the transport is not a reply from the autopilot. |
| `ap.set_mode(custom_mode)` | Send SET_MODE. Only a later HEARTBEAT confirms it. |
| `ap.request_interval(type, hz)` | Ask the autopilot to send a message type at a rate. |
| `ap.phase(name)` | Record entry into a state. The log line shows the step number. |
| `ap.succeed()`, `ap.fail(code, detail)` | Report the one terminal result. |
| `ap.log(*parts)` | Print one line with the elapsed time. Plain `print()` also works. |

A decoded message has attributes for its fields, for example `msg.custom_mode`. `msg.pretty()` gives one safe line.
Units stay raw. For example, `relative_alt` is in millimetres. The owner converts units.

Decoded types: HEARTBEAT, SYS_STATUS, GPS_RAW_INT, GLOBAL_POSITION_INT, COMMAND_ACK, EKF_STATUS_REPORT, STATUSTEXT.
`lab/mavlite.py` is the codec. It is platform plumbing. The owner does not write wire code (review A-01).
`lab/mavlite.py` also names numbers. It names commands, the ArduCopter modes GUIDED and LAND, the armed bit, the EKF position bit and the ACK results.
The numbers and the state list are given openly. The design of each state is the owner's work.

### `budgets` (class `Budgets`)

One time limit in seconds for each wait: `connect_s`, `ready_s`, `guided_s`, `arm_s`, `takeoff_s`, `climb_s`, `hold_s`, `telemetry_gap_s`, `disarm_s`.
`hold_s` is the hold time. `telemetry_gap_s` is the longest silence in HOLD. The learner page `pilot-template/API.md` lists all values.
There are two profiles. The values come from the first real SITL flight (review A-03).

| Profile | Use | ready_s | takeoff_s | climb_s | telemetry_gap_s | disarm_s |
|---|---|---|---|---|---|---|
| `fake` | Fake autopilot tests | 2 | 2 | 2 | 1 | 2 |
| `sitl` | Real SITL. Readiness took 37 s. Landing from 5 m took 13 s. | 120 | 10 | 20 | 3 | 40 |

The hold is 5 s in both profiles. A SITL run needs a runner `--timeout` of 240 s.

## Run the pilot

```sh
python -m lab.run --pilot <folder> --profile sitl --runs <dir> --run-id <id> --seed 1 --scenario m1-sitl \
    --mode offline --input-source runner --input-source autopilot \
    --ardupilot-version <version> --container <image@sha256:digest> --timeout 240
```

- `--pilot` starts `python -m lab.mission_child --pilot <folder>`. The runner adds the platform folder to `PYTHONPATH`.
- `--pilot` and a command after `--` exclude each other. The command form stays for equipment tests.
- The runner never starts SITL. The wall-power guard stays on.
- Without the flag, the environment variables `M1_PILOT` and `M1_PROFILE` choose the folder and the profile.

## What the owner sees when something fails

- The child process keeps the protocol on a private copy of stdout. `print()` goes to stderr, so it cannot damage the protocol (review A-04).
- An exception prints its full traceback to `mission.stderr`. The failure detail names the file and the line.
- `scripts/learn step N` keeps the last run in `local/last-run/` of the pilot folder. A failed test prints the end of `mission.stderr`.
- Before the first telemetry, the runner renames a failure to `runner_error` and keeps the old code in the detail. The test messages explain this.
- COMMAND_ACK, STATUSTEXT, SYS_STATUS, GPS_RAW_INT and EKF_STATUS_REPORT reach the mission. The runner writes them to `aux.tlog` in the run folder.
  `flight.tlog` keeps only HEARTBEAT and GLOBAL_POSITION_INT, so run format v1 and the validator do not change.

## Tests and the fake autopilot

- `tests/test_pilot_steps.py` has four classes: `Step1Tests` to `Step4Tests`. Each class is one step.
- The tests run only when `M1_PILOT` is set, or through `scripts/learn step N`. Platform CI skips them.
- The fake follows the real flight. The heartbeat says STANDBY from the start. Arming is refused until GPS has a fix and the EKF uses GPS.
  The fake sends COMMAND_ACK and STATUSTEXT. A refusal sends the STATUSTEXT reason first, then the ACK.
- Faults: no heartbeat, never ready, mode stuck, arm ACK accepted but no state change, arm refused, climb stuck,
  telemetry lost (no takeoff ACK), telemetry lost in HOLD, disarm stuck. The learner runs one fault with `scripts/learn fake --fault NAME`.
- The fake proves the sequence of requests and proofs. It does not prove flight safety.
- `tests/test_m1_sitl.py` is the opt-in SITL check. It needs `M1_PILOT` and a human-approved SITL run.

## `scripts/learn`

| Command | Action |
|---|---|
| `scripts/learn init` | Create the pilot repository. Default `~/Projects/landing-pilot`. `--pilot <path>` or `LANDING_PILOT` changes the path. |
| `scripts/learn status` | Run all steps. Show the next action. |
| `scripts/learn step N` | Run the tests of step N. Show the first failure and the next action. |
| `scripts/learn fake --fault NAME` | Run the mission once against the fake autopilot. Print the log and the result. |
| `scripts/learn doctor` | Check the platform path, the platform pin and the interface number. |
| `scripts/learn listen` | Print decoded messages from a running SITL (`--endpoint`) or from a tlog file (`--replay`). With no packets it says that SITL is probably not running. |

`scripts/learn init` refuses a folder that is not empty. It adds no remote. It makes exactly one commit.
The agent identity comes from D-036. `LEARN_AGENT_MODEL` sets the model name in the identity.
The pilot repository also has a wrapper, `./learn`. It calls the platform tool with the right folder.

## Decision: a pinned path, not a submodule

The pilot repository contains a file `PLATFORM_PIN`. It holds the platform commit and the interface number.
The local file `.platform-path` (not in Git) holds the location of the platform on this computer.

Reasons:

- A submodule needs a URL. The platform has no remote yet. A local path in `.gitmodules` would put a home path in a tracked file. It also breaks when the repository goes public.
- Recent Git versions block local-path submodules by default.
- A submodule adds nested Git state. A beginner does not need it.
- A pin file is plain text. `scripts/learn doctor` compares it with the platform history. It warns when the platform is newer. It stops when the interface number differs.

Change this when the platform has a public URL. Then a submodule is possible.

## Time base

M1 measures the 5 s hold with the wall clock (`time.monotonic`). SITL runs at speed 1 in M1 (`scripts/sitl-up` uses `--speedup 1`).
If a later milestone changes the speed, the pilot must read `time_boot_ms` from GLOBAL_POSITION_INT. Decide this before that change (review A-14).
