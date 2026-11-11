# Export a flight and replay it

Use `lab/export_tlog.py` to convert a MAVLink tlog into replay files for the viewer.
The exporter uses only the Python standard library. It reads only data that the tlog contains. It reads no simulator truth.

## What the exporter writes

- `viewer.json`: position (NED from the first sample), altitude, climb rate, heading, attitude, flight mode and armed state. Format: `viewer/FORMAT.md`.
- `result.json`: events from COMMAND_ACK, STATUSTEXT, mode changes and arm changes. It has `"derived": true`. It has no verdict, unless you set `--verdict`. Without a verdict the viewer shows "NO RESULT".

The exporter never replaces a `result.json` that it did not write. A run directory keeps its verdict and metrics in that file. If the file exists and has no `"derived": true`, the exporter stops with an error and writes nothing. Use another output directory, or use `--viewer-only`.

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
- `--verdict PASS` or `--verdict FAIL`: the tlog has no verdict, so you supply it. The exporter writes `success`, `verdict` and `"verdict_source": "operator"` in the derived `result.json`. The viewer then shows `PASS (operator)` or `FAIL (operator)`. It never shows this verdict as a runner result.
- `--viewer-only`: write only `viewer.json`. An existing `result.json` stays unchanged. Use this option for a run directory that has its own `result.json`.
- `--sysid N --compid N`: select the vehicle yourself. The default is the first vehicle HEARTBEAT.

## Limits

- The exporter uses the first vehicle HEARTBEAT to find the vehicle (system ID and component ID). It skips the MAVProxy ground station heartbeat.
- It uses only messages from that system and component. Messages from other components (gimbal, companion computer) are ignored.
- It decodes five message types: HEARTBEAT, GLOBAL_POSITION_INT, ATTITUDE, COMMAND_ACK and STATUSTEXT. It checks the CRC of every frame, also of other message types, and the payload length of each decoded frame. MAVLink v1 needs the exact length. MAVLink v2 can have trailing zero bytes removed.
- The CRC extra of each message comes from `lab/mavlink_crc_extra.py` (the ardupilotmega dialect, generated from pymavlink; the file header names the version and the command). A frame with a bad CRC or with a message id that is not in the table is skipped and counted. The exporter then looks for the next record. A message that is not in the dialect is skipped too.
- It skips bad frames and counts the skipped bytes. Check that `skipped_bytes` is 0. It does not join chunked STATUSTEXT messages.
- A gap of more than one day between records is not an error. The exporter counts it in `large_gaps` and prints a warning.
- Attitude columns use only the latest ATTITUDE record at or before each position sample. Before the first ATTITUDE record, the value is `null`. An ATTITUDE record with NaN or Infinity also gives `null`.
- Mode names are ArduCopter names. Other vehicles show `MODE_<number>`.
- A tlog has no mission state, so the viewer colours the run by flight mode.

## Test

Run: `python3 -m unittest tests.test_export_tlog -v`.
The tests build a small synthetic tlog in memory. Three tests compare the reader and the CRC table with pymavlink. They run only where pymavlink is installed (the container venv `~/venv-ardupilot`). CI skips them.
