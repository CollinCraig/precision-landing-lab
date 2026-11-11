# Start here

This repository is yours. You write `mission.py`. The platform gives the equipment.
Procedures here follow ASD-STE100 Simplified Technical English.

## Your next session

Read `progress.md`. The last row tells you the next action.
If `progress.md` has no rows, do Session 1. Session 1 needs no code.

## The six sessions

Each session takes 30 to 60 minutes. Stop at the end of the session. Do not read ahead.

| Session | What you do | Code |
|---|---|---|
| 1 | Read `primer/01-state-machine.md`. Follow `SESSION-1.md`. Type the commands of one manual SITL flight yourself. Watch the replay in the viewer. | none |
| 2 | Run `./learn listen`. Read the ACK and STATUSTEXT lines. Write step 1. | step 1 |
| 3 | Write step 2. Run `./learn fake --fault arm_denied` and read why the fake refuses. | step 2 |
| 4 | Write step 3. Measure height and hold time. | step 3 |
| 5 | Write step 4. Run all fault tests. | step 4 |
| 6 | Fly your code in SITL. Replay the run. Do the mastery gate. | gate |

Details are in the platform file `docs/learning/m1-sessions.md`.
The names that you need are in `API.md`. Open it at any time.

## Commands

Run all commands from this folder.

| Command | What it does |
|---|---|
| `./learn status` | Show which steps pass. Show your next action. |
| `./learn step 1` | Run the tests for step 1. Use 2, 3 or 4 for the other steps. |
| `./learn listen --seconds 20` | Print decoded messages from a running SITL. It says so when SITL is not running. |
| `./learn fake --fault NAME` | Run your mission once against the fake autopilot. `API.md` lists the fault names. |
| `./learn doctor` | Check the platform path and the platform pin. |

When a test fails, read the message. Then read the evidence file that the message names.
The path is `local/last-run/test_<name>/mission.stderr`. It shows every ACK, every STATUSTEXT and your own lines.

## Files

| File | Purpose |
|---|---|
| `mission.py` | Your code. Nine states. Each has a question. |
| `API.md` | The names: `ap` methods, message fields, `budgets`, failure codes and fault names. |
| `SESSION-1.md` | How to fly by hand in SITL and replay the flight. |
| `primer/01-state-machine.md` | The ideas for M1. One page. |
| `hints/step-N/hint-1.md` to `hint-3.md` | Optional help. Use one hint at a time. Hint 3 gives design help. It does not give names. |
| `notes/m1.md` | Your own explanation. You write it in the mastery gate. |
| `progress.md` | One row for each session. You write it. |
| `PLATFORM_PIN` | The platform version that this repository needs. |

## Help

- Use no help first. Read the failing test message.
- Use one hint file at a time. All hint files are help level 2.
- Write the number of the highest hint file that you opened (1 to 3) in `progress.md`, column "Hint file".
- A tutor agent asks questions. It does not write your code.
- If the fake autopilot or a test looks wrong, tell the platform agent. This is not your fault.

## Safety

- Use simulation only. Do not connect this code to a real aircraft.
- Keep the computer on wall power for a SITL flight.
- Get approval before a SITL flight.
