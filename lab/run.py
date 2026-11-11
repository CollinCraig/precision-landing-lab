"""Run an untrusted-in-the-process-sense mission child, recording M1 evidence.

Usage: python -m lab.run --help. See lab/PROTOCOL.md for the child contract.
This module contains no mission policy and does not launch an autopilot.
"""
import argparse
import base64
import json
import math
import os
import selectors
import signal
import socket
import subprocess
import time
from pathlib import Path

from .link import Connection, Evidence, RunFailure, open_link


def _json(line):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    return json.loads(line, object_pairs_hook=pairs,
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))


def stop_child(process, grace=0.5):
    """Guard hook: terminate the isolated POSIX session, then kill/reap.

    Called even after leader exit, to clean up remaining group members.
    Children must not daemonize/escape their process group; this is isolation
    for cleanup, not an OS security sandbox.
    """
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def run(root, metadata, command, *, endpoint="udpin:127.0.0.1:14550",
        timeout=60, factory=open_link, guard=None):
    """Return (run_path, result). No existing directory is ever modified.

    guard(phase, process) runs at before_connect, before_launch, and poll;
    process is None until launched. Raise RunFailure to refuse/abort. Factory
    and transport methods must be nonblocking. The timeout covers setup and
    mission work; cleanup has an additional bounded termination grace.
    """
    if not math.isfinite(timeout) or not 0 < timeout <= 86400:
        raise ValueError("timeout must be finite, in (0,86400]")
    evidence = Evidence(root, metadata)
    transport = process = selector = None
    failure = None
    deadline = time.monotonic() + timeout
    previous_handlers = {}

    def checkpoint(phase="poll"):
        if guard:
            guard(phase, process)
        if time.monotonic() >= deadline:
            raise RunFailure("timeout", "Runner wall-time limit reached")

    def interrupted(signum, frame):
        raise RunFailure("interrupted", f"Received signal {signum}")

    def reply(value):
        payload = json.dumps(value, allow_nan=False).encode() + b"\n"
        try:
            # Every response is below PIPE_BUF. Nonblocking prevents a child
            # that stops reading from trapping the parent or its guard.
            if os.write(process.stdin.fileno(), payload) != len(payload):
                raise OSError("partial protocol response")
        except OSError as exc:
            raise RunFailure("mission_exception", f"Child protocol input unavailable: {exc}") from exc

    try:
        # signal.signal is only available from the main thread. Embedders in
        # other threads retain their own signal handling and can use guard.
        import threading
        if threading.current_thread() is threading.main_thread():
            for sig in (signal.SIGINT, signal.SIGTERM):
                previous_handlers[sig] = signal.signal(sig, interrupted)
        # Outside the strict manifest schema, preserve invocation provenance
        # even when connection setup or child launch fails.
        with (evidence.path / "invocation.json").open("x", encoding="utf-8") as stream:
            json.dump({"protocol": "m1-child-v1", "command": list(command),
                       "endpoint": endpoint, "timeout_seconds": timeout}, stream, allow_nan=False)
        checkpoint("before_connect")
        try:
            transport = factory(endpoint)
        except RunFailure:
            raise
        except Exception as exc:
            raise RunFailure("connection_failed", f"Opening connection: {type(exc).__name__}: {exc}") from exc
        link = Connection(transport, evidence, checkpoint=checkpoint)
        checkpoint("before_launch")
        with (evidence.path / "mission.stderr").open("xb") as stderr:
            try:
                process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                           stderr=stderr, start_new_session=True, bufsize=0)
            except Exception as exc:
                raise RunFailure("mission_exception", f"Launching mission: {type(exc).__name__}: {exc}") from exc
            os.set_blocking(process.stdin.fileno(), False)
            os.set_blocking(process.stdout.fileno(), False)
            selector = selectors.DefaultSelector()
            selector.register(process.stdout, selectors.EVENT_READ)
            reply({"protocol": "m1-child-v1", "seed": metadata["seed"],
                   "scenario": metadata["scenario"], "mode": metadata["mode"]})
            buffer = b""
            outcome = None
            eof = False
            while True:
                checkpoint()
                for key, _ in selector.select(0.02):
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        eof = True
                        selector.unregister(key.fileobj)
                    buffer += chunk
                while b"\n" in buffer:
                    checkpoint()
                    line, buffer = buffer.split(b"\n", 1)
                    if len(line) > 4096:
                        raise RunFailure("mission_exception", "Protocol line exceeds 4096 bytes")
                    try:
                        request = _json(line)
                        if not isinstance(request, dict) or outcome is not None:
                            raise ValueError("request after outcome or non-object request")
                        op = request.get("op")
                        if op == "receive" and set(request) == {"op", "type", "timeout"}:
                            wait = request["timeout"]
                            if type(wait) not in (int, float) or not math.isfinite(wait):
                                raise ValueError("timeout must be finite numeric seconds")
                            received = link.receive(request["type"], wait)
                            reply({"packet": None} if received is None else {
                                "type": received["type"], "packet": base64.b64encode(received["packet"]).decode()})
                        elif op == "send" and set(request) == {"op", "packet"}:
                            packet = base64.b64decode(request["packet"], validate=True)
                            if not 1 <= len(packet) <= 280:
                                raise ValueError("send packet must contain 1..280 bytes")
                            try:
                                transport.write(packet)
                            except Exception as exc:
                                raise RunFailure("connection_failed", f"Sending packet: {type(exc).__name__}: {exc}") from exc
                            reply({"sent": len(packet)})
                        elif op == "event" and set(request) == {"op", "kind", "source"}:
                            evidence.event(request["kind"], request["source"])
                            reply({"recorded": True})
                        elif op == "outcome" and set(request) == {"op", "success", "failure_reason"}:
                            if type(request["success"]) is not bool:
                                raise ValueError("success must be boolean")
                            if request["success"]:
                                if request["failure_reason"] is not None:
                                    raise ValueError("success requires null failure_reason")
                                outcome = (True, None)
                            else:
                                reason = request["failure_reason"]
                                if not isinstance(reason, dict) or set(reason) != {"code", "detail"} or not isinstance(reason["detail"], str) or not reason["detail"].strip():
                                    raise ValueError("invalid failure_reason")
                                outcome = (False, RunFailure(reason["code"], reason["detail"]))
                        else:
                            raise ValueError("unknown operation or fields")
                    except RunFailure:
                        raise
                    except Exception as exc:
                        raise RunFailure("mission_exception", f"Child protocol: {type(exc).__name__}: {exc}") from exc
                if len(buffer) > 4096:
                    raise RunFailure("mission_exception", "Protocol line exceeds 4096 bytes")
                if eof and process.poll() is not None:
                    if buffer:
                        raise RunFailure("mission_exception", "Unterminated child protocol line")
                    if process.returncode != 0:
                        raise RunFailure("mission_exception", f"Mission process exited {process.returncode}")
                    if outcome is None:
                        raise RunFailure("mission_exception", "Mission exited without outcome")
                    failure = outcome[1]
                    break
    except RunFailure as exc:
        failure = exc
    except KeyboardInterrupt:
        failure = RunFailure("interrupted", "Keyboard interrupt")
    except Exception as exc:
        failure = RunFailure("runner_error", f"{type(exc).__name__}: {exc}")
    finally:
        # Ignore repeated termination signals while publishing the evidence.
        for sig in previous_handlers:
            signal.signal(sig, signal.SIG_IGN)
        try:
            if process is not None:
                try:
                    stop_child(process)
                except Exception as exc:
                    failure = failure or RunFailure("runner_error", f"Child cleanup: {exc}")
                for stream in (process.stdin, process.stdout):
                    try:
                        stream.close()
                    except Exception as exc:
                        failure = failure or RunFailure("runner_error", f"Child pipe cleanup: {exc}")
            if selector is not None:
                selector.close()
            if transport is not None:
                try:
                    transport.close()
                except Exception as exc:
                    failure = failure or RunFailure("runner_error", f"Transport close: {exc}")
            result = evidence.finish(failure)
        finally:
            for sig, handler in previous_handlers.items():
                signal.signal(sig, handler)
    return evidence.path, result


def provenance():
    """Inspect the checked-out source, including untracked files."""
    repo = Path(__file__).resolve().parent.parent
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    dirty = bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], cwd=repo, text=True))
    return {"commit": commit, "dirty": dirty}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", default="runs")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--seed", required=True, type=int)
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--mode", choices=("truth", "camera", "offline"), required=True)
    parser.add_argument("--input-source", action="append", choices=("runner", "autopilot", "truth", "camera"), required=True)
    parser.add_argument("--ardupilot-version", required=True)
    parser.add_argument("--container", required=True)
    parser.add_argument("--endpoint", default="udpin:127.0.0.1:14550")
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("a mission child command is required after --")
    metadata = dict(run_id=args.run_id, seed=args.seed, scenario={"name": args.scenario}, mode=args.mode,
                    input_sources=args.input_source, versions={"ardupilot": args.ardupilot_version, "container": args.container},
                    git=provenance(), host=socket.gethostname())
    try:
        path, result = run(args.runs, metadata, command, endpoint=args.endpoint, timeout=args.timeout)
    except (ValueError, OSError) as exc:
        parser.exit(2, f"Cannot reserve/finalize run: {exc}\n")
    print(f"{path}: {'success' if result['success'] else result['failure_reason']['code']}")
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
