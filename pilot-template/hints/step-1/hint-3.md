# Step 1, hint 3: fields

This file is optional. It gives field references, not a working state.

| Item | Reference |
|---|---|
| GPS fix | `GPS_RAW_INT.fix_type`. A value of 3 or more is a 3D fix. |
| EKF position | `EKF_STATUS_REPORT.flags`. Bit 16 (`mavlite.EKF_POS_HORIZ_ABS`) means: horizontal position from GPS. |
| EKF text | STATUSTEXT with the words `is using GPS`. |
| Refused arm | ACK result 4 (FAILED) and STATUSTEXT `Arm: Need Position Estimate`. |

- In the real flight, the EKF said "is using GPS" at 36.6 seconds. The arm command worked 3 seconds later.
- The real flight waited 3 more seconds after the EKF text. Decide yourself if you need a pause.
- The fake autopilot becomes ready after less than 1 second. It sends the same signs as the real one.
- Report `readiness_failed` or `timeout` when the limit ends. Put the state name in the detail.

Write the number of the highest hint file that you opened in the column "Hint file" of `progress.md`. All hint files are help level 2.
