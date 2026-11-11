"""Check the step tests themselves (review finding 6): they must reject a failure inside the step.

These tests use made-up result records and one probe mission. The probe reports a failure
and has no flight logic. No test here holds a solved mission.
"""
import contextlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))  # tests import m1_support by name
from lab import learn_cli
from m1_support import FakeAutopilot
import test_pilot_steps as steps

PHASES = steps.PHASES


def record(seen, code=None, detail="", success=False, step_us=1_000_000, duration=None):
    events = [{"kind": name, "t_us": (i + 1) * step_us} for i, name in enumerate(seen)]
    reason = None if success else {"code": code, "detail": detail}
    return {"success": success, "failure_reason": reason, "events": events,
            "duration_us": duration if duration is not None else (len(seen) + 1) * step_us}


class StepCheckTests(unittest.TestCase):
    def check(self, result, step):
        case = steps.PilotCase("phases")
        case.stderr_tail = ""
        case.assert_no_failure_in_step(result, step)

    def test_explicit_failure_in_the_step_is_rejected(self):
        for code in ("readiness_failed", "timeout", "command_rejected"):
            with self.assertRaises(AssertionError, msg=code):
                self.check(record(PHASES[:2], code, "WAIT_READY: no"), 1)
        with self.assertRaises(AssertionError):  # another exception inside the step
            self.check(record(PHASES[:2], "mission_exception", "KeyError: 'x' at mission.py:30"), 1)

    def test_stub_of_a_later_step_and_an_early_end_are_allowed(self):
        self.check(record(PHASES[:2], "mission_exception", "NotImplementedError: STEP 2: write set_guided() at mission.py:50"), 1)
        self.check(record(PHASES[:2], "mission_exception", "run() returned without ap.succeed() or ap.fail()"), 1)
        self.check(record(PHASES[:7], "mission_exception", "NotImplementedError: STEP 4: write land() at mission.py:90"), 3)
        self.check(record(PHASES, success=True), 4)

    def test_stub_of_the_same_step_is_rejected(self):
        with self.assertRaises(AssertionError):
            self.check(record(PHASES[:1], "mission_exception", "NotImplementedError: STEP 1: write wait_ready() at mission.py:40"), 1)

    def test_hold_is_measured_to_the_next_state_not_to_the_end_of_the_run(self):
        short = record(PHASES[:8], success=True, step_us=2_000_000, duration=60_000_000)  # HOLD lasts 2 s
        self.assertEqual(steps.hold_us(short), 2_000_000)
        with_next = record(PHASES, success=True, step_us=6_000_000)
        self.assertEqual(steps.hold_us(with_next), 6_000_000)
        stopped = record(PHASES[:7], "mission_exception", "NotImplementedError: STEP 4: write land()",
                         step_us=1_000_000, duration=7_500_000)
        self.assertEqual(steps.hold_us(stopped), 500_000)

    def bounded(self, fault, phase, seen, detail, elapsed=1.0, also=()):
        """Run assert_bounded_failure on a made-up result. It uses no pilot and no fake autopilot."""
        class Canned(steps.PilotCase):
            def exercise(inner, fault=None):
                inner.stderr_tail = ""
                return FakeAutopilot(), record(seen, "timeout", detail), elapsed
        Canned("phases").assert_bounded_failure(fault, phase, 6, also=also)

    def test_telemetry_lost_after_takeoff_accepts_a_failure_in_takeoff_or_in_climb(self):
        args = ("telemetry_lost", "TAKEOFF")
        self.bounded(*args, PHASES[:5], "TAKEOFF: no ACK", also=("CLIMB",))  # waited for the ACK
        self.bounded(*args, PHASES[:6], "CLIMB: no height", also=("CLIMB",))  # entered CLIMB first
        with self.assertRaises(AssertionError) as caught:  # the detail names no allowed state
            self.bounded(*args, PHASES[:5], "WAIT_DISARM: no", also=("CLIMB",))
        self.assertIn("The failure detail was", str(caught.exception))
        self.assertIn("TAKEOFF or CLIMB", str(caught.exception))
        with self.assertRaises(AssertionError) as caught:  # the pilot never entered TAKEOFF
            self.bounded(*args, PHASES[:4], "TAKEOFF: no ACK", also=("CLIMB",))
        self.assertIn("The pilot entered these states: CONNECT, WAIT_READY, SET_GUIDED, ARM", str(caught.exception))
        self.assertIn("expected the state TAKEOFF", str(caught.exception))

    def test_a_slow_failure_names_the_elapsed_time_and_the_limit(self):
        with self.assertRaises(AssertionError) as caught:
            self.bounded("climb_stuck", "CLIMB", PHASES[:6], "CLIMB: slow", elapsed=9.0)
        self.assertIn("The run took 9.0 seconds", str(caught.exception))

    def test_the_fake_stops_telemetry_one_second_into_hold(self):
        now = [100.0]
        fake = FakeAutopilot("telemetry_lost_hold", clock=lambda: now[0])
        fake.reached_at = 100.0
        now[0] = 100.5
        self.assertIsNotNone(fake.recv_match())
        now[0] = 101.2
        self.assertIsNone(fake.recv_match())
        self.assertIsNone(FakeAutopilot("telemetry_lost_hold", clock=lambda: now[0]).reached_at)

    def test_a_probe_that_reports_a_readiness_failure_does_not_pass_step_1(self):
        """The probe reads telemetry, then reports readiness_failed. It makes no flight decision."""
        probe = ('PLATFORM_INTERFACE = 1\n'
                 'def run(ap, budgets):\n'
                 '    ap.phase("CONNECT")\n    ap.receive(timeout=1)\n'
                 '    ap.phase("WAIT_READY")\n    ap.receive(timeout=1)\n'
                 '    ap.fail("readiness_failed", "WAIT_READY: probe")\n')
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "mission.py").write_text(probe)
            out = io.StringIO()
            with contextlib.redirect_stdout(out), patch.dict(os.environ, {}):
                code = learn_cli.step(Path(root), 1)
            self.assertEqual(code, 1)
            self.assertIn("FAIL  step 1  connect and wait ready", out.getvalue())
            self.assertIn("failure inside step 1", out.getvalue())
            self.assertIn("Evidence for this failure: local/last-run/test_step1_connect_and_wait_ready/mission.stderr",
                          out.getvalue())


if __name__ == "__main__":
    unittest.main()
