# Step 4, hint 2: time and proof

This file is optional. It gives no code.

- The autopilot disarms by itself after it lands. Your code waits for the proof.
- The proof is a heartbeat with the armed bit cleared.
- A landing from 5 m took 13 seconds in the real flight. The fake is much faster.
- Use the budget `budgets.disarm_s`. It is different for the fake and for SITL.
- After a landing request, the old armed heartbeats still arrive. Question: How do you not confuse them with a disarm?

Open `hint-3.md` only if you want the field names.
