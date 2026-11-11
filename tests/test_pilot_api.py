"""Check the pilot interface equipment: codec, Autopilot API, child launcher and runner --pilot.

These tests contain no mission. The throwaway pilots below only read telemetry and report.
"""
import io
import json
import struct
import tempfile
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))  # tests import m1_support by name
from lab import mavlite
from lab.link import Connection, Evidence
from lab.mission_io import MissionClient
from lab.pilot_api import PROFILES, Autopilot, load_pilot, pilot_command
from lab.run import main as run_main, run
from m1_support import FakeAutopilot, Message, metadata, read_selected_tlog

# Packets from the first real SITL flight (simulator data only).
REAL = {
    "heartbeat": "fd090000070101000000000000000203510303a120",
    "gps": "fd28000081010118000038c43901000000009efeebeacbcee8589ae908007900c80000000000060a9ae908002c0100002c019855",
    "ekf": "fd160000df0101c100000000000077e7283c8401a036dd75f33c000000003f03b35f",
    "ack": "fd0a00002f01014d00009001000000000000ffe6caaf",
    "text": "fd0e0000320101fd00000641726d696e67206d6f746f727332d4",
    "position": "fd1c00000201012100004fc900009ffeebeacacee8588efa0800ff1000000000000085ffcf893917",
}


class CodecTests(unittest.TestCase):
    def test_decode_real_packets(self):
        hb = mavlite.decode(bytes.fromhex(REAL["heartbeat"]))
        self.assertEqual((hb.type, hb.system_status, hb.custom_mode), ("HEARTBEAT", 3, 0))
        self.assertEqual(mavlite.decode(bytes.fromhex(REAL["gps"])).fix_type, 6)
        self.assertTrue(mavlite.decode(bytes.fromhex(REAL["ekf"])).flags & mavlite.EKF_POS_HORIZ_ABS)
        ack = mavlite.decode(bytes.fromhex(REAL["ack"]))
        self.assertEqual((ack.command, ack.result), (400, 0))
        self.assertEqual(mavlite.decode(bytes.fromhex(REAL["text"])).text, "Arming motors")
        self.assertGreater(mavlite.decode(bytes.fromhex(REAL["position"])).relative_alt, 4000)

    def test_pretty_is_one_safe_line(self):
        text = mavlite.decode(bytes.fromhex(REAL["ack"])).pretty()
        self.assertEqual(text, "COMMAND_ACK command=400 result=0 (ACCEPTED)")
        message = mavlite.Message(253, "STATUSTEXT", {"severity": 6, "text": "a\nb\x1b[31m"})
        self.assertNotIn("\n", message.pretty())
        self.assertNotIn("\x1b", message.pretty())

    def test_bad_checksum_and_unknown_message(self):
        raw = bytearray.fromhex(REAL["ack"])
        raw[-1] ^= 1
        with self.assertRaises(ValueError):
            mavlite.decode(bytes(raw))
        with self.assertRaises(ValueError):
            mavlite.decode(b"\x00\x01")
        unknown = b"\xfd" + bytes([1, 0, 0, 0, 1, 1]) + (9).to_bytes(3, "little") + b"\x01\x00\x00"
        self.assertIsNone(mavlite.decode(unknown))

    def test_message_field_errors_name_the_field(self):
        hb = mavlite.decode(bytes.fromhex(REAL["heartbeat"]))
        with self.assertRaises(AttributeError) as error:
            hb.relative_alt
        self.assertIn("relative_alt", str(error.exception))

    def test_encode_round_trip_through_split(self):
        packet = mavlite.encode_command_long(mavlite.CMD_NAV_TAKEOFF, (0, 0, 0, 0, 0, 0, 5), sequence=3)
        msgid, sysid, compid, payload = mavlite.split_packet(packet)
        values = struct.unpack("<7fHBBB", payload.ljust(33, b"\0"))
        self.assertEqual((msgid, sysid, compid), (76, 255, 190))
        self.assertEqual((values[6], values[7], values[8], values[9]), (5.0, 22, 1, 1))
        mode = mavlite.split_packet(mavlite.encode_set_mode(mavlite.MODE_GUIDED))
        self.assertEqual(struct.unpack("<IBB", mode[3].ljust(6, b"\0")), (4, 1, 1))
        with self.assertRaises(ValueError):
            mavlite.encode_command_long(1, range(8))


