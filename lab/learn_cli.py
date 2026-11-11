"""Learning tool for the owner's pilot repository (D-038). Entry point: scripts/learn.

Commands: init, status, step N, listen, doctor. It never starts SITL and installs nothing.
Messages to the owner follow ASD-STE100 Simplified Technical English.
"""
import argparse
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import time
import unittest
from pathlib import Path

from . import mavlite
from .pilot_api import INTERFACE_VERSION, PLATFORM_ROOT

TEMPLATE = PLATFORM_ROOT / "pilot-template"
DEFAULT_PILOT = Path.home() / "Projects" / "landing-pilot"
COMMIT_MESSAGE = "starter code from the platform"
STEP_COUNT = 4


def pilot_path(value):
    """Choose the pilot folder: --pilot, then LANDING_PILOT, then the default."""
    return Path(value or os.environ.get("LANDING_PILOT") or DEFAULT_PILOT).expanduser().resolve()


GIT_KEEP = ("PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR")


def git_env(identity=None):
    """Return a clean environment for Git. It copies no GIT_* variable from the caller.

    Without it, GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and the author variables
    can send a command to another repository or give a commit another author.
    """
    env = {key: os.environ[key] for key in GIT_KEEP if key in os.environ}
    env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
    if identity:
        name, email = identity
        env.update(GIT_AUTHOR_NAME=name, GIT_AUTHOR_EMAIL=email, GIT_COMMITTER_NAME=name, GIT_COMMITTER_EMAIL=email)
    return env


def git(*args, cwd, check=True, identity=None):
    return subprocess.run(["git", *args], cwd=cwd, check=check, capture_output=True, text=True,
                          env=git_env(identity))


def agent_identity():
    """Agent identity from D-036. The email is built in two parts so no address sits in this file."""
    model = re.sub(r"[^A-Za-z0-9._-]", "-", os.environ.get("LEARN_AGENT_MODEL", "platform"))
    return f"Landing Lab Agent ({model})", f"agent-{model}@noreply" + ".invalid"


def platform_commit():
    """Return (commit, dirty) of the platform checkout, or (None, False) without Git."""
    try:
        commit = git("rev-parse", "HEAD", cwd=PLATFORM_ROOT).stdout.strip()
        dirty = bool(git("status", "--porcelain", cwd=PLATFORM_ROOT).stdout.strip())
        return commit, dirty
    except (OSError, subprocess.CalledProcessError):
        return None, False


def platform_roots():
    """Return every folder that the platform repository owns (D-038).

    These are all checkouts from `git worktree list` and the common Git directory.
    Without Git, the list holds the active checkout only.
    """
    roots = {PLATFORM_ROOT.resolve()}
    try:
        # -z ends each field with NUL, so a path that contains a line break stays whole.
        for field in git("worktree", "list", "--porcelain", "-z", cwd=PLATFORM_ROOT).stdout.split("\0"):
            if field.startswith("worktree "):
                roots.add(Path(field[len("worktree "):]).resolve())
        common = Path(git("rev-parse", "--git-common-dir", cwd=PLATFORM_ROOT).stdout.strip())
        roots.add((PLATFORM_ROOT / common).resolve())  # an absolute path stays absolute
    except (OSError, subprocess.CalledProcessError):
        pass
    return roots


def inside_platform(dest):
    """True when `dest` is, or is below, any checkout or the common Git directory of the platform."""
    dest = dest.resolve()
    return any(dest == root or root in dest.parents for root in platform_roots())


