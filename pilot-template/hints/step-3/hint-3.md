# Step 3, hint 3: design help

This file is optional. It gives design help, not names. The names are in `API.md`.

- Parameters 1 to 6 of the takeoff request are 0 in this mission.
- The test "telemetry stops after takeoff" sends no ACK and no other message. Run `./learn fake --fault telemetry_lost` to see it.
- Question: Where does your code wait for the ACK? What happens in that state when nothing arrives?
- The test accepts a failure in TAKEOFF or in CLIMB. The detail must name the state that failed.
- The takeoff limit, the climb limit, the hold time and the silence limit are four different numbers. See `budgets` in `API.md`.
- Question: In HOLD, how long may the telemetry be silent? Which `budgets` name gives the limit?

Write the number of the highest hint file that you opened in the column "Hint file" of `progress.md`. All hint files are help level 2.
