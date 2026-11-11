# Milestones

Each milestone: **brief approved by Collin → agents build + review → Collin's
pieces → <30 min demo with video → Collin accepts or sends back.**
Timeboxes are wall-clock with Collin at 3–5 h/week; hitting a timebox means
stop and re-scope together, not push harder.

## M0 — Inventory & proposals (≈1 week · read-only)

Agents (read-only, no installs or changes):
- Host: CPU/RAM/disk, temperatures, power and lid/sleep settings, NVIDIA state.
- T3 Connect: current state, what installing the service would change.
- Versions: pick compatible Ubuntu + ArduPilot + Gazebo + ardupilot_gazebo
  plugin; confirm `LANDING_TARGET` precision landing on that ArduPilot version.
- Calibration: one small task to compare default vs raised effort.

Deliverable: an **install & setup proposal** with exact commands, versions,
what changes, how to undo — for Collin to approve item by item.
Collin: read a 1-page primer "What is SITL and MAVLink?"; approve/decline items.

## M1 — First flight, no 3D (≈2–3 weeks)

Agents: container build script, SITL launch, run directory + manifest, Rust
validator, altitude plot.
**Collin's piece:** `mission.py` — connect, arm, GUIDED takeoff to 5 m, hold 5 s,
land, wait for disarm (state machine skeleton + tests).
Accept when: 5 consecutive runs pass the validator; video of the altitude
plot/console replay; Collin can explain each state transition.

## M2 — 3D world + camera (≈3 weeks)

Agents: Gazebo world with an AprilTag pad, downward camera, frame recording,
video capture, GPU decision if CPU rendering is too slow.
**Collin's piece:** detect the tag in recorded frames and compute its position
in the camera frame (offline mode, scored against truth).
Accept when: same M1 flight in Gazebo with a video; offline detection report
with error stats; M3 threshold re-checked.

## M3 — Find & land on the pad (≈4–6 weeks)

Agents: `LANDING_TARGET` sender, precision-landing parameter setup, truth mode,
evaluation runner, report page.
**Collin's pieces:** (1) frame conversion camera → body → local NED producing a
`TargetEstimate`; (2) validity/confidence rules and abort conditions.
Accept when: **≤ 25 cm, 8/10 runs, calm, camera mode**, validator confirms no
truth leakage; truth-vs-camera comparison in the report; landing video.

## M4 — Harder conditions (≈4 weeks)

Agents: seeded scenarios (lighting, pad offset, wind if supported), batch runs,
metrics dashboard.
**Collin's piece:** design the evaluation seed set and analyze one failure mode.
Accept when: fixed-seed evaluation report with success rate per condition.

## M5 — Polish & release candidate (≈2–3 weeks)

Agents: cleanup, README, docs, final report and video.
**Collin's piece:** write the README "How it works" section in your own words.
Accept when: full pre-publish checklist passes and Collin approves.

---

## Pre-publish checklist (first push; lighter re-check each milestone)

- [ ] Secret scan clean (keys, tokens, `.env`, credentials in history).
- [ ] No personal info: home paths, email, hostnames, IPs.
- [ ] `LICENSE` (Apache-2.0, official text) and `NOTICE` present.
- [ ] Third-party assets (models, textures, tag images) listed with licenses.
- [ ] Dependencies and their licenses listed.
- [ ] `runs/`, videos and logs not committed unless Collin chose them.
- [ ] README is accurate: status honest, no overclaiming.
- [ ] Collin reviewed the exact file list and history to be pushed.

## Remote & lid-closed acceptance tests (set up in M0/M1, after approval)

1. Lid shut on wall power: connect from MacBook via T3 Connect within 2 min.
2. A 10-min SITL run completes lid-shut; CPU temps logged, no thermal shutdown.
3. Remote client disconnects mid-run; run continues; reconnect shows progress.
4. Network drop and recovery; session reconnects.
5. On battery: heavy sims refuse to start or pause.
6. (Only with approval) reboot recovery: services come back without manual login.

## Workflow

- `main` stays green; agent work happens on short branches/worktrees per task.
- Meaningful commits from day one (docs first). Important changes get a
  cross-provider review before merge.
- Collin's pieces live in `learn/` branches; reviewers check agents didn't
  fill in solutions.
- Checkpoint = tests run + short note in the milestone log.

## Risks

| Risk | Mitigation |
|---|---|
| ArduPilot/Gazebo/plugin version mismatch | Pin in M0; container rebuildable. |
| CPU camera rendering too slow | Lower resolution/rate; GPU diagnosis; StarkPC as optional fallback. |
| Laptop sleeps or overheats lid-shut | M0 proposal + acceptance tests 1–5; wall power only. |
| Subscription limits hit | Pause and ask; no paid fallback. |
| Learner stalls on a piece | Hint ladder, 30–60 min steps, re-scope at timebox. |
| Accidental public leak | Pre-publish checklist; `runs/` git-ignored. |
| Scope creep (learned perception, Isaac) | Non-goals in charter; new scope = new decision entry. |
