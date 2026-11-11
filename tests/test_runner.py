import base64
import json
import os
from pathlib import Path
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from lab.link import Connection, Evidence, RunFailure, packet_info
from lab.run import run, _json, main
from lab.power import ACState, WallPowerGuard


def packet(msgid, *, v2=False, boot=10, system=1, payload=None):
    """Independent bit-at-a-time CRC fixture, not the producer algorithm."""
    if payload is None:
        payload = struct.pack("<IBBBBB", 0, 2, 3, 0, 4, 3) if msgid == 0 else struct.pack("<IiiiihhhH", boot, 0, 0, 0, 1234, 0, 0, 0, 0)
    body = (bytes([len(payload), 0, 0, 7, system, 1]) + msgid.to_bytes(3, "little") if v2
            else bytes([len(payload), 7, system, 1, msgid])) + payload
    crc = 65535
    for value in body + bytes([50 if msgid == 0 else 104]):
        crc ^= value
        for _ in range(8):
            crc = (crc >> 1) ^ (0x8408 if crc & 1 else 0)
    return bytes([253 if v2 else 254]) + body + struct.pack("<H", crc)


def metadata(run_id="synthetic"):
    return dict(run_id=run_id, seed=0, scenario={"name": "synthetic-plumbing"}, mode="offline",
                versions={"ardupilot": "synthetic-fake-not-SITL", "container": "synthetic-not-a-real-image@sha256:" + "a" * 64},
                git={"commit": "b" * 40, "dirty": True}, host="synthetic-host",
                input_sources=["runner", "autopilot"])


class Message:
    def __init__(self, data):
        self.data = data

    def get_msgbuf(self):
        return self.data


class Fake:
    def __init__(self, packets=()):
        self.packets = list(packets)
        self.closed = False
        self.sent = []

    def recv_match(self, blocking=False):
        assert blocking is False
        return Message(self.packets.pop(0)) if self.packets else None

    def write(self, data):
        self.sent.append(data)

    def close(self):
        self.closed = True


