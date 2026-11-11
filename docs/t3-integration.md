# T3 integration plan

How the lab uses T3's built-in features. Status per item: **in use**, **planned**
(with the milestone), or **needs Collin** (a toggle or approval first).

| T3 feature | What it gives the lab | When | Status |
|---|---|---|---|
| Threads + `delegate_task` + worktrees | Planner (Opus) ↔ Sol coordinator; a fresh worker and reviewer per task, each in its own checkout | M0+ | **in use** |
| Cross-provider review | Claude reviews Sol code and vice versa | M1+ | **in use** |
| Usage limits (`~/.t3/caches/*.json`) | Real weekly/monthly usage % for Claude and Cursor, checked at every gate. Codex isn't exposed: check ChatGPT Usage settings | M1+ | **in use** |
| **Preview tabs** (`environment-port`) | Open a page served on the laptop inside T3, viewable from the MacBook/iPad over Connect, **without exposing ports**. This is how live viewing works | M1 (replay viewer), M2+ (live) | planned |
| **Preview recording** | Record the replay/live viewer straight to video: the milestone videos come from this | M1 demo onward | planned |
| `html_render` inline pages | Results charts (landing error, success rate, temps, usage) shown inline at each gate | M1 demo onward | planned |
| Claude artifacts (private pages) | Demo pages and design concepts to browse on the iPad; shareable later by choice | Side project A, every demo | planned |
| Attachments | Screenshots and clips sent between threads for review | M2+ | planned |
| **Scheduled tasks** | Nightly fixed-seed regression run + a short morning digest; weekly usage check | After M1 (needs a stable runner) | needs Collin |
| **Linked environments** (StarkPC) | Send heavy work (Gazebo rendering, M4 batch evaluation) to the RTX 3080 via `delegate_task` on that machine | M2/M4, if laptop is too slow | needs Collin (link StarkPC) |
| Device panel (iOS/Android simulators) | Check that the demo pages and dashboard work at iPad/phone size | Optional | needs Collin (Settings → Integrations → Devices) |
| PR linking / watching | PR-based reviews once the public GitHub repo exists | After first push | planned |

## Live 3D viewing (the simulator link-up)

Gazebo itself is a desktop app. To see the sim from the MacBook/iPad:

1. **M1: replay viewer.** A small local web page (served on localhost in the
   container) replays any saved run: altitude, mode and state timeline, with a
   simple 3D drone/pad view. Opened in a T3 preview tab, recorded with preview
   recording into the milestone video.
2. **M2+: live view.** The same viewer subscribes to live telemetry while a run
   is flying (MAVLink → small websocket bridge on localhost). Optionally
   evaluate Gazebo's own websocket/web-client support on the pinned Harmonic
   version (UNVERIFIED).

Everything binds to localhost only. T3 Connect does the remote part; no
firewall or port changes.
