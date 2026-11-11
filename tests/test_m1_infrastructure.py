"""Check the M1 test equipment without a learner flight solution."""
import base64
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))  # tests import m1_support by name
from lab.link import packet_info
from lab.mission_io import MissionClient
from lab.mission_child import main as child_main
from lab.run import run
from m1_support import FakeAutopilot, metadata, read_selected_tlog, unpack_wire, wire


class ClientTests(unittest.TestCase):
    def client(self, *responses):
        reader = io.StringIO("\n".join(json.dumps(item) for item in (
            {"protocol": "m1-child-v1", "seed": 42}, *responses)) + "\n")
        writer = io.StringIO()
        return MissionClient(reader, writer), writer

    def test_receive_send_event_and_terminal_outcome(self):
        packet = wire(0, struct.pack("<IBBBBB", 0, 2, 3, 1, 3, 3))
        client, writer = self.client(
            {"type": "HEARTBEAT", "packet": base64.b64encode(packet).decode()},
            {"sent": len(packet)}, {"recorded": True})
        self.assertEqual(client.receive("HEARTBEAT", 0.2), packet)
        client.send(packet)
        client.event("equipment_check")
        client.outcome(True)
        requests = [json.loads(line) for line in writer.getvalue().splitlines()]
        self.assertEqual([item["op"] for item in requests], ["receive", "send", "event", "outcome"])
        self.assertEqual(requests[-1], {"op": "outcome", "success": True, "failure_reason": None})
        with self.assertRaises(ValueError):
            client.event("after_outcome")

    def test_empty_receive_and_failed_outcome(self):
        client, writer = self.client({"packet": None})
        self.assertIsNone(client.receive(timeout=0))
        client.outcome(False, "timeout", "Equipment test timeout")
        self.assertEqual(json.loads(writer.getvalue().splitlines()[-1])["failure_reason"]["code"], "timeout")

    def test_reject_invalid_waits_before_writing(self):
        for timeout in (-1, 6, True, float("inf"), float("nan"), "1"):
            with self.subTest(timeout=timeout):
                client, writer = self.client()
                with self.assertRaises(ValueError):
                    client.receive(timeout=timeout)
                self.assertEqual(writer.getvalue(), "")

    def test_reject_invalid_protocol_and_response(self):
        for line in ('{}\n', '[]\n', '', '{"protocol":"m1-child-v1"}'):
            with self.subTest(line=line), self.assertRaises(ValueError):
                MissionClient(io.StringIO(line), io.StringIO())
        client, _ = self.client({"type": "HEARTBEAT", "packet": "!"})
        with self.assertRaises(ValueError):
            client.receive()


