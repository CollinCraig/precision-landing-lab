# Session 1: fly by hand and replay

You type the flight commands yourself. You write no code. You read the ACK and STATUSTEXT lines.
Get approval before you start SITL. Keep the computer on wall power.
The platform repository holds the tools. Its path is in `.platform-path`. Run the platform commands from its root folder.

## Start SITL

1. Enter the container: `distrobox enter landing-lab`.
2. Go to the platform repository.
3. Start SITL: `scripts/sitl-up`. Keep this terminal open.
4. Open a second terminal in the container.
5. Connect MAVProxy: `mavproxy.py --master=udpin:127.0.0.1:14550`.

The platform file `docs/sitl-up.md` explains the options.

## Fly by hand

Type each command in the MAVProxy terminal. Read the reply after each one.

1. Type `mode guided`.
2. Type `arm throttle`. Try it at once, before the GPS is ready. Read the refusal and its reason.
3. Wait. Type `arm throttle` again when the autopilot accepts it.
4. Type `takeoff 5`. Wait until the aircraft is at 5 m.
5. Wait 5 seconds. Then type `mode land`.
6. Stop MAVProxy with Ctrl-C when the motors stop. Stop SITL with Ctrl-C.

Check that you can say these facts:

- An ACK does not prove that the motors run.
- The heartbeat said STANDBY before the arm worked.

## Replay the flight

1. Find the file `flight.tlog` in the MAVProxy log folder.
2. In the platform repository, run: `python3 -m lab.export_tlog <tlog> local/session1 --run-id session1`.
3. Check that the printed `samples` is not 0. Check that `skipped_bytes` is 0.
4. Link or copy `local/session1` to `runs/session1`.
5. Start the viewer server: `viewer/serve.sh`.
6. Open `http://127.0.0.1:8765/viewer/index.html?run=../runs/session1` in a browser.
7. Press Play. Watch the events on the timeline.
8. Stop the server with Ctrl-C.

The platform file `docs/export-flight.md` explains the options.

## Finish

Add one row to `progress.md`. Then start session 2 with `./learn listen`.
