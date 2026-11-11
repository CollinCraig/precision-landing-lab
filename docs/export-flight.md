# Export a flight and replay it

Use `lab/export_tlog.py` to convert a MAVLink tlog into replay files for the viewer.
The exporter uses only the Python standard library. It reads only data that the tlog contains. It reads no simulator truth.

## What the exporter writes

- `viewer.json`: position (NED from the first sample), altitude, climb rate, heading, attitude, flight mode and armed state. Format: `viewer/FORMAT.md`.
- `result.json`: events from COMMAND_ACK, STATUSTEXT, mode changes and arm changes. It has `"derived": true` and no verdict. The viewer shows "NO RESULT".

## Steps

1. Find the tlog. For a manual SITL flight it is `flight.tlog` in the MAVProxy log directory.
2. Go to the repository root.
3. Run the exporter: `python3 -m lab.export_tlog <tlog> <out_dir> --run-id <name>`.
4. Read the printed summary. Check that `samples` is not 0. Check that `skipped_bytes` is 0.
5. Keep `<out_dir>` under `local/` or `runs/`. Do not commit it.

## Replay it

1. Copy or link `<out_dir>` to `runs/<name>/` in the repository. The `runs/` directory is ignored by git.
2. Start the viewer server: `viewer/serve.sh`. The server listens on 127.0.0.1 only.
3. Open `http://127.0.0.1:8765/viewer/index.html?run=../runs/<name>` in a browser with WebGL.
4. Press Play. The timeline shows the events.
5. Stop the server with Ctrl-C.

Alternative without a server: open `viewer/index.html`, select "Load files…", and choose `viewer.json` and `result.json` together.

## Options

- `--t0 first-position`: time zero is the first position sample. The exporter drops earlier events and prints how many.
- The default time zero is the first tlog record. The replay then starts with a still period before the first position sample.

## Limits

- The exporter uses the first vehicle HEARTBEAT to find the vehicle. It skips the MAVProxy ground station heartbeat.
- It decodes five message types: HEARTBEAT, GLOBAL_POSITION_INT, ATTITUDE, COMMAND_ACK and STATUSTEXT. It checks the CRC of each frame.
- It skips bad frames and counts the skipped bytes. It does not join chunked STATUSTEXT messages.
- Mode names are ArduCopter names. Other vehicles show `MODE_<number>`.
- A tlog has no mission state, so the viewer colours the run by flight mode.

## Test

Run: `python3 -m unittest tests.test_export_tlog -v`.
The tests build a small synthetic tlog in memory. Two tests compare the reader with pymavlink. They run only where pymavlink is installed (the container venv `~/venv-ardupilot`). CI skips them.
