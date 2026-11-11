<!-- DRAFT. Not published. Becomes the root README.md at first push (Collin approves). -->
# Precision Landing Lab: autonomous vertiport landing

> Built by one learner and a team of AI agents (Claude + Codex), with every result measured and reviewed.

A simulation-only lab where a small autonomous aircraft finds a rooftop **vertiport** pad, lands on it, or **safely aborts and goes around**. It is framed around Advanced Air Mobility (AAM). Nothing here flies real hardware.

<!-- TODO(M3): hero video / GIF of the presentation landing (chase camera + detection overlay) -->
![TODO hero GIF: landing with overlay](docs/media/hero.gif)

## Headline results

<!-- TODO: fill only with measured numbers from fixed evaluation seeds. Leave "not yet measured" until then. -->

| Metric | Target | Measured |
|---|---|---|
| Landing within 25 cm of pad center, calm, camera mode | 8 of 10 runs | not yet measured |
| Correct abort when the target is hidden | demonstrated | not yet measured |
| Success rate per AAM condition (lighting, pad offset, gusts, GPS noise, occupied pad) | report | not yet measured |

## What it does

- Runs ArduPilot SITL (copter), later in a Gazebo rooftop vertiport world, in an Ubuntu container.
- Python modules fly seeded scenarios, detect an AprilTag on the pad with a downward camera, estimate where the pad is, and guide ArduPilot's built-in precision landing with `LANDING_TARGET`.
- Decides to land or abort when the target is lost, low-confidence, or the pad is occupied.
- Writes each run to a directory with a manifest and result, checked by a small Rust validator (`plv`) that rejects incomplete runs and, in camera mode, any run that used ground truth.
- Produces reports, a results page and flight videos.

## Current status

**Planning / early M1.** Honest summary:

- Done: charter, decisions, milestone plan, container setup notes, a Rust structural run validator with synthetic tests, vertiport design research and a concept page.
- Not done: no flight has been run, no Gazebo world, no perception, no landing results. Every number above is a target, not a result.
- Milestones: M1 first flight (no 3D) → M2 vertiport world + camera → M3 find and land → M4 AAM conditions → M5 polish and release candidate. See [docs/milestones.md](docs/milestones.md).

## Architecture overview

![Architecture](docs/launch/architecture.svg) <!-- TODO: move to docs/architecture.svg at publish -->

Omarchy host → Ubuntu container → ArduPilot SITL (Gazebo from M2) → `lab/` Python modules → `runs/<run_id>/` → Rust validator → reports and viewer → T3 preview. Three modes keep the pieces separable: `truth` (guidance with a perfect estimate), `camera` (AprilTag on live frames, must not read truth) and `offline` (recorded frames scored against truth). Details: [docs/architecture.md](docs/architecture.md).

## How to run

<!-- TODO: every command below is a placeholder until M1 ships; replace with tested commands. -->

```bash
# TODO: create the container          (script not written yet)
# TODO: build ArduPilot SITL           (not written yet)
# TODO: run one scenario               e.g. python -m lab.run --scenario <name> --seed <n>
# TODO: validate the run               plv check runs/<run_id>
# TODO: open the replay viewer         (not written yet)
```

Requirements (planned): Linux, podman + distrobox, a few GB of disk, Rust toolchain for `plv`. Not yet tested on other systems.

## Roadmap

1. **M1** first flight, no 3D: takeoff, hold, land, validator, altitude plot.
2. **M2** Gazebo rooftop vertiport world, camera, offline tag detection.
3. **M3** camera-based precision landing, abort and go-around, results page, presentation video.
4. **M4** AAM conditions: lighting, pad offset, gusts (if supported), GPS noise, occupied pad.
5. **M5** polish and release candidate.
6. **Later, unscheduled:** VTOL (QuadPlane), simulated ADS-B traffic, multi-aircraft vertiport sequencing. Each needs its own decision first.

Non-goals: real hardware, training a flight controller, learned perception before the AprilTag baseline works.

## How this was built

One student (Collin) is learning autonomy by building this with an AI agent team. Agents build the infrastructure and presentation; Collin writes the core pieces himself, with skeletons, tests and hints from the agents but not the solutions. Important changes get an independent review from a model of the other provider. The decision log and milestone briefs are public in [docs/](docs/).

| Piece | Built by | Status |
|---|---|---|
| `mission.py`: takeoff / hold / land state machine (M1) | Collin | planned |
| AprilTag detection in recorded frames (M2) | Collin | planned |
| Frame conversions + `TargetEstimate` (M3) | Collin | planned |
| Abort / go-around logic, `safety.py` (M3) | Collin | planned |
| Container setup, SITL launch, run directory, Rust validator `plv` | Agents (Codex) | validator in repo; rest in progress |
| Gazebo vertiport world, `LANDING_TARGET` sender, evaluation runner | Agents | planned |
| Reports, results page, overlay video, design concept | Agents (Claude) | concept page in repo; rest planned |

Commits keep their `Co-Authored-By` lines. The table will be updated as pieces land and are reviewed.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). ArduPilot (GPL) is used over MAVLink and is not included here. Third-party assets and dependencies: see `THIRD_PARTY.md` <!-- TODO: create at publish from prepublish-dry-run.md section 6 -->.

This is a personal learning project. It makes no promises about outcomes or suitability for real aircraft.
