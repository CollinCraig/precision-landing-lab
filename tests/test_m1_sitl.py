"""Opt-in integration check. Do not start or install SITL here."""
import json
import os
from pathlib import Path
import sys
import struct
import unittest

from lab.run import main
from m1_support import read_selected_tlog
from test_m1_learner import PHASES


@unittest.skipUnless(os.environ.get("M1_RUN_SITL") == "1", "SITL test requires explicit opt-in")
class SitlIntegrationTests(unittest.TestCase):
    def test_learner_mission_on_existing_sitl(self):
        required = ("M1_SITL_ENDPOINT", "M1_ARDUPILOT_VERSION", "M1_CONTAINER", "M1_RUN_ID", "M1_RUN_ROOT")
        missing = [name for name in required if not os.environ.get(name)]
        self.assertEqual(missing, [], "Supply actual SITL provenance and a new local run directory")
        arguments = ["--runs", os.environ["M1_RUN_ROOT"], "--run-id", os.environ["M1_RUN_ID"],
                     "--seed", "42", "--scenario", "m1-sitl", "--mode", "offline",
                     "--ardupilot-version", os.environ["M1_ARDUPILOT_VERSION"],
                     "--container", os.environ["M1_CONTAINER"],
                     "--endpoint", os.environ["M1_SITL_ENDPOINT"], "--timeout", "120",
                     "--input-source", "runner", "--input-source", "autopilot",
                     "--", sys.executable, "-m", "lab.mission_child"]
        self.assertEqual(main(arguments), 0, "Inspect failed run evidence before another attempt")
        result = json.loads((Path(os.environ["M1_RUN_ROOT"]) / os.environ["M1_RUN_ID"] / "result.json").read_text())
        self.assertTrue(result["success"])
        phases = [event for event in result["events"] if event["kind"] in PHASES]
        self.assertEqual([event["kind"] for event in phases], list(PHASES))
        phase_times = {event["kind"]: event["t_us"] for event in phases}
        self.assertGreaterEqual(phase_times["LAND"] - phase_times["HOLD"], 5_000_000)
        run_path = Path(os.environ["M1_RUN_ROOT"]) / os.environ["M1_RUN_ID"]
        manifest = json.loads((run_path / "manifest.json").read_text())
        records = [(stamp - manifest["started_unix_us"], message_id, payload)
                   for stamp, message_id, payload in read_selected_tlog(run_path / "flight.tlog")]
        arm_confirmations = [stamp for stamp, message_id, payload in records
                             if message_id == 0 and payload[6] & 128
                             and int.from_bytes(payload[:4], "little") == 4
                             and phase_times["ARM"] <= stamp < phase_times["TAKEOFF"]]
        self.assertTrue(arm_confirmations, "Confirm GUIDED and ARM before takeoff")
        hold_heights = [struct.unpack_from("<i", payload, 16)[0]
                        for stamp, message_id, payload in records
                        if message_id == 33 and phase_times["HOLD"] <= stamp < phase_times["LAND"]]
        self.assertTrue(hold_heights, "Record height during HOLD")
        self.assertGreaterEqual(min(hold_heights), 4750)
        disarm_confirmations = [stamp for stamp, message_id, payload in records
                                if message_id == 0 and not payload[6] & 128
                                and stamp >= phase_times["WAIT_DISARM"]]
        self.assertTrue(disarm_confirmations, "Confirm disarm after LAND")


if __name__ == "__main__":
    unittest.main()