RECEIVE_TWO = '''
import sys,json
json.loads(sys.stdin.readline())
for _ in range(2):
 print(json.dumps(dict(op="receive",type=None,timeout=0.1)),flush=True)
 json.loads(sys.stdin.readline())
'''
SUCCESS = 'print(\'{"op":"outcome","success":true,"failure_reason":null}\',flush=True)\n'


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def execute(self, child, packets=(), **kwargs):
        fake = Fake(packets)
        path, result = run(self.root, metadata(), [sys.executable, "-u", "-c", child],
                           factory=lambda endpoint: fake, timeout=kwargs.pop("timeout", 2), **kwargs)
        self.assertTrue(fake.closed)
        self.assertEqual(json.loads((path / "result.json").read_text()), result)
        self.assertEqual(result["events"][-1]["t_us"], result["duration_us"])
        self.assertGreaterEqual(result["duration_us"], result["events"][0]["t_us"])
        return path, result

    def test_success_and_exact_packet_preservation(self):
        packets = [packet(0), packet(33, v2=True)]
        path, result = self.execute(RECEIVE_TWO + SUCCESS, packets)
        self.assertTrue(result["success"])
        self.assertEqual(result["tlog_records"], 2)
        data = (path / "flight.tlog").read_bytes()
        start = json.loads((path / "manifest.json").read_text())["started_unix_us"]
        prior = start
        for expected in packets:
            stamp = struct.unpack(">Q", data[:8])[0]
            self.assertTrue(prior <= stamp <= start + result["duration_us"])
            self.assertEqual(data[8:8 + len(expected)], expected)
            data = data[8 + len(expected):]
            prior = stamp
        self.assertFalse(data)

    def test_connection_failure_and_no_overwrite(self):
        def broken(endpoint):
            raise OSError("synthetic transport failure")
        path, result = run(self.root, metadata(), ["unused"], factory=broken)
        self.assertEqual(result["failure_reason"]["code"], "connection_failed")
        self.assertIn("synthetic transport failure", result["failure_reason"]["detail"])
        self.assertEqual((path / "flight.tlog").read_bytes(), b"")
        snapshot = (path / "result.json").read_bytes()
        with self.assertRaises(FileExistsError):
            run(self.root, metadata(), ["unused"], factory=broken)
        self.assertEqual(snapshot, (path / "result.json").read_bytes())

    def test_missing_executable_is_preserved(self):
        _, result = run(self.root, metadata(), ["/definitely/missing/m1-mission"], factory=lambda _: Fake())
        self.assertEqual(result["failure_reason"]["code"], "runner_error")
        self.assertIn("Launching mission", result["failure_reason"]["detail"])

    def test_claimed_success_requires_telemetry(self):
        _, result = self.execute(SUCCESS)
        self.assertFalse(result["success"])
        self.assertEqual(result["failure_reason"]["code"], "runner_error")

    def test_child_nonzero_overrides_claim(self):
        _, result = self.execute(RECEIVE_TWO + SUCCESS + "raise SystemExit(7)", [packet(0), packet(33)])
        self.assertEqual(result["failure_reason"]["code"], "mission_exception")
        self.assertIn("exited 7", result["failure_reason"]["detail"])

    def test_failed_outcome(self):
        child = RECEIVE_TWO + 'print(\'{"op":"outcome","success":false,"failure_reason":{"code":"readiness_failed","detail":"synthetic refusal"}}\',flush=True)'
        _, result = self.execute(child, [packet(0), packet(33)])
        self.assertEqual(result["failure_reason"]["code"], "readiness_failed")

    def test_timeout_inside_receive(self):
        child = 'import sys; sys.stdin.readline(); print(\'{"op":"receive","type":null,"timeout":5}\',flush=True); sys.stdin.readline()'
        start = time.monotonic()
        _, result = self.execute(child, timeout=0.12)
        self.assertLess(time.monotonic() - start, 1.5)
        self.assertIn("timeout", result["failure_reason"]["detail"])

    def test_protocol_requires_utf8(self):
        with self.assertRaises(UnicodeError):
            _json('{"op":"event"}'.encode("utf-16"))

    def test_receive_preserves_interrupt_failure(self):
        class InterruptedFake(Fake):
            def recv_match(self, blocking=False):
                raise RunFailure("interrupted", "signal during receive")
        _, result = run(self.root, metadata(), [sys.executable, "-u", "-c", RECEIVE_TWO],
                        factory=lambda _: InterruptedFake(), timeout=2)
        self.assertEqual(result["failure_reason"]["code"], "interrupted")

    def test_guard_refusal_before_connection(self):
        called = []
        def guard(phase, process):
            called.append(phase)
            raise RunFailure("ac_unavailable", "synthetic guard refusal")
        _, result = run(self.root, metadata(), ["unused"], guard=guard,
                        factory=lambda _: self.fail("connection must not open"))
        self.assertEqual(called, ["before_connect"])
        self.assertEqual(result["failure_reason"]["code"], "ac_unavailable")

    def test_guard_abort_reaps_child(self):
        processes = []
        def guard(phase, process):
            if process is not None:
                processes.append(process)
                raise RunFailure("ac_lost", "synthetic power loss")
        _, result = self.execute("import time; time.sleep(30)", guard=guard)
        self.assertIsNotNone(processes[0].poll())
        self.assertIn("ac_lost", result["failure_reason"]["detail"])

    def test_interrupt_is_preserved(self):
        def guard(phase, process):
            if process:
                os.kill(os.getpid(), signal.SIGTERM)
        _, result = self.execute("import time; time.sleep(30)", guard=guard)
        self.assertEqual(result["failure_reason"]["code"], "interrupted")

    def test_protocol_errors(self):
        for index, child in enumerate(("print('not json')", "print('{}')", "print('x'*5000)",
                                       "print('{\"op\":\"outcome\",\"op\":\"outcome\"}')", "pass")):
            with self.subTest(child=child):
                _, result = run(self.root, metadata(f"bad_{index}"), [sys.executable, "-c", child], factory=lambda _: Fake(), timeout=1)
                self.assertFalse(result["success"])
                self.assertIn("mission_exception", result["failure_reason"]["detail"])

    def test_send_and_events(self):
        child = RECEIVE_TWO + '''
import base64
print(json.dumps(dict(op="send",packet=base64.b64encode(b"fake-wire").decode())),flush=True)
assert json.loads(sys.stdin.readline()) == {"sent":9}
print(json.dumps(dict(op="event",kind="synthetic_note",source="runner")),flush=True)
assert json.loads(sys.stdin.readline()) == {"recorded":True}
''' + SUCCESS
        _, result = self.execute(child, [packet(0), packet(33)])
        self.assertTrue(result["success"])
        self.assertEqual(result["events"][1]["kind"], "synthetic_note")

    def test_wire_filter_corruption_and_boot_rollback(self):
        self.assertIsNone(packet_info(packet(0, system=255)))
        self.assertEqual(packet_info(packet(33, v2=True, payload=b"\x01"))[0], 33)
        corrupt = bytearray(packet(0))
        corrupt[-1] ^= 1
        with self.assertRaises(RunFailure):
            packet_info(corrupt)
        writer = Evidence(self.root, metadata())
        writer.record(packet(33, boot=100))
        with self.assertRaises(RunFailure):
            writer.record(packet(33, boot=99))
        result = writer.finish(RunFailure("connection_failed", "boot rollback"))
        self.assertEqual(result["tlog_records"], 1)

    def test_bounded_heartbeat_and_freshness_with_fake_clock(self):
        now = [0.0]
        writer = Evidence(self.root, metadata())
        fake = Fake()
        link = Connection(fake, writer, clock=lambda: now[0], sleep=lambda n: now.__setitem__(0, now[0] + n))
        self.assertIsNone(link.wait_heartbeat(0.03))
        self.assertFalse(link.heartbeat_fresh())
        fake.packets.extend([packet(0)])
        self.assertIsNotNone(link.wait_heartbeat(0))
        self.assertTrue(link.heartbeat_fresh())
        now[0] += 4
        self.assertFalse(link.heartbeat_fresh())
        writer.finish(RunFailure("timeout", "synthetic timeout"))

    def test_metadata_rejected_before_reservation(self):
        bad = metadata()
        bad["mode"] = "camera"
        with self.assertRaises(ValueError):
            Evidence(self.root, bad)
        self.assertFalse((self.root / "synthetic").exists())

    def test_receive_transport_exception_preserves_prior_packet(self):
        fake = Fake([packet(0)])
        original = fake.recv_match
        def receive(blocking=False):
            if not fake.packets:
                raise OSError("synthetic broken receive")
            return original(blocking)
        fake.recv_match = receive
        path, result = run(self.root, metadata(), [sys.executable, "-u", "-c", RECEIVE_TWO + SUCCESS], factory=lambda _: fake)
        self.assertTrue(fake.closed)
        self.assertEqual(result["tlog_records"], 1)
        self.assertEqual(result["failure_reason"]["code"], "connection_failed")
        self.assertIn("synthetic broken receive", result["failure_reason"]["detail"])
        self.assertGreater((path / "flight.tlog").stat().st_size, 8)

    def test_close_failure_overrides_success(self):
        fake = Fake([packet(0), packet(33)])
        def close():
            raise OSError("synthetic close failure")
        fake.close = close
        _, result = run(self.root, metadata(), [sys.executable, "-u", "-c", RECEIVE_TWO + SUCCESS], factory=lambda _: fake)
        self.assertEqual(result["failure_reason"]["code"], "runner_error")
        self.assertIn("Transport close", result["failure_reason"]["detail"])

    def test_event_budget_still_finalizes_valid_json(self):
        writer = Evidence(self.root, metadata())
        with self.assertRaises(RunFailure):
            for _ in range(2000):
                writer.event("\u0800" * 300)
        result = writer.finish(RunFailure("runner_error", "synthetic event budget"))
        self.assertLess((writer.path / "result.json").stat().st_size, 1048576)
        self.assertFalse(result["success"])

    def test_process_group_kills_descendant_after_leader_exit(self):
        pidfile = self.root / "descendant.pid"
        child = ('import subprocess,sys; '
                 'p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"],stdout=subprocess.DEVNULL); '
                 f'open({str(pidfile)!r},"w").write(str(p.pid)); ' + SUCCESS)
        _, result = self.execute(child)
        pid = int(pidfile.read_text())
        # An orphan may briefly remain as a zombie until the host reaps it;
        # either absent or zombie means it can no longer execute.
        for _ in range(50):
            stat = Path(f"/proc/{pid}/stat")
            if not stat.exists() or stat.read_text().split()[2] == "Z":
                break
            time.sleep(0.01)
        else:
            self.fail("descendant still executing after cleanup")
        self.assertFalse(result["success"])

    def test_cli_connection_refusal_records_real_provenance(self):
        argv = [sys.executable, "-m", "lab.run", "--runs", str(self.root), "--run-id", "cli", "--seed", "0",
                "--scenario", "synthetic-cli-refusal", "--mode", "offline", "--input-source", "runner", "--input-source", "autopilot",
                "--ardupilot-version", "synthetic-not-connected", "--container", "synthetic@sha256:" + "a" * 64,
                "--endpoint", "udpin:0.0.0.0:14550", "--", sys.executable, "-c", "pass"]
        with patch("lab.run.WallPowerGuard", return_value=WallPowerGuard(lambda: ACState.UNKNOWN)), patch("builtins.print"):
            self.assertEqual(main(argv[3:]), 1)
        manifest = json.loads((self.root / "cli/manifest.json").read_text())
        self.assertRegex(manifest["git"]["commit"], r"^[a-f0-9]{40}$")
        self.assertEqual(json.loads((self.root / "cli/result.json").read_text())["failure_reason"]["code"], "ac_unavailable")

    def test_plv_synthetic_end_to_end(self):
        plv = os.environ.get("PLV") or shutil.which("plv")
        local = Path(__file__).resolve().parents[1] / "validator/target/debug/plv"
        plv = plv or (str(local) if local.is_file() else None)
        if not plv:
            self.skipTest("accepted plv not available; set PLV to its existing binary")
        for index, (child, packets, expected) in enumerate(((RECEIVE_TWO + SUCCESS, [packet(0), packet(33)], 0), ("raise SystemExit(9)", [], 1))):
            path, _ = run(self.root, metadata(f"plv_{index}"), [sys.executable, "-u", "-c", child], factory=lambda _: Fake(packets))
            checked = subprocess.run([plv, "check", str(path)], capture_output=True, text=True)
            self.assertEqual(checked.returncode, expected, checked.stdout + checked.stderr)
        for index, code in enumerate(("timeout", "connection_failed", "readiness_failed", "command_rejected", "mission_exception", "ac_unavailable", "ac_lost", "interrupted", "runner_error")):
            # Exercise every accepted failure reason through the child protocol.
            reason = json.dumps(dict(op="outcome", success=False, failure_reason=dict(code=code, detail="synthetic failure")))
            child = RECEIVE_TWO + f"print({reason!r},flush=True)"
            path, result = run(self.root, metadata(f"reason_{index}"), [sys.executable, "-u", "-c", child], factory=lambda _: Fake([packet(0), packet(33)]))
            self.assertEqual(result["failure_reason"]["code"], code)
            checked = subprocess.run([plv, "check", str(path)], capture_output=True, text=True)
            self.assertEqual(checked.returncode, 1, checked.stdout + checked.stderr)


if __name__ == "__main__":
    unittest.main()
