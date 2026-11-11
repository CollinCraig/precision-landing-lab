"""Pilot interface (D-038): what the owner's `mission.py` can use.

The owner writes `run(ap, budgets)` in his own repository. The runner loads it
from an external folder. See docs/pilot-interface.md.
This module is platform code. It contains no mission logic.
"""
import importlib.util
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from . import mavlite
from .mission_io import MissionClient

INTERFACE_VERSION = 1
PLATFORM_ROOT = Path(__file__).resolve().parent.parent

# Phase name -> step number. The step number appears in log lines and in test names.
PHASE_STEPS = {"CONNECT": 1, "WAIT_READY": 1, "SET_GUIDED": 2, "ARM": 2,
               "TAKEOFF": 3, "CLIMB": 3, "HOLD": 3, "LAND": 4, "WAIT_DISARM": 4}


@dataclass(frozen=True)
class Budgets:
    """Time limit in seconds for each wait. Each state has its own limit."""
    connect_s: float
    ready_s: float
    guided_s: float
    arm_s: float
    takeoff_s: float
    climb_s: float
    hold_s: float
    telemetry_gap_s: float
    disarm_s: float


# Failure codes that `ap.fail` accepts.
FAIL_CODES = ("timeout", "readiness_failed", "command_rejected", "connection_failed", "mission_exception")


# "fake" values suit the fake autopilot. "sitl" values come from the first real flight
# (readiness at 37 s, landing from 5 m in 13 s), with margin.
PROFILES = {
    "fake": Budgets(connect_s=2.0, ready_s=2.0, guided_s=2.0, arm_s=2.0, takeoff_s=2.0, climb_s=2.0,
                    hold_s=5.0, telemetry_gap_s=1.0, disarm_s=2.0),
    "sitl": Budgets(connect_s=10.0, ready_s=120.0, guided_s=10.0, arm_s=10.0, takeoff_s=10.0, climb_s=20.0,
                    hold_s=5.0, telemetry_gap_s=3.0, disarm_s=40.0),
}


class Autopilot:
    """Decoded messages in, commands out. Every ACK and STATUSTEXT is printed.

    Output goes to stderr. Use `ap.log(...)` for your own lines. A plain `print()`
    is also safe: the child process sends it to stderr.
    """

    def __init__(self, client, log_stream=None, clock=time.monotonic):
        self.client = client
        self.clock = clock
        self.log_stream = sys.stderr if log_stream is None else log_stream
        self.latest = {}   # message type name -> last decoded message of that type
        self.acks = []     # every COMMAND_ACK seen, oldest first
        self.texts = []    # every STATUSTEXT seen, oldest first
        self.sequence = 0
        self.origin = clock()
        self.step = None

    def log(self, *parts):
        """Print one line to stderr with the elapsed time."""
        print(f"[{self.clock() - self.origin:7.2f}s]", *parts, file=self.log_stream, flush=True)

    def receive(self, message_type=None, timeout=1.0):
        """Return the next decoded message, or None when `timeout` seconds pass.

        With `message_type`, other messages are read, stored in `self.latest`, and
        skipped. Nothing is lost: ACK and STATUSTEXT are always printed and stored.
        """
        if message_type is not None and message_type not in mavlite.MSGID:
            raise ValueError(f"Unknown message type {message_type!r}")
        deadline = self.clock() + timeout
        while True:
            remaining = max(0.0, deadline - self.clock())
            packet = self.client.receive(None, min(remaining, 5.0))
            if packet is not None:
                message = mavlite.decode(packet)
                if message is not None:
                    self._note(message)
                    if message_type in (None, message.type):
                        return message
            if self.clock() >= deadline:
                return None

    def _note(self, message):
        self.latest[message.type] = message
        if message.type == "COMMAND_ACK":
            self.acks.append(message)
            self.log("[ack]", message.pretty())
        elif message.type == "STATUSTEXT":
            self.texts.append(message)
            self.log("[text]", message.pretty())

    def send_command(self, command, *params):
        """Send COMMAND_LONG to the autopilot. Transport success is not command success."""
        self.sequence += 1
        self.client.send(mavlite.encode_command_long(command, params, sequence=self.sequence))
        self.log("[send] COMMAND_LONG", command, params)

    def set_mode(self, custom_mode):
        """Send SET_MODE. The autopilot confirms only through a later HEARTBEAT."""
        self.sequence += 1
        self.client.send(mavlite.encode_set_mode(custom_mode, sequence=self.sequence))
        self.log("[send] SET_MODE", custom_mode)

    def request_interval(self, message_type, hz):
        """Ask the autopilot to send a message type `hz` times each second."""
        self.send_command(mavlite.CMD_SET_MESSAGE_INTERVAL, mavlite.MSGID[message_type], 1e6 / hz)

    def phase(self, name):
        """Record entry into a state, once. The log line carries the step number."""
        self.step = PHASE_STEPS.get(name)
        self.client.event(name)
        self.log(f"[step {self.step or '?'}] {name}")

    def succeed(self):
        """Report success. Call it once, after the last state."""
        self.log("[outcome] success")
        self.client.outcome(True)

    def fail(self, code, detail):
        """Report failure. `code` is one of: timeout, readiness_failed, command_rejected,
        connection_failed, mission_exception. `detail` says which state failed and why."""
        if code not in FAIL_CODES:
            raise ValueError(f"Unknown failure code {code!r}. Use one of: {', '.join(FAIL_CODES)}")
        self.log(f"[outcome] failed {code}: {detail}")
        self.client.outcome(False, code, detail)


def pilot_command(pilot, profile="sitl"):
    """Return (argv, env) to run the child for the pilot folder `pilot`."""
    pilot = Path(pilot).expanduser().resolve()
    if not (pilot / "mission.py").is_file():
        raise ValueError(f"Pilot folder has no mission.py: {pilot}")
    if profile not in PROFILES:
        raise ValueError(f"Unknown profile {profile!r}. Use one of: {', '.join(PROFILES)}")
    argv = [sys.executable, "-m", "lab.mission_child", "--pilot", str(pilot), "--profile", profile]
    path = os.pathsep.join(filter(None, (str(PLATFORM_ROOT), os.environ.get("PYTHONPATH"))))
    return argv, {"PYTHONPATH": path}


def load_pilot(pilot):
    """Import `<pilot>/mission.py` and return its `run` function."""
    pilot = Path(pilot).expanduser().resolve()
    path = pilot / "mission.py"
    if not path.is_file():
        raise ValueError(f"Pilot folder has no mission.py: {pilot}")
    sys.path.insert(0, str(pilot))  # the pilot may keep helper modules next to mission.py
    spec = importlib.util.spec_from_file_location("pilot_mission", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # needed by dataclasses and `from __future__ import annotations`
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(spec.name, None)
        raise
    version = getattr(module, "PLATFORM_INTERFACE", None)
    if version != INTERFACE_VERSION:
        raise ValueError(f"mission.py uses interface {version!r}; this platform needs {INTERFACE_VERSION}. "
                         "Run `learn doctor`.")
    if not callable(getattr(module, "run", None)):
        raise ValueError("mission.py has no function run(ap, budgets)")
    return module.run

