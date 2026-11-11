# Step 3, hint 2: units and time

This file is optional. It gives no code.

- Use `time.monotonic()` for elapsed time. It does not jump when the system clock changes.
- Compare elapsed time with the total budget. Keep each receive timeout inside the remaining budget.
- A receive that returns `None` means: no message. It does not mean: state confirmed.
- Convert `relative_alt` from millimetres to metres before you compare.
- Start the 5 second hold only after the height reaches 4.75 m.
- Keep reading telemetry during the hold. Question: What if it stops?
- The hold time is separate from the climb limit.

Open `hint-3.md` only if you want the field names.

Write the number of the highest hint file that you opened in the column "Hint file" of `progress.md`. All hint files are help level 2.
