"""Check scripts/learn: init, doctor, step, listen. Tests use a temporary pilot folder."""
import ast
import contextlib
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))  # tests import m1_support by name
from lab import learn_cli
from test_pilot_api import REAL


def learn(*args, env=None):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), patch.dict(os.environ, env or {}):
        code = learn_cli.main(list(args))
    return code, out.getvalue()


def git(path, *args):
    return subprocess.run(["git", *args], cwd=path, capture_output=True, text=True, check=True).stdout


class LearnCliTests(unittest.TestCase):
    def new_pilot(self):
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        dest = Path(root.name) / "landing-pilot"
        code, _ = learn("--pilot", str(dest), "init")
        self.assertEqual(code, 0)
        return dest

    def test_init_makes_one_agent_commit_and_no_remote(self):
        dest = self.new_pilot()
        self.assertEqual(git(dest, "rev-list", "--count", "HEAD").strip(), "1")
        author, committer, message = git(dest, "log", "--format=%an|%ae%n%cn|%ce%n%s").strip().splitlines()
        self.assertEqual(author, committer)
        self.assertTrue(author.startswith("Landing Lab Agent ("))
        self.assertTrue(author.split("|")[1].startswith("agent-"))
        self.assertEqual(message, "starter code from the platform")
        self.assertEqual(git(dest, "remote").strip(), "")
        self.assertEqual(git(dest, "status", "--porcelain").strip(), "")

    def test_init_contents_and_untracked_local_files(self):
        dest = self.new_pilot()
        tracked = set(git(dest, "ls-files").split())
        for name in ("mission.py", "START-HERE.md", "progress.md", "PLATFORM_PIN", "AGENTS.md", "learn",
                     "notes/m1.md", "primer/01-state-machine.md", "tests/test_steps.py"):
            self.assertIn(name, tracked)
        self.assertEqual(len([t for t in tracked if t.startswith("hints/")]), 12)
        self.assertNotIn(".platform-path", tracked)  # a local path stays out of Git
        self.assertIn("100755", git(dest, "ls-files", "-s", "learn"))
        for name in tracked:
            text = (dest / name).read_text()
            self.assertNotIn("/home/", text, name)
            self.assertNotRegex(text, r"[\w.+-]+@[\w-]+\.[a-z]{2,}", name)
        self.assertRegex((dest / "PLATFORM_PIN").read_text(), r"platform_commit = [0-9a-f]{40}|unknown")

    def test_starter_code_has_no_solution(self):
        tree = ast.parse((self.new_pilot() / "mission.py").read_text())
        functions = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(len(functions), 10)
        for name, node in functions.items():
            body = [n for n in node.body if not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant))]
            if name == "run":
                self.assertEqual([type(n).__name__ for n in body], ["For", "Expr"])  # the order only
            else:  # the state functions are empty: one raise, no logic
                self.assertEqual([type(n).__name__ for n in body], ["Raise"], name)

    def test_init_refuses_a_folder_with_files_and_honours_the_environment(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "something").write_text("x")
            code, out = learn("--pilot", root, "init")
            self.assertEqual(code, 1)
            self.assertIn("Nothing was changed", out)
            target = Path(root) / "other"
            code, _ = learn("init", env={"LANDING_PILOT": str(target)})
            self.assertEqual((code, (target / "mission.py").is_file()), (0, True))

    def test_doctor_on_a_fresh_pilot(self):
        code, out = learn("--pilot", str(self.new_pilot()), "doctor")
        self.assertEqual(code, 0, out)
        self.assertNotIn("FIX", out)

    def test_step_runs_against_the_pilot_and_keeps_the_last_run(self):
        dest = self.new_pilot()
        code, out = learn("--pilot", str(dest), "step", "1")
        self.assertEqual(code, 1)  # the empty starter code fails
        self.assertEqual(out.count("FAIL  step 1"), 3)
        self.assertIn("NotImplementedError: STEP 1: write connect()", out)
        self.assertIn("Next action:", out)
        self.assertTrue((dest / "local" / "last-run" / "mission.stderr").is_file())
        self.assertEqual(git(dest, "status", "--porcelain").strip(), "")  # local/ is ignored
        self.assertEqual(learn("--pilot", str(dest), "step", "9")[0], 2)

    def test_pilot_repository_runs_its_own_step_tests(self):
        dest = self.new_pilot()
        done = subprocess.run([sys.executable, "-m", "unittest", "tests.test_steps.Step1Tests"], cwd=dest,
                              capture_output=True, text=True)
        self.assertIn("FAILED (failures=3)", done.stderr)
        self.assertNotIn("ImportError", done.stderr)

    def test_listen_replays_a_tlog(self):
        with tempfile.TemporaryDirectory() as root:
            log = Path(root) / "x.tlog"
            log.write_bytes(b"".join((1_000_000 * (i + 1)).to_bytes(8, "big") + bytes.fromhex(REAL[name])
                                     for i, name in enumerate(("heartbeat", "ack", "text"))))
            code, out = learn("listen", "--replay", str(log))
            self.assertEqual(code, 0)
            self.assertIn("COMMAND_ACK command=400 result=0 (ACCEPTED)", out)
            self.assertIn("STATUSTEXT severity=6 text='Arming motors'", out)
            self.assertEqual(learn("listen", "--replay", str(log), "--types", "SYS_STATUS")[0], 1)
            self.assertEqual(learn("listen", "--endpoint", "udpin:0.0.0.0:1")[0], 2)


if __name__ == "__main__":
    unittest.main()
