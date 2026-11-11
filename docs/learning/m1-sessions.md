# M1 sessions: six short sessions

Procedures in this repository follow ASD-STE100 Simplified Technical English.

This plan replaces the study-first order for M1 (review A-09). You do before you read.
Each session takes 30 to 60 minutes. Reading takes 20 minutes at most. Stop at the end of the session.
After each session, write one row in `progress.md`. The row has the date, the session, what you finished, your next action and your hint file number. The tutor proposes the help level in chat. You write it. All hint files are help level 2.

| # | Session | Read (max 20 min) | Do | Result you can see |
|---|---|---|---|---|
| 1 | First flight by hand | `primer/01-state-machine.md` (10 min). Primer 00 if you want more. | The platform agent starts SITL after your approval. You type the MAVLink commands: mode GUIDED, arm, takeoff, wait, land. Watch the ACK and STATUSTEXT lines. Replay the flight in the viewer. | You see your own flight in 3D. You see an arm refusal if you arm too early. No code. |
| 2 | Listen, then step 1 | Explainer 01, parts A to C (15 min). | Run `./learn listen --seconds 30` against SITL. Find the facts that make the arm work. Write `connect()` and `wait_ready()`. Run `./learn step 1`. | Step 1 passes. You can say what "ready" means. |
| 3 | Step 2 | Explainer 01, parts D and E. MAVLink command protocol, resource 1.3 (15 min). | Write `set_guided()` and `arm()`. Run `./learn step 2`. Make the fake refuse your arm command. Read the ACK and the text. | Step 2 passes. The fake arms. You know what an ACK is not. |
| 4 | Step 3 | None. Use `hints/step-3` only if you want help. | Write `takeoff()`, `climb()` and `hold()`. Run `./learn step 3`. | Step 3 passes. The fake climbs and holds. |
| 5 | Step 4 and faults | None. | Write `land()` and `wait_disarm()`. Run `./learn step 4` and `./learn status`. Read each fault test. | All 12 tests pass. |
| 6 | Your code in SITL, then the gate | None. | After approval, fly your code in SITL with `--pilot`. Replay the run. Do the mastery gate (`docs/learning/mastery-gate.md`). | Your code flies. You explained each transition. |

## Rules

- No code in session 1. The flight by hand gives you the real picture before you write.
- One step for each session. Do not start the next step in the same session.
- Spend no more than 20 minutes without progress. Then use help level 0 (a question). See `docs/learning/tutor.md`.
- Two sessions on one step: a tutor agent shows an example of a different problem. You then write your own solution in the next session.
- Each session changes what you see. After step 2 the fake arms. After step 3 it climbs. After step 4 it lands.
- The old study table in `roadmap.md` remains for the optional reading. Do not read it all first.

## After session 6

Session 6 is the gate for M1. When the gate passes, M1 ends. Work for M2 starts only after that (review A-12).
