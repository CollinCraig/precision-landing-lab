# API reference

This page lists names and meanings. It does not show how to use them.
You design each state. The primer and the hint files give the ideas.

## `ap` (the autopilot link)

| Name | Meaning |
|---|---|
| `ap.receive(message_type=None, timeout=1.0)` | Return the next decoded message. Return `None` when `timeout` seconds pass. With a type name, the call skips other types and keeps them in `ap.latest`. |
| `ap.send_command(command, *params)` | Send COMMAND_LONG. You give up to seven numbers (param1 to param7). A missing number is 0. |
| `ap.set_mode(custom_mode)` | Send SET_MODE with an ArduCopter mode number. |
| `ap.request_interval(message_type, hz)` | Ask the autopilot to send one message type `hz` times each second. |
| `ap.phase(name)` | Record that your code enters a state. Use the state names from `mission.py`. |
| `ap.succeed()` | Report success. This ends the mission result. |
| `ap.fail(code, detail)` | Report failure. This ends the mission result. See "Failure codes". |
| `ap.log(*parts)` | Print one line with the elapsed time to `mission.stderr`. `print()` also works. |
| `ap.latest` | A dictionary. A message type name gives the last message of that type. |
| `ap.acks` | A list of every COMMAND_ACK that your code received. The oldest is first. |
| `ap.texts` | A list of every STATUSTEXT that your code received. The oldest is first. |
| `ap.clock()` | The clock of the link. It is `time.monotonic` in a normal run. |

A send call is a request. The reply is a later message.
A message that the autopilot sent before your call can still arrive after your call.

## A message

| Name | Meaning |
|---|---|
| `message.type` | The message type name, for example `"HEARTBEAT"`. |
| `message.fields` | A dictionary. A field name gives the raw value. |
| `message.<field>` | A short way to read one field. `message.fields["relative_alt"]` and `message.relative_alt` give the same value. |
| `message.pretty()` | One readable line with names and units. |
| `message.sysid`, `message.compid` | The system and component number of the sender. |

The values are raw. The autopilot uses its own units. Convert them yourself.

## Message types and fields

| Type | Fields |
|---|---|
| `HEARTBEAT` | `custom_mode`, `type`, `autopilot`, `base_mode`, `system_status`, `mavlink_version` |
| `SYS_STATUS` | `sensors_present`, `sensors_enabled`, `sensors_health`, `load`, `voltage_battery`, `current_battery`, `drop_rate_comm`, `errors_comm`, `errors_count1` to `errors_count4`, `battery_remaining` |
| `GPS_RAW_INT` | `time_usec`, `lat`, `lon`, `alt`, `eph`, `epv`, `vel`, `cog`, `fix_type`, `satellites_visible` |
| `GLOBAL_POSITION_INT` | `time_boot_ms`, `lat`, `lon`, `alt`, `relative_alt`, `vx`, `vy`, `vz`, `hdg` |
| `COMMAND_ACK` | `command`, `result`, `progress`, `result_param2`, `target_system`, `target_component` |
| `EKF_STATUS_REPORT` | `velocity_variance`, `pos_horiz_variance`, `pos_vert_variance`, `compass_variance`, `terrain_alt_variance`, `flags`, `airspeed_variance` |
| `STATUSTEXT` | `severity`, `text`, `id`, `chunk_seq` |

## Field meanings

| Field | Meaning |
|---|---|
| `HEARTBEAT.custom_mode` | The flight mode number of ArduCopter. |
| `HEARTBEAT.base_mode` | A bit field. One bit is the armed bit (`mavlite.BASE_MODE_ARMED`). |
| `HEARTBEAT.system_status` | The state that the autopilot reports. 3 is STANDBY. 4 is ACTIVE. |
| `GPS_RAW_INT.fix_type` | The GPS fix. 3 or more is a 3D fix. |
| `EKF_STATUS_REPORT.flags` | A bit field. One bit is the horizontal position bit (`mavlite.EKF_POS_HORIZ_ABS`). |
| `GLOBAL_POSITION_INT.relative_alt` | The height above the home point, in millimetres. |
| `GLOBAL_POSITION_INT.alt` | The height above mean sea level, in millimetres. |
| `COMMAND_ACK.command` | The command number that the ACK answers. |
| `COMMAND_ACK.result` | 0 is ACCEPTED. Other values are in `mavlite.RESULT_NAMES`. |
| `STATUSTEXT.text` | A line of text from the autopilot. It often gives the reason for a refusal. |
| `STATUSTEXT.severity` | A number from 0 (emergency) to 7 (debug). A smaller number is more serious. |

