"""Read Linux AC status without system changes or external commands."""
from enum import Enum
import os
from pathlib import Path

from .link import RunFailure


class ACState(Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    UNKNOWN = "unknown"


def read_ac(root=Path("/sys/class/power_supply")):
    """Return ACState from Mains supplies. Fail closed on incomplete data.

    Battery status does not prove wall power. Only Mains supplies qualify.
    Read at most 128 entries and 64 bytes per attribute. Do not cache status.
    """
    def attribute(path):
        with path.open("rb") as stream:
            data = stream.read(65)
        if len(data) > 64:
            raise ValueError("Oversized power attribute")
        return data.decode("ascii").strip()

    try:
        states = []
        with os.scandir(root) as entries:
            for index, entry in enumerate(entries):
                if index >= 128:
                    return ACState.UNKNOWN
                path = Path(entry.path)
                kind = attribute(path / "type")
                if not kind:
                    return ACState.UNKNOWN
                if kind != "Mains":
                    continue
                online = attribute(path / "online")
                if online not in ("0", "1"):
                    return ACState.UNKNOWN
                states.append(online == "1")
        if not states:
            return ACState.UNKNOWN
        return ACState.ONLINE if any(states) else ACState.OFFLINE
    except (OSError, ValueError, UnicodeError):
        return ACState.UNKNOWN


class WallPowerGuard:
    """Check source() at each callback. Keep the first failure until disposal.

    The source must return ACState promptly. It must not change system state.
    This callback never signals, polls, waits for, or reaps the child process.
    The runner owns process cleanup. Create a new guard for a new run.
    """
    def __init__(self, source=read_ac):
        self.source = source
        self.failure = None

    def __call__(self, phase, process):
        if phase not in ("before_connect", "before_launch", "poll"):
            raise ValueError("Unknown guard phase")
        if self.failure is not None:
            raise self.failure
        try:
            state = self.source()
        except Exception:
            state = ACState.UNKNOWN
        if state is ACState.ONLINE:
            return
        status = "offline" if state is ACState.OFFLINE else "unknown"
        code = "ac_lost" if phase == "poll" else "ac_unavailable"
        self.failure = RunFailure(code, f"AC source is {status} at {phase}. Start a new run after AC checks pass.")
        raise self.failure
