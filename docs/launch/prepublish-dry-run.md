# Pre-publish dry run

Read-only check of the checklist in `docs/milestones.md` against the repo at branch `t3/931dd996` (base commit `83bd0de`; 88 commits across all refs). Date: 2026-11-11. Nothing outside `docs/launch/` was changed. Secret scan used grep patterns only (no gitleaks installed). No secret values appear below.

## Summary: 3 PASS · 1 FAIL · 5 TODO

| # | Checklist item | Result |
|---|---|---|
| 1 | Secret scan clean | PASS (pattern-only) |
| 2 | No personal info | **FAIL** |
| 3 | LICENSE + NOTICE present | PASS |
| 4 | Third-party assets listed with licenses | TODO |
| 5 | Dependencies listed with licenses | TODO |
| 6 | `runs/`, videos, logs not committed | PASS |
| 7 | README accurate | TODO |
| 8 | "How this was built" matches reality | TODO |
| 9 | Collin reviewed file list and history | TODO |

## Evidence

**1. Secret scan: PASS (limited).** Patterns: AWS `AKIA…`, GitHub `ghp_/gho_/github_pat_`, `sk-`/`sk-ant-`, Slack `xox*-`, Google `AIza…`, PEM `BEGIN … PRIVATE KEY`, and `key|secret|password|token = "<8+ chars>"`. Ran on tracked files (`git grep`) and on all history (`git log -p --all -G`): 0 hits in both. Never-tracked-names check over all history (`.env`, `*.pem`, `*.key`, `id_rsa`, `credential*`, `.tlog`, `.bin`, `.mp4`, `local/`, `runs/`): 0 hits. Caveat: grep patterns miss high-entropy or oddly formatted secrets. Run gitleaks or trufflehog inside the container before the first push if Collin approves an install.

**2. Personal info: FAIL.** Findings:
- F1. `docs/m1-container-setup.md` (7 lines: 17, 35, 46, 77, 89, 91, 110) contains the absolute home path including the OS username, plus a worktree path and a path to the private `local/m1/` evidence directory. History: the same file was added in commit `9977aa2`, so a plain edit still leaves it in history.
- F2. Git author/committer email on 20 commits is Collin's personal email (the other 68 commits use the T3 Code noreply address). It would be public after a push. Options: rewrite with a GitHub noreply address, or accept it knowingly. Collin decides.
- F3 (minor). The nickname a PC nickname (now removed) appears in `charter.md`, `decisions.md`, `milestones.md`, `t3-integration.md`. It is a machine nickname, not a hostname or IP; likely fine, flagged for review.
- No hits for: email addresses in file contents, non-loopback IPs, `.local`/`.ts.net`/tailscale names, `/Users/` paths. `127.0.0.1` in the primer is loopback and fine.
- Surname appears in `LICENSE`-adjacent `NOTICE` and `charter.md` ("Collin Craig"). The launch brief limits personal info to first name in the README only; NOTICE and charter are Collin's call. Flag for decision.
- Commit messages: no paths or emails found outside `Co-Authored-By` trailers (21 trailers).

**3. LICENSE / NOTICE: PASS.** `LICENSE` is 202 lines, Apache License 2.0 header present, sha256 prefix `cfc7749b96f63bd3` (compare to the official text at publish; not fetched here). `NOTICE` present, states ArduPilot is external and not relicensed. `validator/Cargo.toml` declares `license = "Apache-2.0"`.

**4. Third-party assets: TODO.** No `THIRD_PARTY.md` yet. Current list (see below). Nothing is vendored yet; M2 will add Gazebo models, textures and tag images and must be added then.

**5. Dependencies and licenses: TODO.** List below; licenses for runtime/toolchain items to be confirmed from upstream at publish. Rust crate `plv` has no external crates (`Cargo.lock` lists only `plv`).

**6. Runs/videos/logs: PASS.** `git check-ignore` confirms `local/`, `runs/`, `*.tlog`, `*.mp4`, `*.bin`, `.env` are ignored. Tracked files under `local/` or `runs/`: 0.

**7–9. TODO.** `README.draft.md` exists but is unreviewed; the build-attribution table needs Collin's check; the exact file list/history review happens at push time (suggest `git ls-files` and `git log --stat` printout).

## Third-party list (current and expected)

| Item | Where | Status | License (to confirm) |
|---|---|---|---|
| Apache-2.0 license text | `LICENSE` | in repo | Apache-2.0 |
| IBM Plex Sans / Mono web fonts | `design/vertiport-concept.html` loads them from Google Fonts at view time (not vendored) | in repo (link) | SIL OFL 1.1. Note: loading from Google sends viewer requests to Google; consider self-hosting or system fonts |
| AprilTag marking | drawn inline in the design page; the family named is "36h11" | in repo (original drawing) | AprilTag library BSD-2-Clause; tag images from the AprilRobotics repo |
| FAA EB 105 / EASA vertiport guidance | cited in `docs/research/vertiport-design.md` and design page | references only | public documents; cite, don't copy text |
| ArduPilot (ArduCopter SITL) | runtime in container | external, not vendored | GPL-3.0 |
| MAVLink / pymavlink | runtime | planned | LGPL-3.0 (pymavlink) |
| Gazebo (Harmonic) + ardupilot_gazebo plugin | M2 | planned | Apache-2.0 / GPL-3.0 (plugin) |
| OpenCV, AprilTag Python bindings | M2 | planned | Apache-2.0 / BSD |
| Ubuntu 24.04 base image (pinned digest) | `docs/m1-container-setup.md` | external | various, distribution terms |
| podman, distrobox | host tools | external | Apache-2.0 / GPL-3.0 |
| Rust toolchain 1.75 (Ubuntu package) | validator build | external | MIT/Apache-2.0 |
| Vertiport world models/textures | M2 | not yet added | track each asset's license on import |

## Before first push

1. Decide F1: redact paths in `docs/m1-container-setup.md` and history (history rewrite or a squashed first push; Collin approves).
2. Decide F2: author email policy.
3. Run a real secret scanner (needs install approval).
4. Create `THIRD_PARTY.md` and finish items 4–9.
