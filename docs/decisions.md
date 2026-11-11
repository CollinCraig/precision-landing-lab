# Decision Log

Format: ID · decision · why · status. Newest decisions are appended.
"Proposed" means an agent default Collin hasn't objected to; change any by asking.

## Resolved — 2026-11-10 planning interview

| ID | Decision | Why | Status |
|---|---|---|---|
| D-001 | Learning-first: agents build infrastructure, Collin owns 1–2 core pieces per milestone (~60/40). | Goal is understanding, not just a working demo. | Decided |
| D-002 | Starting point: comfortable with Python, new-ish to drones/MAVLink/frames. | Sizes the ramp: M1 mission script first, frames before vision. | Decided |
| D-003 | Collin's pieces are skeleton + failing tests + primer + hint ladder. | Real hands-on learning without blank-page stalls. | Decided |
| D-004 | Pieces split into 30–60 min steps with checkpoints; no fixed weekly rhythm. | Schedule varies week to week. | Decided |
| D-005 | Fresh start. No audit or import of `mac-drone-lab` (stays private, untouched). | Clean public history; learner writes core pieces fresh. Supersedes earlier "audit before import". | Decided |
| D-006 | Public, early, incremental development. First push gated by pre-publish checklist + Collin's approval. | Open-source intent without publishing unchecked work. | Decided |
| D-007 | License: Apache-2.0. | Permissive, patent clause, common in robotics. ArduPilot (GPL) is used over MAVLink, not vendored. | Decided |
| D-008 | Heavy sims run lid-shut on wall power only; light work on battery. | Thermal and battery safety. Lid-closed setup not done yet — M0 proposes it. | Decided |
| D-009 | Simulation stack lives in an Ubuntu container (distrobox/podman) on the laptop. | ArduPilot/Gazebo officially support Ubuntu; keeps Omarchy clean; rebuildable. Install needs approval. | Decided |
| D-010 | Every milestone ships a flight video. Small summaries in repo; videos/logs stay local (git-ignored); private demo page per milestone; Collin chooses which videos go public. | Remote review from MacBook/iPad without bloating or leaking. | Decided |
| D-011 | M3 success = within 25 cm of pad center, 8/10 tries, calm. Revisit after M2. | Achievable, measurable target; tighter/windy goals belong to M4. | Decided |
| D-012 | Two approval stops per milestone (brief at start, demo at end) plus fixed stops (installs/system changes, first public push, build phases). | Keeps work moving between Collin's sessions. | Decided |
| D-014 | AAM framing: "autonomous vertiport landing". | Real-world purpose; costs little in M0–M3. | Decided |
| D-015 | First-round upgrades: vertiport world (M2), presentation video with overlay (M3), abort/go-around (M3), AAM conditions (M4), results page per milestone. ~2–3 extra weeks overall. | Traction without delaying first flight; agents build most of it. | Decided |
| D-016 | VTOL/QuadPlane, simulated ADS-B traffic, multi-aircraft vertiport go to a post-M5 roadmap, planned over time. | Keeps first round finishable at 3–5 h/week. | Decided |
| D-017 | Audience: public/open source and school. | Shapes README/report tone: clear, honest, results-first. | Decided |
| D-018 | Public attribution: README leads with the AAM project and results, a one-line "built by one learner + AI agent team (Claude + Codex)" hook, and a "How this was built" section linking Collin's own pieces vs agent-built parts. Decision log and briefs stay public. Co-author lines kept on commits. | Honest, credible for school/public, makes Collin's pieces stand out. | Decided |
| D-019 | M0 accepted (2026-11-11) with noted gap: incomplete early command log. Approved: A1 (normal `omarchy-update` first, then `pacman -S --needed podman distrobox`, run by Collin), A2, A3, A7. Deferred: A4 (built as repo code in M1), A5/A6 (need a concrete service preview), A8/A9 (M2), A10 (after M1 runner). Findings: `nvidia-smi` works (no repair); AC lid policy already `ignore`. | Item-by-item approval per D-012. | Decided |
| D-020 | Side projects approved while usage is low (Claude 2% weekly at 2026-11-11): A vertiport realism research + design concept (now), B replay/live viewer via T3 preview (after M1 run format), C public launch kit drafts (no push), D roadmap feasibility spike (after M1 build). One at a time, off the M1 critical path. | Collin: "lets build this stuff, we have lots of usage." | Decided |
| D-021 | Use T3 built-ins per `docs/t3-integration.md`: preview tabs + recording for viewing and milestone videos (localhost only, no exposed ports), html_render for gate charts, usage caches at every gate. Scheduled tasks, optional desktop PC link and device panel need Collin's go-ahead. | Collin asked plans to use T3 features, incl. simulator link-up. | Decided |
| D-022 | Scheduled tasks approved: nightly fixed-seed regression + morning digest, created once the M1 runner is stable. optional desktop PC not linked (Collin games on it); laptop stays the only compute, and heavy M4 batches run overnight via scheduled tasks. Device panel optional, Collin's toggle. | Laptop (RTX 3060 6 GB) is enough for this lab's scale. | Decided |
| D-023 | Run side projects in parallel while Claude usage is low (2% weekly): B replay viewer (Sonnet, viewer/), C launch kit drafts (Sonnet, docs/launch/), E interactive explainers (Opus, learn/, no solutions to Collin's pieces). Each gets its own worktree and folder; Opus reviews before merge. D (roadmap spike) waits for the ArduPilot build to avoid CPU contention. | Collin: "barely scratched usage, work on in-depth side projects at the same time." | Decided |
| D-024 | Communication: all messages to Collin are in ASD-STE100. Repo text is a hybrid: STE for procedures, primers, hints, test steps and safety rules; normal technical English for the README intro, research notes and decision log. The README states that procedures follow ASD-STE100. | STE fits instructions and the aerospace theme; narrative text needs flexibility. | Decided |
| D-025 | Codex may continue on the ChatGPT account's paid credits if the Codex rate limit runs out. Agents report credit use at each gate; Collin is told when work switches to credits. This applies to Codex only; other paid fallbacks still need approval. | Collin, 2026-11-11. Usage is read with local/tools/usage.sh (codex app-server account/rateLimits/read). | Decided |
| D-026 | Graphics upgrade: the viewer gets a realistic city block (10–16 buildings, streets, PBR lighting, day/golden-hour/dusk, better drone, camera presets, low/high quality). The layout lives in viewer/scene/city.json, and the M2 Gazebo world reuses it so the viewer and the simulator show the same city. CC0 assets only, with a license list. | Collin: "improve the graphics a lot, real-world style, more than one building." | Decided |
| D-027 | Quality-first policy (usage is not the constraint: Claude 3%, Codex 4% weekly after a full day). Implementation workers run at **high** effort; reviews of important code (runner, guard, validator, exporter, viewer, world generator) run at **xhigh**, with **two reviews from different providers** (Claude + Codex). Visual work: Opus high, Opus accepts. Max 3 parallel side tracks. Collin's learning pieces stay protected (D-001, D-003): agents prepare deeper learning support, not solutions. | Collin: "higher quality on everything", "beefed up and more impressive". | Decided |
| D-028 | One fresh Sol coordinator thread per work package (e.g. G1 learning package; ArduPilot build + smoke flight; exporter + M1 demo), instead of one long-lived Sol for the whole milestone. Each coordinator writes a handoff file (local/<milestone>/handoff-<package>.md, 3 KB max) and stops; the next one reads only that file. Opus starts and tracks them. Starts after G1. | The long-lived Sol thread compacted about once a minute after 2 h, even with a 2.5 KB state file. | Decided |
| D-029 | Publication setup: (1) repo commits use the GitHub noreply email from now on (local git config); the existing history gets its author/committer email rewritten to the noreply address at a quiet point (no active workers), keeping full history. (2) Surname stays in NOTICE/charter. (3) The PC nickname is removed from docs. (4) Name `precision-landing-lab` for now; can change later. (5) gitleaks runs inside the Ubuntu container before every push. (6) Google Fonts stay. (7) First PUBLIC push at end of M1 after the pre-publish check; the GitHub repo may be created PRIVATE earlier for backup and CI, then switched to public at the M1 gate. | Collin's answers, 2026-11-11. | Decided |
| D-030 | Morrowdock/Marty: write an integration design note now (read-only on Morrowdock; GitHub read via gh, no Mac mini writes); build after M1, starting with a Morrowdock course-bundle export of the lab's check-yourself questions and MartyGraphics teaching visuals. Collin wants the projects to "come together more". | Collin's answer 2 (A and B). | Decided |
| D-031 | Changes D-029 item 7: the repo goes PUBLIC directly after the email-history rewrite (not at the end of M1), once the remaining pre-publish items pass: root README from the draft (honest status), THIRD_PARTY.md, gitleaks clean, hygiene CI clean, and Collin glances at the file list. Fits the early open-source intent. | Collin, 2026-11-11: "make public after rewrite." | Decided |
| D-032 | Ecosystem placement: the landing lab stays Collin's own project (`CollinCraig/precision-landing-lab`) and becomes the drone capstone that Morrowdock links to (course bundle, viewer, lessons). The Mac mini hover-capstone kit moves into the lab as early learning material (after review). Morrowdock brand/governance rules don't apply to the lab. | Collin, 2026-11-11, answer A. | Decided |
| D-033 | MartyGraphics (Fable 5.2 review), owner decision: C make CI gate merges; B narrow the pitch to "kinematically verified mechanism explainers"; A run a pre-registered blind benchmark (20 mechanism questions, MartyGraphics vs direct three.js codegen, all runs counted); feature freeze on new engine features until the benchmark result (bug fixes allowed); D is covered by the landing lab (Collin's self-written pieces, honest credits), with no separate Rust project now. Sent to the Mac mini coordinator, which owns that work. | Collin agreed with Opus's recommendation, 2026-11-11. | Decided |
| D-034 | Integration defaults (after M1): course ID `landing-lab` (tests use `landing-lab-trial`); exported question text CC BY 4.0; Collin runs Mac renders; evidence is a local file only. | Collin agreed, 2026-11-11. | Decided |
| D-035 | Morrowdock ecosystem: Collin approved the open-core "go" (core, cli, courses, server go public one repo at a time after gates), on-demand explainers phases A+B (no paid calls; phase C needs a budget proposal), coordinator defaults for the other no-cost decisions, and synthetic simulator screenshots. Items that need Collin personally come back as one checklist. Relayed to the Mac mini coordinator. | Collin, 2026-11-11: "I go for open core and all the rest too." | Decided |
| D-036 | Adopt the Fable 5.2 learning/framework review (local/reviews/fable-learning-framework-review.md). (1) Freeze landing-lab side projects until the owner's code flies (the running UI polish may finish). (2) Next package: SITL build, session 1 = manual MAVProxy flight replayed in the viewer, the exporter, the G1 rework (decoded messages, visible ACK/STATUSTEXT, safe print, step tags, scripts/learn, fake calibrated from a real tlog), a mastery gate, and a novice dry-run review. (3) Roadmap: just-in-time sessions, doing before reading. (4) Max 3 owner decisions per week, batched by Opus. (5) Publication: private GitHub repo now (backup + CI), PUBLIC at the M1 gate with the owner's first flight; this reverses D-031. Agent commits use an agent author identity; private other-project details leave the public log before launch; stale branches and worktrees are removed before the rewrite. (6) One cross-provider review for normal code; xhigh double review only for host-touching code (changes D-027). (7) Cut: MartyGraphics renders for the lab, the hover-kit import, extra runner/validator hardening, new viewer features before M3. | Collin, 2026-11-11: "a". The critical path was inverted: 0 owner lines, no flight. | Decided |
| D-037 | Owner time is not a planning constraint. Collin works when he can, sometimes much more and sometimes much less. Remove the 3–5 h/week assumption and the fixed weekly cap on decisions. Keep batching decisions (one message, recommended defaults), and keep the owner-first critical path (D-036), which is about authorship, not hours. Durations are guides, not deadlines. | Collin, 2026-11-11. | Decided |
| D-013 | Repo name `precision-landing-lab`. Local folder name may stay as-is. | Standard community term, discoverable. | Proposed (Collin leaning B) |

## Proposed defaults (no objection raised)

| ID | Default |
|---|---|
| P-001 | Rust run validator built in M1 by Sol; checks run outputs are complete/consistent and camera-mode runs contain no truth inputs. |
| P-002 | Notifications only in the planning T3 thread: approval needed or demo ready. |
| P-003 | Usage: rough "agent work" note per milestone report; Collin checks provider usage pages once per milestone. No automatic quota balancing exists; never a silent paid-API fallback. |
| P-004 | Cursor/Grok only on Collin's explicit request (billing unverified). |
| P-005 | GPU: read-only diagnosis in M0; simulation work isn't blocked on it until M2 camera rendering needs it. |

## Research inputs (context, not decisions)

- Vendor docs support: Opus planning/acceptance, Sol at default/medium effort for
  long-running code work, Sonnet routine UI with Opus visual acceptance,
  cross-provider review. Harness defaults may differ from vendor API defaults —
  calibrate on a small M0/M1 task.
- Grok via Cursor X research: inconclusive (no X access); no community consensus claimed.
- Gemini via Antigravity: blocked (ACP 1.4.5 server SIGKILL at init, cause unproven).

## Open questions

- Exact ArduPilot / Gazebo / Ubuntu versions and `LANDING_TARGET` precision-landing
  support on the pinned version (M0).
- Lid-closed sleep/power config and T3 Connect service install (M0 proposal, needs approval).
- Whether NVIDIA compute repair is worth it (M0 diagnosis).
- Touchdown speed and timeout thresholds (proposed in `architecture.md`).
- Demo page hosting/retention details and video retention policy.
- Gazebo wind support on the pinned version (before M4).
- Roadmap feasibility on pinned versions: QuadPlane precision landing, SITL ADS-B traffic simulation.
- GPU state decides vertiport/video visual fidelity (fallbacks: lighter visuals, optional desktop PC rendering).
