# Agent-team log

This log records how the AI agent team performs on platform tasks (D-043).
It is evidence for the "directed an AI agent team" claim, with failures included.
Each row is one task. "Rounds" counts review rounds until the reviewer said PASS.

| Date | Task | Builder | Reviewer(s) | Rounds | Defects caught by review | Notes |
|---|---|---|---|---|---|---|
| 2026-11-11 | P2 SITL launcher + lock | Claude Sonnet 5.5 | Claude Opus 5.5 (high), Codex Sol (high) | 1 | 1 medium network exposure (all interfaces), 3 medium launcher defects, 7 low | First Codex review lost to a compaction loop (cause: ~229k tokens of connector tool schemas; fixed by turning off Codex apps) |
| 2026-11-11 | P2-a first SITL flight | Claude Sonnet 5.5 | — | — | — | Attempt 1 failed (arm denied: no position estimate); attempt 2 passed |
| 2026-11-11 | P2 tlog exporter + replay | Claude Sonnet 5.5 | Codex Sol (high, then xhigh ×2) | 3 | 1 high (result.json overwrite), 8 medium (parser, JSON, verdict label), 1 low | Final fix: CRC check of every frame |
| 2026-11-11 | P2 learner package rework | Claude Sonnet 5.5; last fix by Claude Opus 5.5 | Codex Sol (high, then xhigh ×2) | 4 | 5 high (solution leak ×2, repo separation, git identity, exercise), 7 medium, 2 low | Planner deleted an agent-written reference solution and moved a flight driver out of the project |
| 2026-11-11 | P2 novice dry run + friction fixes | Claude Sonnet 5.5 | Codex Sol (high) | 1 | 2 low (passive voice) | Worker stopped at the /tmp RAM-disk quota; planner finished tests |
