# Start SITL with scripts/sitl-up

Use `scripts/sitl-up` to start the pinned ArduPilot Copter SITL binary. The script does not use MAVProxy.
Run it inside the `landing-lab` container.

## Pins

- Source: `~/src/ardupilot` at commit `fb773567896014da007bca58358704d4a0d8516f` (Copter-4.7.2).
- Binary: `build/sitl/bin/arducopter`, SHA-256 `4caa3e509113eb1622383fa55f11a0078f2526042481095c056a22d04c1b9b95`.
- The script checks both pins. It stops if a pin differs.

## Steps

1. Enter the container: `distrobox enter landing-lab`.
2. Show the command: `scripts/sitl-up --print`.
3. Start SITL: `scripts/sitl-up`. Keep this terminal open.
4. Stop SITL with Ctrl-C.

## Defaults

- Model `+` (quad), speedup 1, system ID 1, home CMAC (`-35.363261,149.165230,584,353`).
- Defaults file: `Tools/autotest/default_params/copter.parm`.
- SERIAL0 is `tcp:5760`. MAVProxy or a ground station connects there.
- The script wipes the parameters at start. Use `--no-wipe` to keep them.
- The work directory is `$HOME/sitl-run`. SITL writes `eeprom.bin` and logs there, not in the source tree.

## Optional UDP output

Use `--udp-out 127.0.0.1:14550` to add SERIAL1 as `udpclient:127.0.0.1:14550`. The runner can then use `udpin:127.0.0.1:14550`.
Only 127.0.0.1 and ports 1024 to 65535 are valid. This option was not tested against a live SITL.

## Known limits

- The TCP port 5760 listens on the container network. The distrobox container shares the host network.
- The script refuses to start if an `arducopter` process already runs.
- Dependencies for MAVProxy are in `requirements-m1.lock` (hash-locked, Python 3.12, `x86_64-manylinux_2_39`, wheels only).
  Install them later in a venv with `pip install --require-hashes --only-binary :all: -r requirements-m1.lock`.
  Regenerate the lock with the command in its header.
- The tests are in `tests/test_sitl_up.py`. They use a fake source tree and do not start SITL.
