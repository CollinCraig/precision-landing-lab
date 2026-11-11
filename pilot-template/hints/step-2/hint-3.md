# Step 2, hint 3: design help

This file is optional. It gives design help, not names. The names are in `API.md`.

- Three events are different: your request, the ACK and the state change.
- Question: Which heartbeat counts as proof? One from before your request, or one from after it?
- Question: A refusal and a silence are different faults. Which failure code fits each? See `API.md`.
- Run `./learn fake --fault arm_denied`. Read the lines before the ACK. They give the reason.
- Put the state name in the failure detail.

Write the number of the highest hint file that you opened in the column "Hint file" of `progress.md`. All hint files are help level 2.
