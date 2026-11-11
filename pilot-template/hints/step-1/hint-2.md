# Step 1, hint 2: where to look

This file is optional. It gives no code.

- The autopilot needs a position estimate before it allows arming in GUIDED.
- The position estimate comes from GPS and the EKF.
- `ap.receive()` returns GPS_RAW_INT and EKF_STATUS_REPORT messages. Print them with `message.pretty()`.
- Watch the `[text]` lines. STATUSTEXT tells you when the EKF starts to use the GPS.
- A SYS_STATUS pre-arm bit alone was not enough in the real flight. The autopilot still refused to arm.
- If a message type does not arrive, ask the autopilot for it. See `ap.request_interval()`.
- Give WAIT_READY its own time limit: `budgets.ready_s`. The real SITL needed about 40 seconds.

Open `hint-3.md` only if you want the field names.

Write the number of the highest hint file that you opened in the column "Hint file" of `progress.md`. All hint files are help level 2.
