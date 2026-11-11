# Launch plan (proposal)

Every external action below is marked **Collin approves**. Nothing happens until each is approved. Order matters: do not skip ahead.

## Preconditions (internal, no approval needed to prepare)

1. Fix the FAIL findings in `prepublish-dry-run.md` (paths, author email) and complete TODO items. History cleanup is a decision, see step 3.
2. Pick the headline for the first public state. Suggest launching at **end of M1** (first flight, validator, replay video) as an honest "early" project, not waiting for M5. The charter says "public, early, incremental".

## Steps in order

| # | Step | Approval |
|---|---|---|
| 1 | Review final README, `THIRD_PARTY.md`, file list (`git ls-files`) and history summary | **Collin approves** |
| 2 | Choose history strategy: keep history with rewritten paths/email, or publish from a fresh squashed first commit (loses the D-018 decision-log trail in commits, but `docs/` keeps it) | **Collin approves** |
| 3 | Install and run a secret scanner (gitleaks) in the container | **Collin approves** (install) |
| 4 | Create the GitHub repo `precision-landing-lab` (public; D-013 still proposed) under Collin's account | **Collin approves** |
| 5 | Set repo description, topics, social image (below) | **Collin approves** |
| 6 | First push of `main` | **Collin approves** (fixed stop, charter) |
| 7 | Tag and release `v0.1.0` (below) | **Collin approves** |
| 8 | Enable features: Issues on; Discussions optional; branch protection on `main` (PR + review) | **Collin approves** |
| 9 | Post announcements (below) | **Collin approves** each post and its wording |

## Repo settings

- **Description (proposal):** "Simulation-only autonomous vertiport landing (AAM): ArduPilot SITL + AprilTag, land or safe abort. Built by one learner with an AI agent team."
- **Topics:** `advanced-air-mobility`, `vtol`, `ardupilot`, `sitl`, `gazebo`, `apriltag`, `precision-landing`, `autonomous-landing`, `mavlink`, `robotics`, `simulation`, `rust`, `python`.
- **Website:** leave empty until a results page exists.
- **Social preview:** architecture diagram or hero frame, once the video exists.
- **Not enabled:** Sponsors, Wiki, Packages.

## First release / tag

- `v0.1.0`, marked **pre-release**. Title: "M1: first flight (simulation)". Notes: what works (validator, run format, first runs), what does not (no landing, no 3D), link to milestones. Attach only small items Collin picks (e.g. altitude-plot replay clip). No raw logs.
- Later tags: `v0.2.0` M2, `v0.3.0` M3 (headline results), `v1.0.0` after M5.

## What to post where (all optional, Collin decides)

| Venue | Content | When |
|---|---|---|
| GitHub release notes | Honest status + clip | with `v0.1.0` |
| LinkedIn / personal profile | Short post; the one-line hook; no outcome claims | Collin's call |
| ArduPilot Discourse (Copter / SITL) | Brief "show your project" with the diagram and a question about `LANDING_TARGET` | after M3 results |
| r/ardupilot, r/robotics | Video-led post | after M3 |
| School / teacher | Link plus a 1-page summary | any time |

Tone: results first, limits stated. Say "simulation only". No employment claims, no claims of safety for real aircraft, no benchmark comparisons I have not measured.

## After launch

- Lighter re-check at each milestone (the checklist subset: secrets, paths, assets, README accuracy).
- Update the "How this was built" table as Collin's pieces land.
- Watch for issues; Collin decides what to answer. Agents draft replies only.
