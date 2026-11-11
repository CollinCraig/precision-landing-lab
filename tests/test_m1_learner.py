"""Learner acceptance tests. The empty exercise must fail these tests."""
import os
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from lab.run import run
from m1_support import FakeAutopilot, metadata


PHASES = ("CONNECT", "WAIT_READY", "SET_GUIDED", "ARM", "TAKEOFF", "CLIMB", "HOLD", "LAND", "WAIT_DISARM")


class LearnerTests(unittest.TestCase):
    def exercise(self, fault=None):
        fake = FakeAutopilot(fault)
        started = time.monotonic()
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"M1_WAIT_TIMEOUT_S": "2"}):
            _, result = run(root, metadata("learner", "m1-fake"),
                            [sys.executable, "-m", "lab.mission_child"],
                            factory=lambda _: fake, timeout=14)
        self.assertTrue(fake.closed, "Infrastructure failure: transport did not close")
        return fake, result, time.monotonic() - started

    def test_takeoff_hold_land_and_confirm_disarm(self):
        fake, result, elapsed = self.exercise()
        self.assertTrue(result["success"], f"Learner exercise incomplete: {result['failure_reason']}")
        phases = [event for event in result["events"] if event["kind"] in PHASES]
        self.assertEqual([event["kind"] for event in phases], list(PHASES))
        self.assertEqual(fake.violations, [])
        self.assertTrue(fake.arm_observed, "Confirm ARM with a heartbeat")
        self.assertTrue(fake.disarm_observed, "Confirm disarm after LAND")
        self.assertIsNotNone(fake.reached_at, "Reach at least 4.75 m relative altitude")
        self.assertIsNotNone(fake.land_at, "Request LAND")
        self.assertGreaterEqual(fake.land_at - fake.reached_at, 5.0)
        phase_times = {event["kind"]: event["t_us"] for event in phases}
        self.assertGreaterEqual(phase_times["LAND"] - phase_times["HOLD"], 5_000_000)
        commands = [item[0] for item in fake.commands]
        self.assertIn(400, commands)
        self.assertIn(22, commands)
        self.assertLess(commands.index(400), commands.index(22))
        self.assertLess(elapsed, 14)

    def assert_bounded_failure(self, fault, phase, budget):
        fake, result, elapsed = self.exercise(fault)
        self.assertFalse(result["success"], "Reject missing state confirmation")
        self.assertIn(phase, [event["kind"] for event in result["events"]], "Enter the required learner phase")
        reason = result["failure_reason"]
        self.assertNotEqual(reason["code"], "mission_exception", "Implement explicit bounded failure handling")
        self.assertNotIn("Runner wall-time limit reached", reason["detail"])
        if fault == "no_heartbeat":
            self.assertEqual(reason["code"], "runner_error")
            self.assertIn("timeout", reason["detail"])
        else:
            self.assertIn(reason["code"], ("timeout", "readiness_failed", "command_rejected", "connection_failed"))
        self.assertLess(elapsed, budget, "End each wait within its phase limit")
        self.assertEqual(fake.violations, [])

    def test_missing_heartbeat(self):
        self.assert_bounded_failure("no_heartbeat", "CONNECT", 4)

    def test_readiness_never_arrives(self):
        self.assert_bounded_failure("not_ready", "WAIT_READY", 4)

    def test_guided_never_arrives(self):
        self.assert_bounded_failure("mode_stuck", "SET_GUIDED", 4)

    def test_arm_never_arrives(self):
        self.assert_bounded_failure("arm_stuck", "ARM", 4)

    def test_climb_never_arrives(self):
        self.assert_bounded_failure("climb_stuck", "CLIMB", 4)

    def test_telemetry_stops_after_takeoff(self):
        self.assert_bounded_failure("telemetry_lost", "CLIMB", 4)

    def test_disarm_never_arrives(self):
        self.assert_bounded_failure("disarm_stuck", "WAIT_DISARM", 10)


if __name__ == "__main__":
    unittest.main()