## Names for numbers (`mavlite`)

You import them with `from lab import mavlite`. They are names, not logic.

| Name | Value | Meaning |
|---|---|---|
| `mavlite.CMD_COMPONENT_ARM_DISARM` | 400 | Command: arm or disarm. Parameter 1 is 1 to arm and 0 to disarm. |
| `mavlite.CMD_NAV_TAKEOFF` | 22 | Command: take off. Parameter 7 is the target height in metres. |
| `mavlite.CMD_NAV_LAND` | 21 | Command: land at the current position. |
| `mavlite.CMD_DO_SET_MODE` | 176 | Command: set a mode. |
| `mavlite.CMD_SET_MESSAGE_INTERVAL` | 511 | Command: set the rate of a message. `ap.request_interval` sends it. |
| `mavlite.MODE_GUIDED` | 4 | The ArduCopter mode number for GUIDED. |
| `mavlite.MODE_LAND` | 9 | The ArduCopter mode number for LAND. |
| `mavlite.BASE_MODE_ARMED` | 128 | A value, not a bit number. The armed bit of `HEARTBEAT.base_mode`. The bit number is 7. |
| `mavlite.EKF_POS_HORIZ_ABS` | 16 | A value, not a bit number. The horizontal position bit of `EKF_STATUS_REPORT.flags`. The bit number is 4. |
| `mavlite.RESULT_NAMES` | a dictionary | The name of each ACK result number. |
| `mavlite.MSGID` | a dictionary | The number of each message type name. |

## `budgets`

The platform gives one time limit, in seconds, for each wait.
The values depend on the profile. The step tests use the profile `fake`.
A flight in SITL uses the profile `sitl`.

| Name | `fake` | `sitl` | Meaning |
|---|---|---|---|
| `budgets.connect_s` | 2 | 10 | The longest wait for the autopilot to appear. |
| `budgets.ready_s` | 2 | 120 | The longest wait until the autopilot can arm. |
| `budgets.guided_s` | 2 | 10 | The longest wait for the mode change. |
| `budgets.arm_s` | 2 | 10 | The longest wait for the arm. |
| `budgets.takeoff_s` | 2 | 10 | The longest wait for the takeoff request to take effect. |
| `budgets.climb_s` | 2 | 20 | The longest wait for the climb to the target height. |
| `budgets.hold_s` | 5 | 5 | The time to stay at height. It is not a limit. It is a duration. |
| `budgets.telemetry_gap_s` | 1 | 3 | The longest silence that you accept while you hold. A longer silence is a failure. |
| `budgets.disarm_s` | 2 | 40 | The longest wait for the motors to stop after the landing request. |

## Failure codes (`ap.fail`)

`ap.fail` accepts only these codes. Another code raises a `ValueError` that lists them.
Put the state name in the `detail` text.

| Code | Meaning |
|---|---|
| `timeout` | A wait ended and the proof did not arrive. |
| `readiness_failed` | The autopilot did not become ready to arm. |
| `command_rejected` | The autopilot refused a command. |
| `connection_failed` | The autopilot never appeared. |
| `mission_exception` | Your code found an error that is not one of the other four. |

## The fake autopilot and its faults

The step tests use the fake autopilot. Run your mission against it yourself with one fault:

    ./learn fake --fault <name>

The command prints the same lines as `mission.stderr`. It then prints the result.
With no `--fault` the fake has no fault. The command saves the run in `local/last-run/fake`.

| Fault | What the fake does |
|---|---|
| `no_heartbeat` | It sends no message at all. |
| `not_ready` | GPS and the EKF never become ready. |
| `mode_stuck` | It never enters the mode that you request. |
| `arm_stuck` | It sends an ACK result 0 for the arm command. It does not arm. |
| `arm_denied` | It refuses the arm command. It sends a STATUSTEXT with the reason, then an ACK with result 4. |
| `climb_stuck` | The height stays at 0 after the takeoff request. |
| `telemetry_lost` | All messages stop after the takeoff request. No ACK arrives. |
| `telemetry_lost_hold` | All messages stop one second after the height is reached. |
| `disarm_stuck` | The motors stay armed after the landing. |
