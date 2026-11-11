# Landing Lab plan v2 (charter v2)

Status: **Approved (D-042)** · Date: 2026-11-11 · Source: council rounds 1–4, D-036…D-041

This plan replaces the scope and sequence parts of `docs/charter.md`.
The roles, power rules, approval rules and publication rules in the charter stay the same.
Private career material (gaps, résumé framing, applications) is in a local file and is not part of this document.

## 1. Recommendation

Keep the application: an autonomous copter lands on a scaled rooftop vertiport with an AprilTag, or safely aborts and goes around.
Six council members (four with weight 1.0, two with weight 0.7) agreed on the core over four rounds.
The weighted round-4 score for the plan as a hiring artifact is approximately 7.4 of 10.
All members said the same thing: the largest gap that the lab can close is **proof of the owner's own code**.
Thus the plan puts the owner's own code first and cuts everything that does not help that proof.

The one sentence that must be true first:

> "I wrote the estimator and the abort logic, I can show every decision it made, and I can show where it fails."

## 2. What the lab is

Two repositories (D-038):

| Repository | Who writes it | Contents |
|---|---|---|
| `precision-landing-lab` (platform) | Agents, directed by the owner | SITL + Gazebo setup, SITL launcher, fake autopilot, Rust truth-leak validator, three.js replay viewer, worlds, learning pages, CI |
| `landing-pilot` (owner) | The owner. One labelled starter commit, then only owner commits | Mission state machine, frame chain, estimator, safety policy, decision tape, evaluation runner, tests, notes |

Three pillars, done in strict sequence:

1. **Pillar 1 — integrity core (S1).** Mission state machine; camera → body → NED frame chain; a `TargetEstimate` with a **claimed error bound** from a Kalman filter (KF or EKF) covariance; consistency checks (pose flip, stale frame, wrong tag id); a final-meters policy; a **decision tape** that records each continue / hold / go-around with the measurement, the limit and the trigger.
2. **Pillar 2 — failure museum (S2).** Each exhibit is a failure of the owner's code, with a replay seed, his diagnosis, his fix and a regression test. First by hand and by simple search (random, bisection). Later an **AI test agent that the owner writes** (constrained MCP tools, scenario schema, deterministic judges, budgets), compared with random and structured search at equal budget.
3. **Pillar 3 — real-world bridge.** First real images (webcam, manual DJI Mini 2 footage) through the same perception and estimator code. Later the same code on a small indoor drone with an overhead webcam truth rig ("one pilot, two worlds"). A hardware purchase needs owner approval.

Engineering base in `landing-pilot` (all owner-written):

- Tests: pytest, Hypothesis property tests on transforms, a CI seed matrix, a flaky-test policy.
- Typing (mypy strict on core modules) and green CI.
- A **SQL run store** (SQLite or DuckDB): one row per run and per decision; metrics are SQL queries that CI runs.
- A **math note** that derives the claimed bound from the filter and shows hand calculations for the bound and the Wilson intervals.
- Data structures where they are natural: ring buffer (frame history), priority queue (search frontier), state graph (mission), bisection (smallest failing disturbance). Each one has its complexity written in the code docs.
- A **C++17 module** after Pillar 1 v0 works in Python (D-041): frame chain and estimator, GoogleTest, Python bindings (pybind11 or nanobind), the same test vectors as the Python version. Python stays the orchestration language.
- `ATTRIBUTION.md` (who wrote each module), `HINTS.md` (each hint level used), design notes and failure memos.

## 3. What is cut or deferred

- **Cut from the hiring path:** the MartyGraphics / Morrowdock layer. It can link to the lab after the first paid role. D-030 and D-034 integration work waits until then.
- **Deferred:** custom GUIDED controller (ArduPilot precision landing comes first), ROS 2 node, extra graphics, platform rewrites, VTOL, ADS-B, multi-aircraft.
- **Not on the owner's list:** the Rust validator and the viewer. Agents keep them as platform tools.
- **Frozen until the owner's code flies (D-036):** new platform side projects.

## 4. Sequence and milestones

Durations are guides, not deadlines (D-037). Each step starts only when the step before it passes its gate.

| Step | Contents | Gate |
|---|---|---|
| 0 | Part 107 exam (Dec 4) has priority for owner time. Agents finish P2: SITL flight, launcher, `scripts/learn init`, owner package | P2-a, P2-b |
| **A** | **Application milestone** (section 5). Target Feb–Mar 2027 | Owner checks the list; start applications |
| 1 | Pillar 1 v0: camera-mode landing, KF bound, decision tape, SQL run store, test layer, ≥100 pre-registered seeds | M3 acceptance + integrity metrics |
| 2 | C++17 module (D-041) | Same test vectors pass in C++ and Python |
| 3 | Failure museum by hand and simple search: ≥8 exhibits | Each exhibit has seed, diagnosis, fix, regression test |
| 4 | Real-image tests: webcam and Mini 2 frames, labelled | Offline error report on real frames |
| 5 | Owner-written AI test agent vs random and structured search | Equal-budget comparison with repeats |
| 6 | Indoor drone with truth rig (after purchase approval) | Same commit flies in SITL and indoors |

The old M1–M5 milestones in `docs/milestones.md` stay valid inside steps 0, A and 1. Steps 2–6 replace the old post-M5 roadmap order.

## 5. Application milestone (the smallest version)

The owner applies for paid roles **when this list is done**, before the full lab exists.

1. An **evaluation runner that the owner writes** in `landing-pilot`. It runs seeds through the platform launcher and writes machine-readable results. (The platform keeps the SITL launcher.)
2. Owner-written mission and safety logic in SITL (truth mode is acceptable; camera mode is better).
3. Frame-transform tests and a stale-frame test.
4. CI over **60 fixed held-out seeds** (30 calm, 30 disturbed), with land rate, false-abort rate and Wilson intervals.
5. One demonstrated go-around.
6. One failure report (seed, cause, fix, regression test).
7. An ownership statement (`ATTRIBUTION.md`).
8. FAA Part 107 passed.

## 6. Evidence targets (full plan)

These are the numbers that the council asked for. They apply after the application milestone.

- Own commits on every core module; core modules contain no AI-written code; hint use is logged.
- ≥300 pre-registered seeds per condition; land rate ≥90% with Wilson lower bound ≥85%; false-abort rate ≤5%; zero unsafe descents.
- Bound coverage (true error inside the claimed bound) 93–97%, with the bound widths reported.
- ≥8 museum exhibits; for the AI agent: failures found per budget against random and structured search, ≥5 repeats.
- ≥500 labelled real frames; later ≥20 indoor landings and ≥20 induced aborts with truth-rig statistics.
- A 3-minute video, a 2-page design document and a README result table.
- Two clean-environment reproductions of the main result.
- One independent code review by a person outside the project.

## 7. Upstream contributions

- One upstream pull request per month that the owner writes himself.
- Start: pymavlink PR #1321. The owner rewrites the fix himself, or he answers the review comments himself.
- Do not call an open pull request a contribution until it is merged.

## 8. Rules that do not change

- Agents never write the owner's solutions (charter, tutor rules).
- The truth boundary and the Rust validator stay in place for every reported result.
- All approval, power and publication rules in the charter stay in place.
