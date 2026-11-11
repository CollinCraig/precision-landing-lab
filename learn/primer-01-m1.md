# Primer 01: A bounded GUIDED mission

## Purpose

You own `lab/mission.py`. The file has no working mission.
The runner and test equipment supply transport and evidence support.
The fake autopilot does not model aircraft physics or prove flight safety.

## Safety

- Use simulation equipment only.
- Do not connect this exercise to a real aircraft.
- Keep the computer on wall power during an approved SITL test.
- Do not start or install a container for the unit tests.
- Get approval before a SITL run or an installation.

## Acceptance contract

Enter these phases in order. Record each phase once with `client.event(phase)` on entry.

| Phase | Required result |
| --- | --- |
| CONNECT | Receive a valid autopilot heartbeat. |
| WAIT_READY | Confirm readiness from autopilot telemetry. The fake uses STANDBY or ACTIVE. |
| SET_GUIDED | Request GUIDED mode. Confirm GUIDED from a heartbeat. |
| ARM | Request arm. Confirm the armed bit in a later heartbeat. |
| TAKEOFF | Request a target height of 5 metres. |
| CLIMB | Confirm relative altitude of at least 4.75 metres. |
| HOLD | Keep the aircraft at height for at least 5 seconds. |
| LAND | Request LAND after the hold. |
| WAIT_DISARM | Confirm disarm from a later heartbeat. Then report success. |

The fake uses `GLOBAL_POSITION_INT.relative_alt` in millimetres.
The fake requires the height threshold before HOLD completes.
Do not send an explicit disarm command to satisfy the landing check.

## Runner boundary

Read `lab/PROTOCOL.md` before you change the exercise.
`lab.mission_child` calls your function with a `MissionClient` and a finite `wait_timeout`.
`MissionClient` exchanges JSON lines. It does not encode MAVLink commands or select mission transitions.

- Use `client.receive(message_type, timeout)` for wire bytes or `None`.
- Use `client.send(packet)` for an encoded MAVLink packet.
- Use `client.event(kind)` for a declared phase event.
- Use `client.outcome(success, code, detail)` for one terminal result.
- Keep diagnostic text on stderr.

A send response confirms transport acceptance only. It does not confirm an aircraft state.
The runner delivers HEARTBEAT and GLOBAL_POSITION_INT. It does not deliver COMMAND_ACK.
Use the existing environment's MAVLink codec, or your own codec, without changing the host environment.

## Time limits

Bound each state wait with `wait_timeout`. The launcher defaults to 10 seconds.
Fake learner tests use 2 seconds for each state wait and 14 seconds for the complete process.
The five-second HOLD is separate from each state wait budget.
A receive timeout cannot exceed 5 seconds. Repeated receive calls do not create a total deadline.
Report a specific failed outcome when a deadline expires.
Do not rely on the runner watchdog as the mission's timeout control.

## Learning steps

1. Spend 30–60 minutes on connection, readiness and mode confirmation.
2. Stop at a checkpoint with phase events and a bounded failure.
3. Spend 30–60 minutes on arm confirmation, takeoff and height measurement.
4. Stop at a checkpoint with a measured relative height.
5. Spend 30–60 minutes on hold, landing and disarm confirmation.
6. Run the separate checks in `tests/M1.md`.
7. Record the last checkpoint and one next action before you stop.

Explain why a sent command does not prove success. Explain how each wait ends after telemetry stops.
Optional help remains in `hints/m1/level-1.md`, `level-2.md` and `level-3.md`.
Open a hint file only when you want that level of help.