class FakeClient:
    """Stand-in for MissionClient. It returns queued packets, then None."""

    def __init__(self, packets):
        self.packets, self.sent, self.events, self.outcomes = list(packets), [], [], []

    def receive(self, message_type, timeout):
        return self.packets.pop(0) if self.packets else None

    def send(self, packet):
        self.sent.append(packet)

    def event(self, kind):
        self.events.append(kind)

    def outcome(self, *args):
        self.outcomes.append(args)


class AutopilotTests(unittest.TestCase):
    def test_acks_and_statustext_are_visible_and_stored(self):
        client = FakeClient([bytes.fromhex(REAL[n]) for n in ("heartbeat", "ack", "text", "position")])
        log = io.StringIO()
        ap = Autopilot(client, log_stream=log)
        message = ap.receive("GLOBAL_POSITION_INT", 1.0)
        self.assertEqual(message.type, "GLOBAL_POSITION_INT")
        self.assertEqual([m.type for m in ap.acks], ["COMMAND_ACK"])
        self.assertEqual(ap.texts[0].text, "Arming motors")
        self.assertIn("HEARTBEAT", ap.latest)
        self.assertIn("[ack] COMMAND_ACK command=400", log.getvalue())
        self.assertIn("[text] STATUSTEXT", log.getvalue())

    def test_receive_returns_none_after_timeout_and_validates_type(self):
        ticks = iter(range(100))
        ap = Autopilot(FakeClient([]), log_stream=io.StringIO(), clock=lambda: next(ticks) * 0.5)
        self.assertIsNone(ap.receive("HEARTBEAT", 1.0))
        with self.assertRaises(ValueError):
            ap.receive("NOT_A_MESSAGE")

    def test_commands_phase_and_outcome(self):
        client = FakeClient([])
        ap = Autopilot(client, log_stream=io.StringIO())
        ap.send_command(mavlite.CMD_COMPONENT_ARM_DISARM, 1)
        ap.set_mode(mavlite.MODE_GUIDED)
        ap.phase("ARM")
        ap.fail("timeout", "ARM: no proof")
        self.assertEqual(len(client.sent), 2)
        self.assertEqual(mavlite.split_packet(client.sent[0])[0], 76)
        self.assertEqual((client.events, ap.step), (["ARM"], 2))
        self.assertEqual(client.outcomes, [(False, "timeout", "ARM: no proof")])

    def test_profiles_hold_five_seconds_and_sitl_allows_real_readiness_time(self):
        for profile in PROFILES.values():
            self.assertEqual(profile.hold_s, 5.0)
        self.assertGreater(PROFILES["sitl"].ready_s, 60)  # the real flight needed 37 s


class PilotFolder:
    """Make a throwaway pilot folder in a temp directory."""

    def __init__(self, code, interface="PLATFORM_INTERFACE = 1\n"):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name)
        (self.path / "mission.py").write_text(interface + code)

    def close(self):
        self.dir.cleanup()


READ_ONLY_PILOT = '''
def run(ap, budgets):
    print("this line goes to stdout")  # must not damage the protocol
    ap.phase("CONNECT")
    ap.receive("HEARTBEAT", 1)
    ap.receive("GLOBAL_POSITION_INT", 1)
    while not ap.texts:
        if ap.receive(None, 1) is None:
            return ap.fail("timeout", "CONNECT: no STATUSTEXT")
    ap.succeed()
'''


