"""Start the owner's mission from an external pilot folder. Do not select flight commands here.

Usage: python -m lab.mission_child --pilot <folder> [--profile fake|sitl]
The environment variables M1_PILOT and M1_PROFILE are defaults for the two options.
"""
import argparse
import os
import sys
import traceback
from pathlib import Path

from lab import pilot_api
from lab.mission_io import MissionClient


def main(argv=None, *, protect_stdout=False):
    """Call the pilot's run(ap, budgets). Report an exception as a failed outcome.

    With `protect_stdout`, the protocol keeps a private copy of the real stdout.
    Then `print()` in the pilot's code goes to stderr and cannot damage the protocol.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilot", default=os.environ.get("M1_PILOT"))
    parser.add_argument("--profile", default=os.environ.get("M1_PROFILE", "sitl"))
    args = parser.parse_args(argv)
    writer = None
    if protect_stdout:
        writer = os.fdopen(os.dup(1), "w", encoding="utf-8")
        os.dup2(2, 1)
        sys.stdout = sys.stderr
    client = MissionClient(writer=writer)
    try:
        if not args.pilot:
            raise ValueError("No pilot folder. Use --pilot <folder>.")
        if args.profile not in pilot_api.PROFILES:
            raise ValueError(f"Unknown profile {args.profile!r}")
        run = pilot_api.load_pilot(args.pilot)
        run(pilot_api.Autopilot(client), pilot_api.PROFILES[args.profile])
        if not client.finished:
            client.outcome(False, "mission_exception", "run() returned without ap.succeed() or ap.fail()")
    except Exception as error:
        traceback.print_exc()  # the full traceback goes to mission.stderr
        frames = traceback.extract_tb(error.__traceback__)
        where = f" at {Path(frames[-1].filename).name}:{frames[-1].lineno}" if frames else ""
        if not client.finished:
            client.outcome(False, "mission_exception", f"{type(error).__name__}: {error}{where}")


if __name__ == "__main__":
    main(protect_stdout=True)
