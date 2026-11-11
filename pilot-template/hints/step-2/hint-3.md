# Step 2, hint 3: fields

This file is optional. It gives field references, not a working state.

| Item | Reference |
|---|---|
| Mode request | `ap.set_mode(value)`. ArduCopter GUIDED is `mavlite.MODE_GUIDED` (value 4). |
| Mode proof | `HEARTBEAT.custom_mode` |
| Arm request | `ap.send_command(mavlite.CMD_COMPONENT_ARM_DISARM, 1)`. Parameter 1 is 1 to arm. |
| Arm proof | `HEARTBEAT.base_mode` has the bit `mavlite.BASE_MODE_ARMED` (value 128). |
| ACK result | `COMMAND_ACK.result`. 0 is ACCEPTED. `mavlite.RESULT_NAMES` lists the names. |

- Use failure code `command_rejected` for a refusal. Use `timeout` when nothing happens.

Write the number of the highest hint file that you opened in the column "Hint file" of `progress.md`. All hint files are help level 2.
