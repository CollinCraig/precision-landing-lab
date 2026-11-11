"""Step-tagged tests for the owner's pilot (D-038). They run against an external folder.

Set M1_PILOT to the pilot folder, or use `scripts/learn step N`. Without M1_PILOT the
tests are skipped, so the platform CI does not run an unfinished pilot.
Each class is one step. The fake autopilot is the equipment: it does not prove flight safety.
Failure messages follow ASD-STE100 Simplified Technical English.
"""
import os
import re
import shutil
import tempfile
import time
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # tests import m1_support by name
from lab.pilot_api import pilot_command
from lab.run import run
from m1_support import FakeAutopilot, metadata

PILOT = os.environ.get("M1_PILOT")
LAST_RUN = os.environ.get("M1_LAST_RUN_DIR")
PHASES = ("CONNECT", "WAIT_READY", "SET_GUIDED", "ARM", "TAKEOFF", "CLIMB", "HOLD", "LAND", "WAIT_DISARM")
STEPS = {1: PHASES[:2], 2: PHASES[2:4], 3: PHASES[4:7], 4: PHASES[7:]}
LATER_STUB = re.compile(r"NotImplementedError: STEP ([1-4])")
BOUNDED = ("timeout", "readiness_failed", "command_rejected", "connection_failed")


def hold_us(result):
    """Length of HOLD in microseconds: from the HOLD event to the next state event.

    With no next state event, HOLD ends when the run stops. Step 3 allows that case only
    because the stub of step 4 stops the run at once. A later state with its own event does not count.
    """
    events = [e for e in result["events"] if e["kind"] in PHASES]
    index = next(i for i, e in enumerate(events) if e["kind"] == "HOLD")
    end = events[index + 1]["t_us"] if index + 1 < len(events) else result["duration_us"]
    return end - events[index]["t_us"]


def reported_code(reason):
    """The runner renames a failure before the first telemetry. Return the original code."""
    if reason["code"] == "runner_error" and reason["detail"].startswith("Before telemetry: "):
        return reason["detail"].split(": ")[1]
    return reason["code"]


@unittest.skipUnless(PILOT, "Set M1_PILOT to the pilot folder")
class PilotCase(unittest.TestCase):
    longMessage = False  # show only our message, not the raw difference

    def exercise(self, fault=None):
        fake = FakeAutopilot(fault)
        started = time.monotonic()
        command, env = pilot_command(PILOT, "fake")
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        path, result = run(root, metadata("pilot", "m1-fake"), command,
                           factory=lambda _: fake, timeout=30, env=env)
        elapsed = time.monotonic() - started
        stderr = (path / "mission.stderr").read_text(errors="replace")
        self.stderr_tail = "\n".join(stderr.splitlines()[-14:])
        if LAST_RUN:  # each test keeps its own run, so the evidence matches the failure
            keep = Path(LAST_RUN) / self._testMethodName
            shutil.rmtree(keep, ignore_errors=True)
            shutil.copytree(path, keep)
        self.assertTrue(fake.closed, "Equipment fault: the transport did not close. Tell the platform agent.")
        return fake, result, elapsed

    def say(self, text):
        return f"{text}\n--- end of mission.stderr ---\n{self.stderr_tail}"

    def phases(self, result):
        return [event["kind"] for event in result["events"] if event["kind"] in PHASES]

    def assert_steps_reached(self, result, upto):
        wanted = [p for step in range(1, upto + 1) for p in STEPS[step]]
        self.assertEqual(self.phases(result)[:len(wanted)], wanted,
                         self.say(f"Enter the states in this order: {', '.join(wanted)}. "
                                  "Call ap.phase(name) once when you enter each state."))

    def assert_no_failure_in_step(self, result, step):
        """Reject a failure inside steps 1 to `step`. Allow a stub of a later step, or an end after the step."""
        if result["success"]:
            return
        reason, seen = result["failure_reason"], self.phases(result)
        later = [p for number in range(step + 1, 5) for p in STEPS[number]]
        stub = LATER_STUB.search(reason["detail"])
        ended = "returned without ap.succeed()" in reason["detail"]
        done = set(p for number in range(1, step + 1) for p in STEPS[number]) <= set(seen)
        if reason["code"] == "mission_exception" and done and (ended or (stub and int(stub[1]) > step)):
            return  # the pilot ran the states of this step. The owner has not written the next step yet.
        if seen and seen[-1] in later and not (stub and int(stub[1]) <= step):
            return  # the pilot is already working on a later state
        self.fail(self.say(f"The pilot reported a failure inside step {step}: {reason['code']}: {reason['detail']}. "
                           "Read the evidence file. Find which state failed."))

    def assert_clean(self, fake):
        self.assertEqual(fake.violations, [], self.say(
            "The fake autopilot saw a command that came too early. "
            "Wait for the proof in telemetry before each command."))

    def assert_bounded_failure(self, fault, phase, budget):
        fake, result, elapsed = self.exercise(fault)
        self.assertFalse(result["success"], self.say("Do not report success when a state never arrives."))
        self.assertIn(phase, self.phases(result), self.say(f"Enter the state {phase} before this failure."))
        self.assert_clean(fake)
        reason = result["failure_reason"]
        self.assertNotEqual(reason["code"], "mission_exception", self.say(
            "Your code raised an error or ended with no result. "
            f"Give {phase} a time limit. When it ends, call ap.fail() with a specific code."))
        self.assertNotIn("Runner wall-time limit reached", reason["detail"], self.say(
            "The runner time limit stopped the run. Your own state limit must end the wait first."))
        self.assertIn(reported_code(reason), BOUNDED, self.say(f"Use one of these codes: {', '.join(BOUNDED)}."))
        self.assertIn(phase, reason["detail"], self.say(f"Put the state name {phase} in the failure detail."))
        self.assertLess(elapsed, budget, self.say(f"End the wait in {phase} inside its budget."))
        return fake, result


