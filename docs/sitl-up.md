# Start SITL with scripts/sitl-up

Use `scripts/sitl-up` to start the pinned ArduPilot Copter SITL binary. The script does not use MAVProxy.
Run it inside the `landing-lab` container.

## Pins

- Source: `~/src/ardupilot` at commit `fb773567896014da007bca58358704d4a0d8516f` (Copter-4.7.2).
- Binary: `build/sitl/bin/arducopter`, SHA-256 `4caa3e509113eb1622383fa55f11a0078f2526042481095c056a22d04c1b9b95`.
- The script checks both pins. It stops if a pin differs.
- The script also checks that the source tree has no tracked changes. It compares `copter.parm` with the pinned revision.
- The variables `SITL_SRC_COMMIT` and `SITL_BIN_SHA256` override the pins for tests only. The script prints a warning when you use them.

## Steps

1. Enter the container: `distrobox enter landing-lab`.
2. Go to the repository directory.
3. Check that the firewall has "default deny (incoming)": `sudo ufw status verbose`. This step needs the owner or an approved step. The script does not change the firewall.
4. Show the command: `scripts/sitl-up --print`.
5. Start SITL: `scripts/sitl-up`. Keep this terminal open.
6. In a second terminal, connect MAVProxy: `mavproxy.py --master=udpin:127.0.0.1:14550`.
7. Stop SITL with Ctrl-C.

## Defaults

- Model `+` (quad), speedup 1, system ID 1, home CMAC (`-35.363261,149.165230,584,353`).
- Defaults file: `Tools/autotest/default_params/copter.parm`.
- SERIAL0 is `udpclient:127.0.0.1:14550`. SITL sends to loopback only. MAVProxy listens with `udpin:127.0.0.1:14550`.
- SERIAL1 and SERIAL2 are `none`. The SITL defaults would open TCP 5762 and 5763 on all interfaces.
- The script wipes the parameters at start. Use `--no-wipe` to keep them.
- The work directory is `$HOME/sitl-run`. SITL writes `eeprom.bin` and logs there, not in the source tree.

## Optional UDP output

Use `--udp-out 127.0.0.1:14551` to add SERIAL1 as `udpclient:127.0.0.1:14551`. The runner can then use `udpin:127.0.0.1:14551`.
Only 127.0.0.1 and ports 1024 to 65535 are valid. The port must differ from 14550. This option was not tested against a live SITL.

## Known limits

- SITL cannot bind TCP to 127.0.0.1. It binds TCP to all host interfaces. The script avoids TCP for this reason.
- Open port: UDP 5501 (RC input). SITL binds it on all host interfaces (0.0.0.0), also LAN and Tailscale. Only `--rcin-port` moves it.
  The script cannot close it. Rely on the firewall: before the first flight, check that `ufw` shows "default deny (incoming)".
- With the default options no TCP port is open (5760, 5762 and 5763 are not used). The distrobox container shares the host network.
- The script takes a lock (`flock`, file `$XDG_RUNTIME_DIR/sitl-up.lock`) for the whole run. A second start stops with an error.
  Use `SITL_LOCK_FILE` to change the lock file.
- The script makes relative paths in `SITL_SRC_DIR` and `--workdir` absolute before it changes directory.
- Dependencies for MAVProxy are in `requirements-m1.lock` (hash-locked, Python 3.12, `x86_64-manylinux_2_39`, wheels only).
  Install them later in a venv with `pip install --require-hashes --only-binary :all: -r requirements-m1.lock`.
  Regenerate the lock with the command in its header.
- The tests are in `tests/test_sitl_up.py`. They use a fake source tree and do not start SITL.
