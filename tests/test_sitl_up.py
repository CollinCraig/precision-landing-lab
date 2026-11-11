"""Focused tests for scripts/sitl-up and requirements-m1.lock.

The tests use a fake source tree. They never start SITL and never install packages.
"""
import hashlib
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "sitl-up"
LOCK = ROOT / "requirements-m1.lock"
GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid"]


class SitlUpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.src = Path(self.tmp.name) / "ardupilot"
        (self.src / "build/sitl/bin").mkdir(parents=True)
        (self.src / "Tools/autotest/default_params").mkdir(parents=True)
        self.binary = self.src / "build/sitl/bin/arducopter"
        self.binary.write_bytes(b"#!/bin/sh\nexit 0\n")
        self.binary.chmod(0o755)
        (self.src / "Tools/autotest/default_params/copter.parm").write_text("FRAME_CLASS 1\n")
        subprocess.run(["git", "init", "-q", str(self.src)], check=True)
        subprocess.run(GIT + ["-C", str(self.src), "commit", "-q", "--allow-empty", "-m", "x"], check=True)
        self.commit = subprocess.run(["git", "-C", str(self.src), "rev-parse", "HEAD"],
                                     check=True, capture_output=True, text=True).stdout.strip()
        self.sha = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        self.workdir = Path(self.tmp.name) / "work"

    def run_script(self, *args, **env):
        e = dict(os.environ, SITL_SRC_DIR=str(self.src), SITL_SRC_COMMIT=self.commit,
                 SITL_BIN_SHA256=self.sha, SITL_WORKDIR=str(self.workdir))
        e.update(env)
        return subprocess.run([str(SCRIPT), *args], capture_output=True, text=True, env=e, timeout=30)

    def test_print_command_uses_binary_directly(self):
        r = self.run_script("--print")
        self.assertEqual(r.returncode, 0, r.stderr)
        line = " ".join(shlex.split(r.stdout.strip().splitlines()[-1]))
        self.assertTrue(line.startswith(str(self.binary)))
        for part in ["--model +", "--speedup 1", "--sysid 1", "--serial0 tcp:5760", "--wipe",
                     "--home -35.363261,149.165230,584,353", "--defaults " + str(self.src / "Tools/autotest/default_params/copter.parm")]:
            self.assertIn(part, line)
        self.assertNotIn("serial1", line)
        self.assertNotIn("mavproxy", r.stdout.lower())
        self.assertFalse(self.workdir.exists(), "--print must not create the work directory")

    def test_udp_out_and_no_wipe(self):
        r = self.run_script("--print", "--udp-out", "127.0.0.1:14550", "--no-wipe")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("--serial1 udpclient:127.0.0.1:14550", r.stdout)
        self.assertNotIn("--wipe", r.stdout)

    def test_rejects_bad_udp_out(self):
        for bad in ["0.0.0.0:14550", "localhost:14550", "127.0.0.1:80", "127.0.0.1:99999", "127.0.0.1:14550;id"]:
            r = self.run_script("--print", "--udp-out", bad)
            self.assertEqual(r.returncode, 2, bad)
            self.assertEqual(r.stdout, "")

    def test_rejects_unknown_option(self):
        r = self.run_script("--print", "--bogus")
        self.assertEqual(r.returncode, 2)
        self.assertIn("unknown option", r.stderr)

    def test_binary_hash_mismatch_refuses(self):
        r = self.run_script("--print", SITL_BIN_SHA256="0" * 64)
        self.assertEqual(r.returncode, 2)
        self.assertIn("sha256", r.stderr)
        self.assertEqual(r.stdout, "")

    def test_source_commit_mismatch_refuses(self):
        r = self.run_script("--print", SITL_SRC_COMMIT="1" * 40)
        self.assertEqual(r.returncode, 2)
        self.assertIn("commit", r.stderr)

    def test_missing_binary_refuses(self):
        self.binary.unlink()
        r = self.run_script("--print")
        self.assertEqual(r.returncode, 2)
        self.assertIn("binary not found", r.stderr)

    def test_default_pins_name_the_p2_build(self):
        text = SCRIPT.read_text()
        self.assertIn("fb773567896014da007bca58358704d4a0d8516f", text)
        self.assertIn("4caa3e509113eb1622383fa55f11a0078f2526042481095c056a22d04c1b9b95", text)

    def test_script_has_no_mavproxy_or_absolute_home(self):
        text = SCRIPT.read_text()
        self.assertNotRegex(text, r"sim_vehicle|mavproxy\.py")
        self.assertNotRegex(text, r"/home/[a-z]")


class LockTests(unittest.TestCase):
    def blocks(self):
        text = LOCK.read_text()
        lines = [l for l in text.splitlines() if re.match(r"^[A-Za-z0-9._-]+==", l)]
        return text, lines

    def test_every_requirement_is_pinned_and_hashed(self):
        text, reqs = self.blocks()
        self.assertGreaterEqual(len(reqs), 10)
        self.assertIn("mavproxy==", text)
        self.assertIn("pymavlink==", text)
        for block in re.split(r"\n(?=[A-Za-z0-9._-]+==)", text.split("\n", 3)[3]):
            if "==" in block.split("\n")[0]:
                self.assertRegex(block, r"--hash=sha256:[0-9a-f]{64}", block[:40])

    def test_no_unsafe_entries(self):
        text = LOCK.read_text()
        self.assertNotRegex(text, r"(?m)^\s*(-e|git\+|https?://|file:)")
        self.assertNotRegex(text, r"/home/|/tmp/")

    def test_input_pins_mavproxy(self):
        self.assertRegex((ROOT / "requirements-m1.in").read_text(), r"(?m)^MAVProxy==\d")


if __name__ == "__main__":
    unittest.main()