class EquipmentTests(unittest.TestCase):
    def test_tlog_reader_rejects_incomplete_records(self):
        heartbeat = wire(0, struct.pack("<IBBBBB", 0, 2, 3, 1, 3, 3))
        record = struct.pack(">Q", 123) + heartbeat
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "flight.tlog"
            for content in (record[:3], record[:9], record[:-1], record[:8] + b"xx"):
                with self.subTest(content=content):
                    path.write_bytes(content)
                    with self.assertRaises(ValueError):
                        read_selected_tlog(path)
            path.write_bytes(record)
            self.assertEqual(read_selected_tlog(path), [(123, 0, heartbeat[6:-2])])

    def test_fake_telemetry_passes_independent_runner_crc(self):
        fake = FakeAutopilot()
        heartbeat = packet_info(fake.recv_match().get_msgbuf())
        position = packet_info(fake.recv_match().get_msgbuf())
        self.assertEqual((heartbeat[0], position[0]), (0, 33))
        self.assertEqual(struct.unpack("<i", position[1][16:20])[0], 0)
        self.assertFalse(fake.ready_observed, "STANDBY and a heartbeat do not mean ready")
        fake.close()
        self.assertIsNone(fake.recv_match())

    def test_fake_rejects_early_takeoff_and_land(self):
        fake = FakeAutopilot(clock=lambda: 0.0)
        fake.write(wire(76, struct.pack("<7fHBBB", 0, 0, 0, 0, 0, 0, 5, 22, 1, 1, 0)))
        fake.write(wire(76, struct.pack("<7fHBBB", 0, 0, 0, 0, 0, 0, 0, 21, 1, 1, 0)))
        self.assertEqual(len(fake.violations), 2)

    def test_a_refused_arm_sends_the_reason_before_the_ack(self):
        """Real ArduPilot sends the STATUSTEXT first. A pilot that stops at the ACK still has the reason in its log."""
        for fault, text in (("arm_denied", b"PreArm: Compass not healthy"), (None, b"Arm: Need Position Estimate")):
            fake = FakeAutopilot(fault, clock=lambda: 0.0)
            if fault:
                fake.ready_observed = fake.guided_observed = True
                fake.mode = 4
            fake.write(wire(76, struct.pack("<7fHBBB", 1, 0, 0, 0, 0, 0, 0, 400, 1, 1, 0)))
            ids = [unpack_wire(packet)[0] for packet in fake.pending]
            self.assertEqual(ids, [253, 77], fault)
            self.assertIn(text, unpack_wire(fake.pending[0])[1])
            self.assertEqual(unpack_wire(fake.pending[1])[1][2], 4, "ACK result 4 is FAILED")

    def test_fake_faults_and_elapsed_altitude(self):
        now = [0.0]
        fake = FakeAutopilot(clock=lambda: now[0])
        fake.takeoff_at = 0.0
        now[0] = 0.2
        fake.recv_match()
        self.assertEqual(fake.altitude, 5000)
        self.assertEqual(fake.reached_at, 0.2)
        fake.pending.clear()
        fake.land_at = 5.2
        fake.armed = True
        now[0] = 5.5
        while True:
            fake.recv_match()
            if not fake.pending:
                break
        self.assertTrue(fake.disarm_observed)
        for fault in ("no_heartbeat", "telemetry_lost"):
            broken = FakeAutopilot(fault)
            broken.takeoff_at = 0.0
            self.assertIsNone(broken.recv_match())
        for packet in (b"", b"\xfe", wire(0, b"bad")[:-1]):
            with self.assertRaises(ValueError):
                unpack_wire(packet)

    def test_runner_protocol_without_flight_commands(self):
        child = """from lab.mission_io import MissionClient
client = MissionClient()
client.receive('HEARTBEAT', 0.2)
client.receive('GLOBAL_POSITION_INT', 0.2)
client.event('equipment_check')
client.outcome(True)
"""
        fake = FakeAutopilot()
        with tempfile.TemporaryDirectory() as root:
            path, result = run(root, metadata("equipment"), [sys.executable, "-c", child],
                               factory=lambda _: fake, timeout=2)
            self.assertTrue(result["success"], result)
            self.assertTrue((path / "invocation.json").exists())
            records = read_selected_tlog(path / "flight.tlog")
            self.assertEqual([item[1] for item in records], [0, 33])
            self.assertLessEqual(records[0][0], records[1][0])
        self.assertEqual(fake.commands, [])
        self.assertTrue(fake.closed)

    def test_launcher_reports_missing_outcome(self):
        client, writer = ClientTests().client()
        with patch("lab.mission_child.MissionClient", return_value=client), \
                patch("lab.mission_child.pilot_api.load_pilot", return_value=lambda ap, budgets: None), \
                patch("sys.stderr", io.StringIO()):
            child_main(["--pilot", "unused", "--profile", "fake"])
        outcome = json.loads(writer.getvalue())
        self.assertFalse(outcome["success"])
        self.assertEqual(outcome["failure_reason"]["code"], "mission_exception")

    def test_launcher_rejects_invalid_profile(self):
        client, writer = ClientTests().client()
        with patch("lab.mission_child.MissionClient", return_value=client), \
                patch("lab.mission_child.pilot_api.load_pilot") as load, \
                patch("sys.stderr", io.StringIO()):
            child_main(["--pilot", "unused", "--profile", "invalid"])
        load.assert_not_called()
        self.assertEqual(json.loads(writer.getvalue())["failure_reason"]["code"], "mission_exception")


if __name__ == "__main__":
    unittest.main()
