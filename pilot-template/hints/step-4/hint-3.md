# Step 4, hint 3: design help

This file is optional. It gives design help, not names. The names are in `API.md`.

- Question: One landing request is a command. The other is a mode change. Which proof follows each one?
- Question: An armed heartbeat can arrive after the landing request. How do you know that a heartbeat is new?
- Report success only after the disarm proof.
- Put the state name WAIT_DISARM in the failure detail when the limit ends.

Write the number of the highest hint file that you opened in the column "Hint file" of `progress.md`. All hint files are help level 2.
