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


OTHER_EMAIL = "someone" + "@example" + ".test"  # built in parts: the hygiene check forbids addresses
AGENT_EMAIL = "agent" + "@noreply" + ".invalid"


def clean_env():
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def git(path, *args):
    return subprocess.run(["git", *args], cwd=path, capture_output=True, text=True, check=True,
                          env=clean_env()).stdout


def stub_problems(source):
    """List the logic in a starter file. A state function has only a docstring and one raise.

    Not allowed: loops, branches, calls, returns, or any module statement besides imports,
    the interface number and function definitions. Every function must be a stub, `run()` too.
    """
    problems = []
    for node in ast.parse(source).body:
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef)):
            pass
        elif not (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)) and not (
                isinstance(node, ast.Assign) and [t.id for t in node.targets] == ["PLATFORM_INTERFACE"]):
            problems.append(f"module statement: {type(node).__name__}")
        if isinstance(node, ast.FunctionDef):
            body = [n for n in node.body if not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant))]
            raises = len(body) == 1 and isinstance(body[0], ast.Raise) and isinstance(body[0].exc, ast.Call) \
                and getattr(body[0].exc.func, "id", "") == "NotImplementedError"
            if not raises:
                problems.append(f"{node.name}: not a single raise NotImplementedError")
    return problems


READ_ONLY_GIT = {("worktree", "list", "--porcelain", "-z"), ("rev-parse", "--git-common-dir")}