class RunnerPilotTests(unittest.TestCase):
    def pilot(self, code, **kwargs):
        folder = PilotFolder(code, **kwargs)
        self.addCleanup(folder.close)
        return folder.path

    def run_pilot(self, path):
        command, env = pilot_command(path, "fake")
        fake = FakeAutopilot()
        with tempfile.TemporaryDirectory() as root:
            run_path, result = run(root, metadata("pilot-api"), command, factory=lambda _: fake, timeout=10, env=env)
            stderr = (run_path / "mission.stderr").read_text()
            records = read_selected_tlog(run_path / "flight.tlog")
            aux = (run_path / "aux.tlog").read_bytes()
        return fake, result, stderr, records, aux

    def test_runner_loads_external_pilot_and_keeps_stdout_safe(self):
        fake, result, stderr, records, aux = self.run_pilot(self.pilot(READ_ONLY_PILOT))
        self.assertTrue(result["success"], result)
        self.assertIn("this line goes to stdout", stderr)
        self.assertIn("[text] STATUSTEXT", stderr)
        self.assertEqual({r[1] for r in records}, {0, 33})  # accepted run format v1 is unchanged
        self.assertIn(b"EKF3 IMU0 is using GPS", aux)       # diagnostics go to aux.tlog
        self.assertEqual(fake.commands, [])

    def test_exception_shows_traceback_and_location(self):
        path = self.pilot("def run(ap, budgets):\n    ap.phase('CONNECT')\n    raise KeyError('oops')\n")
        _, result, stderr, _, _ = self.run_pilot(path)
        self.assertIn("mission_exception", result["failure_reason"]["detail"] + result["failure_reason"]["code"])
        self.assertIn("Traceback", stderr)
        self.assertIn("KeyError: 'oops'", stderr)
        self.assertIn("mission.py:4", result["failure_reason"]["detail"])

    def test_bad_pilot_folders_are_rejected(self):
        with tempfile.TemporaryDirectory() as empty:
            with self.assertRaises(ValueError):
                pilot_command(empty)
        with self.assertRaises(ValueError):
            pilot_command(self.pilot("def run(ap, budgets): pass\n"), "unknown")
        with self.assertRaises(ValueError):
            load_pilot(self.pilot("def run(ap, budgets): pass\n", interface="PLATFORM_INTERFACE = 9\n"))
        with self.assertRaises(ValueError):
            load_pilot(self.pilot("x = 1\n"))

    def test_cli_pilot_option(self):
        with tempfile.TemporaryDirectory() as empty, patch("sys.stderr", io.StringIO()), \
                self.assertRaises(SystemExit) as stop:
            run_main(["--run-id", "x", "--seed", "1", "--scenario", "s", "--mode", "offline",
                      "--input-source", "runner", "--input-source", "autopilot",
                      "--ardupilot-version", "v", "--container", "c@sha256:" + "a" * 64,
                      "--pilot", empty])
        self.assertEqual(stop.exception.code, 2)  # no mission.py in the folder
        with patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit) as stop:
            run_main(["--run-id", "x", "--seed", "1", "--scenario", "s", "--mode", "offline",
                      "--input-source", "runner", "--input-source", "autopilot",
                      "--ardupilot-version", "v", "--container", "c@sha256:" + "a" * 64,
                      "--pilot", ".", "--", "true"])
        self.assertEqual(stop.exception.code, 2)  # both --pilot and a command


class DiagnosticRecordingTests(unittest.TestCase):
    def test_runner_delivers_ack_and_records_to_sidecar_only(self):
        ack = bytes.fromhex(REAL["ack"])
        text = bytes.fromhex(REAL["text"])
        heartbeat = bytes.fromhex(REAL["heartbeat"])

        class Transport:
            def __init__(self):
                self.queue = [heartbeat, ack, text]

            def recv_match(self, blocking=False):
                return Message(self.queue.pop(0)) if self.queue else None

            def write(self, packet):
                pass

            def close(self):
                pass

        with tempfile.TemporaryDirectory() as root:
            evidence = Evidence(root, metadata("diag"))
            connection = Connection(Transport(), evidence)
            self.assertEqual(connection.receive("COMMAND_ACK", 0.2)["type"], "COMMAND_ACK")
            self.assertEqual(connection.receive("STATUSTEXT", 0.2)["type"], "STATUSTEXT")
            evidence.aux.flush()
            aux = (evidence.path / "aux.tlog").read_bytes()
            self.assertEqual(len(aux), 2 * 8 + len(ack) + len(text))
            evidence.tlog.close()
            evidence.aux.close()


if __name__ == "__main__":
    unittest.main()
