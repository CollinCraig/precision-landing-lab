# Step 2, hint 2: ACK and state

This file is optional. It gives no code.

- Read the `[ack]` lines. Compare ACK `command` and `result` with the number you sent.
- An accepted ACK and a changed state are two different events. The fake can accept the arm command and still not arm. Your code must see this.
- A refused arm gives a result that is not 0 and a STATUSTEXT line. You can stop early when you see a refusal.
- Look at the heartbeat for the proof. Use a later heartbeat, not the one from before your request.
- Each state has its own time limit: `budgets.guided_s` and `budgets.arm_s`.

Open `hint-3.md` only if you want the field names.

Write the number of the highest hint file that you opened in the column "Hint file" of `progress.md`. All hint files are help level 2.