@contextlib.contextmanager
def no_writes(testcase):
    """Make every filesystem write fail, and allow only the read-only Git calls of the guard."""
    def blocked(*args, **kwargs):
        raise AssertionError(f"write before the guard: {args!r}")

    real_git = learn_cli.git

    def guarded_git(*args, **kwargs):
        testcase.assertIn(tuple(args), READ_ONLY_GIT, "only read-only Git calls may run before the guard")
        return real_git(*args, **kwargs)

    real_open = open

    def guarded_open(file, mode="r", *args, **kwargs):
        if any(flag in mode for flag in "wax+"):
            blocked(file, mode)
        return real_open(file, mode, *args, **kwargs)

    with contextlib.ExitStack() as stack:
        for target, name in ((Path, "mkdir"), (Path, "write_text"), (Path, "write_bytes"), (Path, "touch"),
                             (Path, "rename"), (Path, "replace"), (Path, "symlink_to"), (os, "mkdir"),
                             (os, "makedirs"), (os, "rename"), (os, "replace"), (learn_cli.shutil, "copytree"),
                             (learn_cli.shutil, "copy"), (learn_cli.shutil, "copy2"), (learn_cli.shutil, "move")):
            stack.enter_context(patch.object(target, name, side_effect=blocked))
        stack.enter_context(patch("builtins.open", side_effect=guarded_open))
        stack.enter_context(patch.object(learn_cli, "git", side_effect=guarded_git))
        yield


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
        text = (self.new_pilot() / "mission.py").read_text()
        self.assertEqual(stub_problems(text), [])
        self.assertEqual(len([n for n in ast.parse(text).body if isinstance(n, ast.FunctionDef)]), 10)

    def test_the_no_solution_check_finds_leaks(self):
        """The check must reject control flow, calls and returns in any function, `run()` included."""
        stub = 'def f(ap):\n    """Question."""\n    raise NotImplementedError("STEP 1")\n'
        self.assertEqual(stub_problems(stub), [])
        dispatcher = ('def run(ap, budgets):\n    for state in (connect, arm):\n'
                      '        if not state(ap, budgets):\n            return\n    ap.succeed()\n')
        leaks = (dispatcher,
                 "def f(ap):\n    ap.phase('ARM')\n    raise NotImplementedError('x')\n",
                 "def f(ap):\n    return True\n",
                 "STATES = (connect, arm)\n" + stub,
                 "def f(ap):\n    while True:\n        raise NotImplementedError('x')\n")
        for leak in leaks:
            self.assertNotEqual(stub_problems(leak), [], leak)

    def test_init_rejects_a_target_inside_the_platform_before_any_write(self):
        inside = learn_cli.PLATFORM_ROOT / "landing-pilot-test-target"
        with tempfile.TemporaryDirectory() as root:
            link = Path(root) / "link"
            link.symlink_to(learn_cli.PLATFORM_ROOT)
            candidates = (inside, inside / "deeper", link / "via-link", learn_cli.PLATFORM_ROOT,
                          learn_cli.PLATFORM_ROOT / "docs" / ".." / "elsewhere")
            with no_writes(self):
                for target in candidates:
                    code, out = learn("--pilot", str(target), "init")
                    self.assertEqual(code, 1, target)
                    self.assertIn("inside the platform repository", out)
        self.assertFalse(inside.exists())
        self.assertFalse((learn_cli.PLATFORM_ROOT / "elsewhere").exists())

    def test_init_rejects_targets_below_every_checkout_and_the_common_git_directory(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root).resolve()
            seed = root / "seed"
            seed.mkdir()
            git(seed, "init", "-q", "-b", "main")
            git(seed, "-c", "user.name=t", "-c", "user.email=t" + "@noreply" + ".invalid", "commit", "-q",
                "--allow-empty", "-m", "seed")
            bare = root / "common.git"  # the common Git directory sits outside both checkouts
            git(root, "clone", "-q", "--bare", str(seed), str(bare))
            first, second = root / "checkout-a", root / "checkout\nb"  # a line break in a worktree path
            git(bare, "worktree", "add", "-q", "--detach", str(first), "HEAD")
            git(bare, "worktree", "add", "-q", "--detach", str(second), "HEAD")
            targets = (second / "pilot", second / "deeper" / "pilot", bare / "pilot", bare / "worktrees" / "x")
            with patch.object(learn_cli, "PLATFORM_ROOT", first):
                with no_writes(self):
                    for target in targets:
                        code, out = learn("--pilot", str(target), "init")
                        self.assertEqual(code, 1, target)
                        self.assertIn("inside the platform repository", out)
                self.assertFalse(learn_cli.inside_platform(root / "outside" / "pilot"))  # outside every root

    def test_no_writes_catches_a_write_before_the_guard(self):
        """Self-test: a mutation that writes before the guard must fail the refusal tests."""
        real_guard = learn_cli.inside_platform

        def write_first(dest):
            (Path(tempfile.gettempdir()) / "landing-lab-mutation-probe").mkdir(exist_ok=True)
            return real_guard(dest)

        with patch.object(learn_cli, "inside_platform", side_effect=write_first):
            with self.assertRaises(AssertionError), no_writes(self):
                learn("--pilot", str(learn_cli.PLATFORM_ROOT / "pilot"), "init")
        with self.assertRaises(AssertionError), no_writes(self):
            learn_cli.git("commit", "-q", cwd=learn_cli.PLATFORM_ROOT)  # not a read-only call

    def test_init_does_not_overwrite_a_folder_filled_during_the_copy(self):
        with tempfile.TemporaryDirectory() as root:
            dest = Path(root) / "landing-pilot"
            real = learn_cli.shutil.copytree

            def copy_then_fill(*args, **kwargs):
                with patch.object(learn_cli.shutil, "copytree", real):  # copytree calls itself
                    real(*args, **kwargs)
                dest.mkdir()  # another process creates the owner's folder now
                (dest / "mission.py").write_text("owner work\n")

            with patch.object(learn_cli.shutil, "copytree", copy_then_fill):
                code, out = learn("--pilot", str(dest), "init")
            self.assertEqual(code, 1, out)
            self.assertEqual((dest / "mission.py").read_text(), "owner work\n")
            self.assertEqual([p.name for p in Path(root).iterdir()], ["landing-pilot"])  # no staging leftovers

    def test_init_ignores_inherited_git_variables(self):
        with tempfile.TemporaryDirectory() as root:
            decoy = Path(root) / "decoy"
            decoy.mkdir()
            subprocess.run(["git", "init", "-q", str(decoy)], check=True, env=clean_env())
            before = subprocess.run(["git", "-C", str(decoy), "count-objects"], capture_output=True, text=True,
                                    env=clean_env()).stdout
            dest = Path(root) / "landing-pilot"
            env = {"GIT_AUTHOR_NAME": "Owner Name", "GIT_AUTHOR_EMAIL": OTHER_EMAIL,
                   "GIT_COMMITTER_NAME": "Owner Name", "GIT_COMMITTER_EMAIL": OTHER_EMAIL,
                   "GIT_DIR": str(decoy / ".git"), "GIT_WORK_TREE": str(decoy),
                   "GIT_INDEX_FILE": str(decoy / "other-index")}
            code, out = learn("--pilot", str(dest), "init", env=env)
            self.assertEqual(code, 0, out)
            who = git(dest, "log", "--format=%an|%ae|%cn|%ce").strip()
            self.assertEqual(who.count("Owner"), 0, who)
            self.assertTrue(who.startswith("Landing Lab Agent ("), who)
            self.assertEqual(git(dest, "rev-list", "--count", "HEAD").strip(), "1")
            after = subprocess.run(["git", "-C", str(decoy), "count-objects"], capture_output=True, text=True,
                                   env=clean_env()).stdout
            self.assertEqual(before, after)  # the decoy repository got no object
            self.assertFalse((decoy / "other-index").exists())

    def test_git_helper_environment_has_no_inherited_git_variables(self):
        with patch.dict(os.environ, {"GIT_DIR": "/x", "GIT_WORK_TREE": "/y", "GIT_AUTHOR_NAME": "A",
                                     "GIT_COMMITTER_EMAIL": "a@b.c", "GIT_SSH_COMMAND": "evil", "GIT_INDEX_FILE": "/z"}):
            plain = learn_cli.git_env()
            self.assertEqual({k for k in plain if k.startswith("GIT_")}, {"GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"})
            who = learn_cli.git_env(("Agent", AGENT_EMAIL))
            self.assertEqual((who["GIT_AUTHOR_NAME"], who["GIT_COMMITTER_NAME"]), ("Agent", "Agent"))
            self.assertEqual((who["GIT_AUTHOR_EMAIL"], who["GIT_COMMITTER_EMAIL"]), (AGENT_EMAIL,) * 2)
            self.assertNotIn("GIT_DIR", who)
            with patch.object(learn_cli.subprocess, "run") as run:
                learn_cli.git("status", cwd=".")
            self.assertNotIn("GIT_DIR", run.call_args.kwargs["env"])

    def test_init_refuses_a_folder_with_files_and_honours_the_environment(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "something").write_text("x")
            code, out = learn("--pilot", root, "init")
            self.assertEqual(code, 1)
            self.assertIn("Init changed nothing", out)
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
        self.assertIn("NotImplementedError: STEP 1: write run()", out)
        self.assertIn("Next action:", out)
        self.assertIn("Evidence for this failure: local/last-run/test_step1_connect_and_wait_ready/mission.stderr", out)
        self.assertTrue((dest / "local" / "last-run" / "test_step1_connect_and_wait_ready" / "mission.stderr").is_file())
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