def init(dest):
    """Create the pilot repository: one agent commit, no remote.

    The files go into a new folder next to `dest`. A rename then puts the folder in place.
    The rename fails when `dest` has files, so a second init cannot overwrite owner work.
    """
    dest = dest.resolve()
    if inside_platform(dest):
        print(f"Stop. {dest} is inside the platform repository. Choose a folder outside it. Init changed nothing.")
        return 1
    if dest.exists() and (not dest.is_dir() or any(dest.iterdir())):
        print(f"Stop. {dest} exists and is not an empty folder. Init changed nothing.")
        return 1
    commit, dirty = platform_commit()
    dest.parent.mkdir(parents=True, exist_ok=True)
    staging = dest.parent / f".{dest.name}.new-{os.getpid()}"
    staging.mkdir()  # fails when the name exists: exclusive creation
    try:
        shutil.copytree(TEMPLATE, staging, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__"))
        (staging / "PLATFORM_PIN").write_text(
            "# The platform version that this repository needs. `./learn doctor` checks it.\n"
            f"platform_commit = {commit or 'unknown'}\n"
            f"interface = {INTERFACE_VERSION}\n")
        (staging / ".platform-path").write_text(str(PLATFORM_ROOT) + "\n")  # local file, not in Git
        identity = agent_identity()
        name, email = identity
        git("init", "-q", "-b", "main", cwd=staging)
        git("add", "-A", cwd=staging)
        git("-c", f"user.name={name}", "-c", f"user.email={email}", "-c", "commit.gpgsign=false",
            "-c", f"core.hooksPath={os.devnull}", "commit", "-q", "-m", COMMIT_MESSAGE,
            cwd=staging, identity=identity)
        try:
            os.rename(staging, dest)  # replaces an empty folder only; fails when `dest` has files
        except OSError:
            print(f"Stop. Another process filled {dest} while init ran. Init overwrote nothing.")
            return 1
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    print(f"Created {dest} with one commit: {COMMIT_MESSAGE!r}. It has no remote.")
    if dirty:
        print("Warning: the platform has uncommitted changes. The pin names the last commit only.")
    print("Next action: open START-HERE.md in the new folder. Then do session 1.")
    return 0


class StepResult(unittest.TestResult):
    """Collect one line for each test and the message of each failure."""

    def __init__(self):
        super().__init__()
        self.rows = []  # (test name, passed, message, evidence folder)

    def _row(self, test, passed, message=""):
        name = test._testMethodName.split("_", 2)[-1].replace("_", " ")
        evidence = f"local/last-run/{test._testMethodName}"  # the test saves its own run here
        self.rows.append((name, passed, message, evidence))

    def addSuccess(self, test):
        super().addSuccess(test)
        self._row(test, True)

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._row(test, False, str(err[1]))

    def addError(self, test, err):
        super().addError(test, err)
        self._row(test, False, f"Equipment or test error: {err[0].__name__}: {err[1]}")


def run_step(pilot, number):
    """Run the tests of one step against the pilot folder. Return a StepResult."""
    os.environ["M1_PILOT"] = str(pilot)
    os.environ["M1_LAST_RUN_DIR"] = str(pilot / "local" / "last-run")
    (pilot / "local" / "last-run").mkdir(parents=True, exist_ok=True)
    sys.path[:0] = [str(PLATFORM_ROOT / "tests")]
    sys.modules.pop("test_pilot_steps", None)  # the module reads M1_PILOT at import
    import test_pilot_steps
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(getattr(test_pilot_steps, f"Step{number}Tests"))
    result = StepResult()
    suite.run(result)
    return result


def next_action(number, passed):
    if not passed:
        return (f"Read the failure message. Then read the evidence file that it names. "
                f"Optional help: hints/step-{number}/hint-1.md.")
    if number < STEP_COUNT:
        return f"Add a row to progress.md. Then start step {number + 1}."
    return "Add a row to progress.md. Next: fly your code in SITL (session 6), then do the mastery gate."


def step(pilot, number):
    if not 1 <= number <= STEP_COUNT:
        print(f"Use a step from 1 to {STEP_COUNT}.")
        return 2
    result = run_step(pilot, number)
    for name, passed, *_ in result.rows:
        print(f"{'PASS' if passed else 'FAIL'}  step {number}  {name}")
    failed = [row for row in result.rows if not row[1]]
    if failed:
        print(f"\nFirst failure: {failed[0][0]}\n{failed[0][2]}")
        if (pilot / failed[0][3] / "mission.stderr").is_file():
            print(f"Evidence for this failure: {failed[0][3]}/mission.stderr")
    print(f"\nStep {number}: {len(result.rows) - len(failed)} of {len(result.rows)} tests pass.")
    print("Next action:", next_action(number, not failed))
    return 1 if failed else 0


def status(pilot):
    first_open = None
    for number in range(1, STEP_COUNT + 1):
        result = run_step(pilot, number)
        passed = sum(1 for row in result.rows if row[1])
        print(f"step {number}: {passed} of {len(result.rows)} tests pass")
        if passed != len(result.rows) and first_open is None:
            first_open = number
    print("Next action:", "Run ./learn step %d." % first_open if first_open else next_action(STEP_COUNT, True))
    return 0 if first_open is None else 1


def doctor(pilot):
    problems = 0

    def report(ok, text):
        nonlocal problems
        problems += not ok
        print(("ok:    " if ok else "FIX:   ") + text)

    report((pilot / "mission.py").is_file(), "mission.py exists")
    report(git("rev-parse", "--git-dir", cwd=pilot, check=False).returncode == 0, "the pilot folder is a Git repository")
    remotes = git("remote", cwd=pilot, check=False).stdout.split()
    report(not remotes, "the pilot repository has no remote" if not remotes else f"remote found: {remotes}. Ask before you push.")
    pin = {}
    if (pilot / "PLATFORM_PIN").is_file():
        for line in (pilot / "PLATFORM_PIN").read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                pin[key.strip()] = value.strip()
    report(pin.get("interface") == str(INTERFACE_VERSION),
           f"pin interface is {pin.get('interface')}; the platform has {INTERFACE_VERSION}")
    commit, _ = platform_commit()
    pinned = pin.get("platform_commit", "unknown")
    if commit is None or pinned == "unknown":
        report(False, "cannot compare the platform commit with the pin")
    else:
        known = git("cat-file", "-e", pinned + "^{commit}", cwd=PLATFORM_ROOT, check=False).returncode == 0
        ancestor = known and git("merge-base", "--is-ancestor", pinned, "HEAD", cwd=PLATFORM_ROOT, check=False).returncode == 0
        report(ancestor, "the pinned platform commit is in the platform history" if ancestor
               else "the pinned commit is not in the platform history. Ask the platform agent.")
        if ancestor and pinned != commit:
            print("note:  the platform has newer commits than the pin. Tests still run. Ask the platform agent to update the pin.")
    text = (pilot / "mission.py").read_text() if (pilot / "mission.py").is_file() else ""
    report(f"PLATFORM_INTERFACE = {INTERFACE_VERSION}" in text, "mission.py declares the right PLATFORM_INTERFACE")
    return 1 if problems else 0


def read_tlog(path):
    """Yield (timestamp seconds, packet) from a tlog file."""
    data = Path(path).read_bytes()
    i = 0
    while i + 10 <= len(data):
        stamp = int.from_bytes(data[i:i + 8], "big") / 1e6
        i += 8
        v2 = data[i] == 0xFD
        if data[i] not in (0xFE, 0xFD):
            raise ValueError("Bad tlog frame")
        size = (10 if v2 else 6) + data[i + 1] + 2 + (13 if v2 and data[i + 2] & 1 else 0)
        yield stamp, data[i:i + size]
        i += size


def udp_packets(endpoint, seconds):
    match = re.fullmatch(r"udpin:127\.0\.0\.1:([0-9]{1,5})", endpoint)
    if not match:
        raise ValueError("Use an endpoint like udpin:127.0.0.1:14550")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", int(match.group(1))))
    sock.settimeout(0.5)
    end = time.monotonic() + seconds
    try:
        while time.monotonic() < end:
            try:
                yield time.monotonic(), sock.recvfrom(4096)[0]
            except socket.timeout:
                continue
    finally:
        sock.close()


def listen(endpoint, seconds, replay, types):
    """Print decoded messages. ACK and STATUSTEXT always print; other types print once each second."""
    source = read_tlog(replay) if replay else udp_packets(endpoint, seconds)
    last, origin, count = {}, None, 0
    for stamp, packet in source:
        try:
            message = mavlite.decode(packet)
        except ValueError:
            continue
        if message is None or message.sysid != 1 or (types and message.type not in types):
            continue
        origin = stamp if origin is None else origin
        if message.type not in ("COMMAND_ACK", "STATUSTEXT"):
            if stamp - last.get(message.type, -1e9) < 1.0:
                continue
            last[message.type] = stamp
        count += 1
        print(f"[{stamp - origin:7.2f}s] {message.pretty()}")
    print(f"{count} lines printed.")
    return 0 if count else 1


def main(argv=None):
    parser = argparse.ArgumentParser(prog="learn", description=__doc__)
    parser.add_argument("--pilot", help="pilot folder (default: LANDING_PILOT or ~/Projects/landing-pilot)")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="create the pilot repository (one commit, no remote)")
    sub.add_parser("status", help="run all steps, show the next action")
    p = sub.add_parser("step", help="run the tests of one step")
    p.add_argument("number", type=int)
    sub.add_parser("doctor", help="check the platform path and the platform pin")
    p = sub.add_parser("listen", help="print decoded messages from SITL or from a tlog file")
    p.add_argument("--endpoint", default="udpin:127.0.0.1:14550")
    p.add_argument("--seconds", type=float, default=10.0)
    p.add_argument("--replay", help="read a tlog file instead of the network")
    p.add_argument("--types", help="comma list, for example COMMAND_ACK,STATUSTEXT")
    args = parser.parse_args(argv)
    pilot = pilot_path(args.pilot)
    if args.command == "init":
        return init(pilot)
    if args.command != "listen" and not pilot.is_dir():
        print(f"No pilot folder at {pilot}. Run: scripts/learn init")
        return 2
    if args.command == "step":
        return step(pilot, args.number)
    if args.command == "status":
        return status(pilot)
    if args.command == "doctor":
        return doctor(pilot)
    if not 0 < args.seconds <= 300:
        parser.error("--seconds must be in (0, 300]")
    try:
        return listen(args.endpoint, args.seconds, args.replay, set(args.types.split(",")) if args.types else None)
    except (ValueError, OSError) as error:
        print(f"Cannot listen: {error}")
        return 2
