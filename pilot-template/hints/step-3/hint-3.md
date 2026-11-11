# Step 3, hint 3: fields

This file is optional. It gives field references, not a working state.

| Item | Reference |
|---|---|
| Takeoff request | `ap.send_command(mavlite.CMD_NAV_TAKEOFF, ...)`. The target height is parameter 7, in metres. |
| Takeoff ACK | `COMMAND_ACK` with `command` 22. |
| Height | `GLOBAL_POSITION_INT.relative_alt`, in millimetres, above the home point. |
| Hold time | `budgets.hold_s` (5 seconds). |

- Parameters 1 to 6 of the takeoff request are 0 in this mission.
- Report `timeout` with the state name CLIMB when the height does not arrive.

Write the number of the highest hint file that you opened in the column "Hint file" of `progress.md`. All hint files are help level 2.
