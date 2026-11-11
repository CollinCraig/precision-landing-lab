# Mastery gate (M1)

Procedures in this repository follow ASD-STE100 Simplified Technical English.

Passing tests does not show understanding. A tutor agent is available, so tests alone are not enough (review A-06).
The M1 gate has five parts. The gate takes 45 minutes at most. Do it after the first SITL flight of your code (session 6).

## What "explain each state transition" means

For each of the nine transitions you explain five facts. You write them in `notes/m1.md` in your own words.

1. The request: which command or mode request leaves the state.
2. The proof: which message and which field show that the new state is true.
3. The difference: why the ACK alone is not the proof.
4. The limit: the time limit for the wait and the reason for its size.
5. The failure: which failure code you report when the limit ends, and what the detail says.

Two transitions need more:

- WAIT_READY: explain why a STANDBY heartbeat is not enough. Name the facts that the real autopilot needed.
- HOLD: explain which clock you use and what you do when telemetry stops.

## The five parts

| Part | What you do | Pass rule |
|---|---|---|
| 1. Explain-back | Fill in `notes/m1.md`: the state diagram and the transition table. No agent edits it. | All rows are filled in with your own words. The checker finds no row that only repeats the hints. |
| 2. Predict, then run | The checker sets two faults in the fake. Before the run, you write which state fails and which failure code you report. | At least one of two predictions is exact. For the other, you explain the difference. |
| 3. Transfer | One change with no tests and no hints: for example "hold at 5 m, climb to 8 m, hold 3 s, land". You write the change and one test for it. | The change works on the fake. Your test fails when you break the change. |
| 4. Cold recall | One week later you answer three questions without your code open. | Two of three answers are correct. |
| 5. Help record | `progress.md` shows the highest help level (0 to 3) for each step. | The record is complete. The level is information. It is not a grade. |

## Who checks

- Collin is the author of all written answers.
- The checker is a tutor agent that did not write the starter code and the hints. A fresh agent session is enough.
- The checker follows `docs/learning/tutor.md`. It asks the questions in the table. It writes down the result only: pass or not yet, and the help levels. It does not correct the notes.
- Collin decides when to try again. "Not yet" has no penalty. The checker names the one part to repeat.
- A "not yet" in part 4 uses the same questions with different numbers after one more week.

The result goes in `progress.md` and in the milestone report. The report states the ratio of owner steps finished to agent lines merged (review A-12).

## Cold recall questions (part 4)

Use three of these. The checker changes the numbers.

1. Your code sends an arm command. The ACK result is 4. What do you see next? What does your code do?
2. The heartbeat says STANDBY. Why can the autopilot still refuse to arm?
3. Telemetry stops for 3 seconds in HOLD. What happens in your code? Why?
4. Why does each state have its own time limit?
5. Why do you test the height with a band and not with exactly 5.0 m?
