# M1 hint level 3: MAVLink fields

This file is optional. It contains field references, not a working mission.

| Item | Reference |
| --- | --- |
| Heartbeat mode | `custom_mode`; ArduCopter GUIDED has value 4. |
| Heartbeat armed state | `base_mode` includes `MAV_MODE_FLAG_SAFETY_ARMED`, value 128. |
| Fake readiness | `system_status` has value 3 or 4. |
| Arm request | `MAV_CMD_COMPONENT_ARM_DISARM`, value 400. |
| Takeoff request | `MAV_CMD_NAV_TAKEOFF`, value 22; target height uses parameter 7. |
| Land request | `MAV_CMD_NAV_LAND`, value 21; LAND mode also works with the fake. |
| Mode request | SET_MODE or `MAV_CMD_DO_SET_MODE`, value 176. |
| Target identity | The runner accepts telemetry from system 1, component 1. |

- Confirm mode and arm changes with later heartbeat data.
- Use named MAVLink constants when your codec supplies them.
- Report a timeout with its phase name in the failure detail.
- Do not report success before disarm confirmation.

Real readiness checks depend on the connected build. The fake's readiness check is not a complete pre-arm safety check.
