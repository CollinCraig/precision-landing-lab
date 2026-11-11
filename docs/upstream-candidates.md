# Upstream candidates

This log lists problems that the lab found in upstream projects (ArduPilot, MAVProxy, pymavlink, Gazebo).
Agents add rows. The owner picks a row and writes the fix and the pull request himself (D-045).

| Date | Project | Problem | How the lab found it | Status |
|---|---|---|---|---|
| 2026-10-25 | ArduPilot autotest | `assert_mission_files_same` crashes when it compares equal LAND items with `nan` and `NaN` yaw (`int(float(...))` on NaN). | Testing for pymavlink PR #1321 | Open. Owner reproduces it in lab SITL after Dec 4. |
| 2026-11-11 | pymavlink #1321 | Waypoint files write NaN in a spelling that Mission Planner does not read. | Owner's earlier work | PR open, waiting for the owner's next comment. |
