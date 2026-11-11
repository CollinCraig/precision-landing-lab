# Step 1, hint 3: design help

This file is optional. It gives design help, not names. The names are in `API.md`.

- The real flight gave these times. The EKF said "is using GPS" at 36.6 seconds. The arm command worked 3 seconds later.
- The real flight waited 3 more seconds after the EKF text. Decide yourself if you need a pause.
- The fake autopilot becomes ready after less than 1 second. It sends the same signs as the real one.
- Question: Two messages can show readiness. Do you need one of them, or both? Why?
- Question: What does your code do when the limit ends? Which failure code fits? See `API.md`.
- Put the state name in the failure detail.

Write the number of the highest hint file that you opened in the column "Hint file" of `progress.md`. All hint files are help level 2.
