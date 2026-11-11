"""Start the learner function. Do not select flight commands here."""
import sys
import math
import os

from lab import mission
from lab.mission_io import MissionClient


def main():
    """Call the learner function. Report an exception as a failed outcome."""
    client = MissionClient()
    try:
        wait_timeout = float(os.environ.get("M1_WAIT_TIMEOUT_S", "10"))
        if not math.isfinite(wait_timeout) or wait_timeout <= 0:
            raise ValueError("M1_WAIT_TIMEOUT_S must be positive and finite")
        mission.run(client, wait_timeout=wait_timeout)
        if not client.finished:
            client.outcome(False, "mission_exception", "Learner function returned without an outcome")
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        if not client.finished:
            client.outcome(False, "mission_exception", f"{type(error).__name__}: {error}")


if __name__ == "__main__":
    main()