class Step1Tests(PilotCase):
    """Step 1: CONNECT and WAIT_READY."""

    def test_step1_connect_and_wait_ready(self):
        fake, result, _ = self.exercise()
        self.assert_steps_reached(result, 1)
        self.assert_no_failure_in_step(result, 1)
        self.assertTrue(fake.ready_observed, self.say(
            "Stay in WAIT_READY until GPS and the EKF show that the autopilot can arm."))
        self.assert_clean(fake)

    def test_step1_missing_heartbeat_ends_in_time(self):
        self.assert_bounded_failure("no_heartbeat", "CONNECT", 5)

    def test_step1_readiness_never_arrives(self):
        self.assert_bounded_failure("not_ready", "WAIT_READY", 5)


class Step2Tests(PilotCase):
    """Step 2: SET_GUIDED and ARM."""

    def test_step2_guided_and_arm_confirmed(self):
        fake, result, _ = self.exercise()
        self.assert_steps_reached(result, 2)
        self.assert_no_failure_in_step(result, 2)
        self.assertTrue(fake.guided_observed, self.say("Confirm GUIDED in a heartbeat."))
        self.assertTrue(fake.arm_observed, self.say("Confirm the armed bit in a heartbeat before you leave ARM."))
        self.assert_clean(fake)

    def test_step2_guided_never_arrives(self):
        self.assert_bounded_failure("mode_stuck", "SET_GUIDED", 5)

    def test_step2_ack_accepted_but_not_armed(self):
        self.assert_bounded_failure("arm_stuck", "ARM", 5)

    def test_step2_arm_denied(self):
        self.assert_bounded_failure("arm_denied", "ARM", 5)


class Step3Tests(PilotCase):
    """Step 3: TAKEOFF, CLIMB and HOLD."""

    def test_step3_takeoff_climb_hold(self):
        fake, result, _ = self.exercise()
        self.assert_steps_reached(result, 3)
        self.assert_no_failure_in_step(result, 3)
        self.assertIsNotNone(fake.reached_at, self.say("Reach at least 4.75 m relative height."))
        self.assertGreaterEqual(hold_us(result), 5_000_000, self.say(
            "Hold for at least 5 seconds after you enter HOLD. Keep reading telemetry during the hold."))
        self.assert_clean(fake)

    def test_step3_climb_never_reaches_height(self):
        self.assert_bounded_failure("climb_stuck", "CLIMB", 5)

    def test_step3_telemetry_stops_after_takeoff(self):
        self.assert_bounded_failure("telemetry_lost", "CLIMB", 5)

    def test_step3_telemetry_stops_during_hold(self):
        fake, _ = self.assert_bounded_failure("telemetry_lost_hold", "HOLD", 12)
        self.assertIsNotNone(fake.reached_at, self.say("The fault starts after the climb. Reach the height first."))


class Step4Tests(PilotCase):
    """Step 4: LAND, WAIT_DISARM and the complete mission."""

    def test_step4_complete_mission(self):
        fake, result, elapsed = self.exercise()
        self.assertTrue(result["success"], self.say(f"The mission did not finish: {result['failure_reason']}"))
        self.assertEqual(self.phases(result), list(PHASES), self.say("Enter all nine states once, in order."))
        self.assert_clean(fake)
        self.assertTrue(fake.arm_observed and fake.disarm_observed, self.say("Confirm arm and disarm in heartbeats."))
        self.assertGreaterEqual(fake.land_at - fake.reached_at, 5.0, self.say("Land only after the 5 second hold."))
        times = {e["kind"]: e["t_us"] for e in result["events"] if e["kind"] in PHASES}
        self.assertGreaterEqual(times["LAND"] - times["HOLD"], 5_000_000, self.say("HOLD lasts 5 seconds."))
        commands = [item[0] for item in fake.commands]
        self.assertLess(commands.index(400), commands.index(22), self.say("Arm before takeoff."))
        self.assertLess(elapsed, 20)

    def test_step4_disarm_never_arrives(self):
        self.assert_bounded_failure("disarm_stuck", "WAIT_DISARM", 14)


if __name__ == "__main__":
    unittest.main()
