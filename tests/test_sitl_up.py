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
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "sitl-up"
LOCK = ROOT / "requirements-m1.lock"
GIT = ["git", "-c", "user.name=t", "-c", "user.useConfigOnly=false"]
GIT_ENV = dict(os.environ, GIT_AUTHOR_EMAIL="t" + chr(64) + "x", GIT_COMMITTER_EMAIL="t" + chr(64) + "x")


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
        self.parm = self.src / "Tools/autotest/default_params/copter.parm"
        self.parm.write_text("FRAME_CLASS 1\n")
        (self.src / "README").write_text("x\n")
        subprocess.run(["git", "init", "-q", str(self.src)], check=True)
        subprocess.run(["git", "-C", str(self.src), "add", "README", "Tools"], check=True)
        subprocess.run(GIT + ["-C", str(self.src), "commit", "-q", "-m", "x"], check=True, env=GIT_ENV)
        self.commit = subprocess.run(["git", "-C", str(self.src), "rev-parse", "HEAD"],
                                     check=True, capture_output=True, text=True).stdout.strip()
        self.sha = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        self.workdir = Path(self.tmp.name) / "work"
        self.lock = Path(self.tmp.name) / "lock" / "sitl-up.lock"
        self.rec = Path(self.tmp.name) / "record.txt"

    def env(self, **env):
        e = dict(os.environ, SITL_SRC_DIR=str(self.src), SITL_SRC_COMMIT=self.commit,
                 SITL_BIN_SHA256=self.sha, SITL_WORKDIR=str(self.workdir),
                 SITL_LOCK_FILE=str(self.lock), REC=str(self.rec))
        e.update(env)
        return e

    def run_script(self, *args, cwd=None, **env):
        return subprocess.run([str(SCRIPT), *args], capture_output=True, text=True,
                              env=self.env(**env), timeout=30, cwd=cwd)

    def install_fake(self, body):
        self.binary.write_text("#!/bin/sh\n" + body)
        self.binary.chmod(0o755)
        self.sha = hashlib.sha256(self.binary.read_bytes()).hexdigest()

    def record_fake(self):
        self.install_fake('pwd > "$REC"\nfor a in "$@"; do echo "$a" >> "$REC"; done\n')

    def test_print_command_uses_binary_directly(self):
        r = self.run_script("--print")
        self.assertEqual(r.returncode, 0, r.stderr)
        line = " ".join(shlex.split(r.stdout.strip().splitlines()[-1]))
        self.assertTrue(line.startswith(str(self.binary)))
        for part in ["--model +", "--speedup 1", "--sysid 1", "--serial0 udpclient:127.0.0.1:14550", "--serial1 none",
                     "--serial2 none", "--wipe",
                     "--home -35.363261,149.165230,584,353", "--defaults " + str(self.src / "Tools/autotest/default_params/copter.parm")]:
            self.assertIn(part, line)
        self.assertNotIn("tcp:", line)
        self.assertNotIn("mavproxy", r.stdout.lower())
        self.assertFalse(self.workdir.exists(), "--print must not create the work directory")

    def test_udp_out_and_no_wipe(self):
        r = self.run_script("--print", "--udp-out", "127.0.0.1:14551", "--no-wipe")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("--serial1 udpclient:127.0.0.1:14551", r.stdout)
        self.assertIn("--serial2 none", r.stdout)
        self.assertNotIn("--wipe", r.stdout)

    def test_rejects_bad_udp_out(self):
        for bad in ["0.0.0.0:14550", "localhost:14550", "127.0.0.1:80", "127.0.0.1:99999", "127.0.0.1:14550;id",
                    "127.0.0.1:14550"]:
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

    def test_pin_override_prints_warning(self):
        r = self.run_script("--print")
        self.assertIn("WARNING", r.stderr)  # the test pins differ from the built-in pins
        r = self.run_script("--print", SITL_SRC_COMMIT="", SITL_BIN_SHA256="")
        self.assertNotIn("WARNING", r.stderr)

    def test_missing_defaults_file_refuses(self):
        self.parm.unlink()
        r = self.run_script("--print")
        self.assertEqual(r.returncode, 2)
        self.assertIn("defaults file not found", r.stderr)

    def test_changed_defaults_file_refuses(self):
        self.parm.write_text("FRAME_CLASS 2\n")
        r = self.run_script("--print")
        self.assertEqual(r.returncode, 2)
        self.assertIn("defaults file differs", r.stderr)

    def test_dirty_source_tree_refuses(self):
        (self.src / "README").write_text("changed\n")
        r = self.run_script("--print")
        self.assertEqual(r.returncode, 2)
        self.assertIn("uncommitted changes", r.stderr)

    def test_options_without_value_refuse(self):
        for opt, text in [("--udp-out", "needs HOST:PORT"), ("--workdir", "needs DIR")]:
            r = self.run_script(opt)
            self.assertEqual(r.returncode, 2, opt)
            self.assertIn(text, r.stderr)

    def test_workdir_before_print_refuses(self):
        r = self.run_script("--workdir", "--print")
        self.assertEqual(r.returncode, 2)
        self.assertIn("not an option", r.stderr)
        self.assertEqual(r.stdout, "")

    def test_print_quotes_workdir(self):
        r = self.run_script("--print", "--workdir", str(self.workdir) + " x;y")
        self.assertEqual(r.returncode, 0, r.stderr)
        first = shlex.split(r.stdout.splitlines()[0])
        self.assertEqual(first, ["cd", str(self.workdir) + " x;y"])

    def test_real_start_path_runs_in_workdir_with_args(self):
        self.record_fake()
        r = self.run_script()
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = self.rec.read_text().splitlines()
        self.assertEqual(Path(lines[0]).resolve(), self.workdir.resolve())
        args = lines[1:]
        self.assertEqual(args[args.index("--serial0") + 1], "udpclient:127.0.0.1:14550")
        self.assertEqual(args[args.index("--serial1") + 1], "none")
        self.assertEqual(args[args.index("--serial2") + 1], "none")
        self.assertIn("--wipe", args)
        self.assertEqual(args[args.index("--defaults") + 1], str(self.parm))

    def test_relative_paths_are_made_absolute(self):
        self.record_fake()
        r = self.run_script("--workdir", "rel-work", cwd=self.tmp.name,
                            SITL_SRC_DIR="ardupilot", SITL_LOCK_FILE="rel-lock")
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = self.rec.read_text().splitlines()
        self.assertEqual(Path(lines[0]).resolve(), (Path(self.tmp.name) / "rel-work").resolve())
        defaults = lines[1:][lines.index("--defaults") ]
        self.assertTrue(os.path.isabs(defaults), defaults)

    def hold_fake(self):
        self.started = Path(self.tmp.name) / "started"
        self.release = Path(self.tmp.name) / "release"
        self.install_fake('echo $$ >> "$STARTED"\nwhile [ ! -e "$RELEASE" ]; do sleep 0.1; done\n')

    def test_concurrent_starts_only_one_runs(self):
        self.hold_fake()
        env = self.env(STARTED=str(self.started), RELEASE=str(self.release))
        procs = [subprocess.Popen([str(SCRIPT)], env=env, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True) for _ in range(4)]
        try:
            deadline = time.time() + 20
            while time.time() < deadline and sum(p.poll() is not None for p in procs) < 3:
                time.sleep(0.05)
            self.assertEqual(sum(p.poll() is not None for p in procs), 3)
            self.release.write_text("go")
            results = [p.communicate(timeout=20) + (p.returncode,) for p in procs]
        finally:
            self.release.write_text("go")
            for p in procs:
                p.kill()
        codes = sorted(r[2] for r in results)
        self.assertEqual(codes, [0, 2, 2, 2], results)
        self.assertEqual(len(self.started.read_text().split()), 1)
        self.assertTrue(any("already runs" in r[1] for r in results))

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
        blocks = re.split(r"(?m)^(?=[A-Za-z0-9._-]+==)", text)[1:]  # drop the header before the first package
        self.assertEqual(len(blocks), len(reqs))
        for block in blocks:
            self.assertRegex(block, r"--hash=sha256:[0-9a-f]{64}", block[:40])

    def test_no_unsafe_entries(self):
        text = LOCK.read_text()
        self.assertNotRegex(text, r"(?m)^\s*(-e|git\+|https?://|file:)")
        self.assertNotRegex(text, r"/home/|/tmp/")

    def test_input_pins_mavproxy(self):
        self.assertRegex((ROOT / "requirements-m1.in").read_text(), r"(?m)^MAVProxy==\d")


if __name__ == "__main__":
    unittest.main()
