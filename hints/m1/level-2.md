# M1 hint level 2: Units and time

This file is optional. It contains no complete mission.

- Use a monotonic clock for elapsed time.
- Compare elapsed time with a total phase budget.
- Keep each receive timeout within the remaining budget.
- Treat `None` as missing telemetry, not as state confirmation.
- Convert `relative_alt` from millimetres to metres before a height comparison.
- Start the five-second hold only after the height reaches 4.75 metres.
- Continue to check telemetry during the hold.
- Keep the hold duration separate from the state wait budget.

Open `level-3.md` only if you want protocol details.
