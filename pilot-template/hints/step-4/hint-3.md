# Step 4, hint 3: fields

This file is optional. It gives field references, not a working state.

| Item | Reference |
|---|---|
| Land request, way 1 | `ap.send_command(mavlite.CMD_NAV_LAND)` |
| Land request, way 2 | `ap.set_mode(mavlite.MODE_LAND)` (value 9) |
| Disarm proof | `HEARTBEAT.base_mode` without the bit `mavlite.BASE_MODE_ARMED`. |

- Report success with `ap.succeed()` only after the disarm proof.
- Report `timeout` with the state name WAIT_DISARM when the limit ends.
