# Charter — Precision Landing Lab

Status: **planning** · Owner: Collin Craig · Started 2026-11-10

## Purpose

A simulation-only lab where one drone finds a landing pad, approaches it and
lands on it — built so that the owner **learns how it works**, not just that it
works. Agents build the plumbing; the owner writes the core pieces.

## Who does what

| Role | Who | Responsibilities |
|---|---|---|
| Owner / learner | Collin | Approves milestone briefs and demos, writes the "your piece" exercises, approves all installs, system changes and publication. ~3–5 h/week, flexible. |
| Planning & acceptance | Claude Opus | Architecture, milestone briefs, visual/demo acceptance, plan upkeep. |
| Execution | Codex Sol | Coordination, Python, simulation plumbing, Rust validator, tests. |
| Routine UI/reports | Claude Sonnet | Report generator, demo pages, plots. |
| Review | Opposite provider | Important changes get an independent review from a model of the other provider. |

Default staffing: one implementation worker + one reviewer per task.
Effort is raised before switching models.

## Learning model

- Roughly **60% building / 40% learning** across the project.
- Each milestone has **1–2 pieces Collin owns**. Agents deliver, for each piece:
  a skeleton with signatures and docstrings, failing tests, a ≤1-page primer and
  a hint ladder (gentle → explicit).
- Agents **never write Collin's solution** unless Collin asks for a specific
  hint level.
- Pieces are split into **30–60 minute steps**, each ending at a checkpoint
  (tests show progress, a two-line "next step" note). Missing a week costs nothing.

## Scope

In scope:
- ArduPilot SITL (copter) + modern Gazebo, in an Ubuntu container on the Omarchy laptop.
- Python (pymavlink, OpenCV, AprilTag) for mission, perception and evaluation.
- ArduPilot's built-in precision landing fed by `LANDING_TARGET` as the first
  guidance path; a custom GUIDED controller is an optional later comparison.
- A small Rust tool that validates run outputs.
- Seeded scenarios, metrics, flight videos and reports.

Non-goals (for now):
- Real hardware; Isaac Sim; training a flight controller from scratch;
  learned perception before the simple AprilTag baseline works; a whole-stack
  rewrite in Rust; multi-drone; exact physics reproducibility.

## Success

- **M3 headline:** lands within **25 cm** of pad center in **8 of 10** tries in
  calm conditions (threshold revisited after M2 camera results).
- Every milestone ships a flight video and a <30 min demo.
- Collin can explain how every part of the landing pipeline works.

## Hard constraints

- **Host:** Omarchy laptop is the primary, always-on machine. MacBook/iPad are
  remote clients via T3 Connect. StarkPC is optional compute only.
- **Power:** heavy simulation runs lid-shut **only on wall power**; on battery
  only light work (code, tests, planning).
- **Approvals required** before any install, system/network/security/credential/
  driver/service change, reboot, the first public push, and each build phase.
- **No silent paid fallback:** if a subscription nears its limit, work pauses and asks.
- No employment or outcome promises are implied by this project.

## Publication

Public repo (proposed `CollinCraig/precision-landing-lab`), Apache-2.0,
developed in the open from early on. The **first push** requires the
pre-publish checklist (see `milestones.md`) and Collin's approval; every
milestone after that gets a lighter re-check.
