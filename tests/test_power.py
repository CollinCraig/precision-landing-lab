import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, call, patch

from lab.link import RunFailure
from lab.power import ACState, WallPowerGuard, read_ac
from lab.run import main, run, stop_child
from test_runner import Fake, metadata, packet, RECEIVE_TWO, SUCCESS


class PowerTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def supply(self, name="AC", kind="Mains", online="1"):
        path = self.root / name
        path.mkdir()
        (path / "type").write_text(kind + "\n")
        if online is not None:
            (path / "online").write_text(online + "\n")
        return path

    def test_missing_sources_are_unknown(self):
        self.assertIs(read_ac(self.root / "missing"), ACState.UNKNOWN)
        self.assertIs(read_ac(self.root), ACState.UNKNOWN)
        self.supply(kind="Battery")
        self.assertIs(read_ac(self.root), ACState.UNKNOWN)

    def test_malformed_sources_are_unknown(self):
        path = self.supply(online=None)
        self.assertIs(read_ac(self.root), ACState.UNKNOWN)
        for data in (b"", b"yes\n", b"2", b"1\n0", b"\xff", b"1" * 65):
            with self.subTest(data=data):
                (path / "online").write_bytes(data)
                self.assertIs(read_ac(self.root), ACState.UNKNOWN)
        (path / "type").unlink()
        self.assertIs(read_ac(self.root), ACState.UNKNOWN)
        with patch("lab.power.os.scandir", side_effect=PermissionError):
            self.assertIs(read_ac(self.root), ACState.UNKNOWN)

    def test_online_offline_and_multiple_sources(self):
        path = self.supply(online="0")
        self.assertIs(read_ac(self.root), ACState.OFFLINE)
        (path / "online").write_text("1\n")
        self.assertIs(read_ac(self.root), ACState.ONLINE)
        self.supply("AC2", online="0")
        self.supply("BAT0", kind="Battery", online=None)
        self.assertIs(read_ac(self.root), ACState.ONLINE)
        (self.root / "AC2/online").write_text("bad")
        self.assertIs(read_ac(self.root), ACState.UNKNOWN)

    def test_guard_phases_and_sticky_failure(self):
        for phase in ("before_connect", "before_launch", "poll"):
            for state in (ACState.OFFLINE, ACState.UNKNOWN, None, True):
                with self.subTest(phase=phase, state=state):
                    source = Mock(side_effect=[state, ACState.ONLINE])
                    guard = WallPowerGuard(source)
                    with self.assertRaises(RunFailure) as first:
                        guard(phase, object())
                    self.assertEqual(first.exception.code, "ac_lost" if phase == "poll" else "ac_unavailable")
                    with self.assertRaises(RunFailure) as second:
                        guard("before_connect", object())
                    self.assertIs(first.exception, second.exception)
                    source.assert_called_once_with()

    def test_callback_does_not_touch_process(self):
        class Untouchable:
            def __getattribute__(self, name):
                raise AssertionError("Guard touched the child")
        source = Mock(return_value=ACState.ONLINE)
        guard = WallPowerGuard(source)
        for phase in ("before_connect", "before_launch", "poll"):
            guard(phase, Untouchable())
        self.assertEqual(source.call_count, 3)
        with self.assertRaises(ValueError):
            guard("invalid", Untouchable())
        broken = WallPowerGuard(Mock(side_effect=OSError("source failed")))
        with self.assertRaises(RunFailure) as caught:
            broken("poll", Untouchable())
        self.assertIn("unknown", caught.exception.detail)

    def test_refusal_does_not_open_transport_or_launch(self):
        for index, state in enumerate((ACState.OFFLINE, ACState.UNKNOWN)):
            with patch("lab.run.subprocess.Popen") as launch:
                factory = Mock()
                path, result = run(self.root, metadata(str(index)), ["unused"], factory=factory,
                                   guard=WallPowerGuard(lambda: state))
                factory.assert_not_called()
                launch.assert_not_called()
                self.assertEqual(result["failure_reason"]["code"], "ac_unavailable")
                self.assertIn(state.value, result["failure_reason"]["detail"])
                self.assertEqual((path / "flight.tlog").read_bytes(), b"")

    def test_loss_before_launch_closes_transport(self):
        source = Mock(side_effect=[ACState.ONLINE, ACState.OFFLINE])
        fake = Fake()
        with patch("lab.run.subprocess.Popen") as launch:
            _, result = run(self.root, metadata(), ["unused"], factory=lambda _: fake,
                            guard=WallPowerGuard(source))
            launch.assert_not_called()
        self.assertTrue(fake.closed)
        self.assertIn("before_launch", result["failure_reason"]["detail"])

    def test_online_fake_run_preserves_success(self):
        source = Mock(return_value=ACState.ONLINE)
        fake = Fake([packet(0), packet(33)])
        _, result = run(self.root, metadata(), [sys.executable, "-u", "-c", RECEIVE_TWO + SUCCESS],
                        factory=lambda _: fake, guard=WallPowerGuard(source), timeout=2)
        self.assertTrue(result["success"])
        self.assertTrue(fake.closed)
        self.assertGreater(source.call_count, 2)

    def test_ac_loss_interrupts_receive(self):
        state = [ACState.ONLINE]
        fake = Fake()
        def receive(blocking=False):
            state[0] = ACState.OFFLINE
            return None
        fake.recv_match = receive
        child = ('import sys; sys.stdin.readline(); '
                 'print(\'{"op":"receive","type":null,"timeout":5}\',flush=True); '
                 'sys.stdin.readline()')
        start = time.monotonic()
        _, result = run(self.root, metadata(), [sys.executable, "-u", "-c", child],
                        factory=lambda _: fake, guard=WallPowerGuard(lambda: state[0]), timeout=3)
        self.assertLess(time.monotonic() - start, 2)
        self.assertIn("ac_lost", result["failure_reason"]["detail"])
        self.assertIn("AC source is offline", result["failure_reason"]["detail"])
        self.assertTrue(fake.closed)

    def test_ac_loss_stops_child_and_descendant(self):
        for index, telemetry in enumerate((False, True)):
            with self.subTest(telemetry=telemetry):
                marker = self.root / f"pids-{index}.json"
                descendant = ('import json,os,signal,time; '
                              'signal.signal(signal.SIGTERM,signal.SIG_IGN); '
                              f'open({str(marker) + ".tmp"!r},"w").write(json.dumps([os.getppid(),os.getpid()])); '
                              f'os.replace({str(marker) + ".tmp"!r},{str(marker)!r}); '
                              'time.sleep(30)')
                child = (RECEIVE_TWO if telemetry else "") + (
                    'import subprocess,sys,signal,time\n'
                    'signal.signal(signal.SIGTERM,signal.SIG_IGN)\n'
                    f'subprocess.Popen([sys.executable,"-c",{descendant!r}])\n')
                if telemetry:
                    child += ('print(\'{"op":"receive","type":null,"timeout":5}\',flush=True)\n'
                              'sys.stdin.readline()\n')
                child += 'time.sleep(30)\n'
                source = lambda: ACState.OFFLINE if marker.exists() and marker.stat().st_size else ACState.ONLINE
                fake = Fake([packet(0), packet(33)] if telemetry else [])
                start = time.monotonic()
                path, result = run(self.root, metadata(str(index)), [sys.executable, "-u", "-c", child],
                                   factory=lambda _: fake, guard=WallPowerGuard(source), timeout=3)
                self.assertLess(time.monotonic() - start, 2)
                reason = result["failure_reason"]
                self.assertEqual(reason["code"], "ac_lost" if telemetry else "runner_error")
                self.assertIn("AC source is offline at poll", reason["detail"])
                if not telemetry:
                    self.assertIn("ac_lost", reason["detail"])
                self.assertEqual(json.loads((path / "result.json").read_text()), result)
                self.assertTrue(fake.closed)
                leader, descendant_pid = json.loads(marker.read_text())
                for pid in (leader, descendant_pid):
                    stat = Path(f"/proc/{pid}/stat")
                    deadline = time.monotonic() + 0.5
                    while stat.exists() and stat.read_text().split()[2] != "Z" and time.monotonic() < deadline:
                        time.sleep(0.01)
                    self.assertTrue(not stat.exists() or stat.read_text().split()[2] == "Z",
                                    f"Process {pid} still executes")
                with self.assertRaises(ChildProcessError):
                    os.waitpid(leader, os.WNOHANG)

    def test_cleanup_retains_group_identity_until_kill(self):
        process = Mock(pid=12345, returncode=None)
        events = Mock()
        events.attach_mock(process.wait, "wait")
        with patch("lab.run.os.killpg", events.signal):
            stop_child(process, grace=0)
        self.assertEqual(events.mock_calls, [call.signal(12345, signal.SIGTERM),
                                            call.signal(12345, signal.SIGKILL), call.wait()])
        process.returncode = 0
        with patch("lab.run.os.killpg") as kill:
            stop_child(process, grace=0)
            kill.assert_not_called()

    def test_default_live_path_installs_guard(self):
        with patch("lab.run.WallPowerGuard", return_value=WallPowerGuard(lambda: ACState.UNKNOWN)) as constructor:
            _, result = run(self.root, metadata(), ["unused"])
        constructor.assert_called_once_with()
        self.assertEqual(result["failure_reason"]["code"], "ac_unavailable")

    def test_cli_installs_guard(self):
        args = ["--runs", str(self.root), "--run-id", "cli", "--seed", "0", "--scenario", "synthetic",
                "--mode", "offline", "--input-source", "runner", "--input-source", "autopilot",
                "--ardupilot-version", "synthetic", "--container", "synthetic@sha256:" + "a" * 64, "--", "unused"]
        with patch("lab.run.WallPowerGuard", return_value=WallPowerGuard(lambda: ACState.UNKNOWN)) as constructor, patch("builtins.print"):
            self.assertEqual(main(args), 1)
        constructor.assert_called_once_with()
        result = json.loads((self.root / "cli/result.json").read_text())
        self.assertEqual(result["failure_reason"]["code"], "ac_unavailable")


if __name__ == "__main__":
    unittest.main()
