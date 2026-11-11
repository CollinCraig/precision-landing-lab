"""Bounded transport reads and the schema-1 evidence writer.

Transport contract: recv_match(blocking=False), write(bytes), close(). Received
messages expose get_msgbuf(). Factories must return promptly; no factory may
wait for telemetry. pymavlink is imported only by open_link().
"""
import json
import copy
import os
import re
import struct
import signal
import time
from pathlib import Path


CODES = frozenset(("timeout", "connection_failed", "readiness_failed",
                   "command_rejected", "mission_exception", "ac_unavailable",
                   "ac_lost", "interrupted", "runner_error"))
EMPTY_CODES = frozenset(("connection_failed", "ac_unavailable", "runner_error", "interrupted"))
U64 = (1 << 64) - 1


class RunFailure(Exception):
    def __init__(self, code, detail):
        if code not in CODES:
            raise ValueError("unknown failure code")
        self.code = code
        self.detail = str(detail).encode("utf-8", "replace")[:1000].decode("utf-8", "ignore").strip() or code
        super().__init__(self.detail)


def text(value):
    return isinstance(value, str) and bool(value.strip()) and len(value.encode("utf-8")) <= 1024


def validate_metadata(meta):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", meta["run_id"]):
        raise ValueError("invalid run_id")
    if type(meta["seed"]) is not int or not 0 <= meta["seed"] <= U64:
        raise ValueError("seed must be a u64")
    if not text(meta["scenario"]["name"]) or set(meta["scenario"]) != {"name"}:
        raise ValueError("invalid scenario")
    if meta["mode"] not in ("truth", "camera", "offline"):
        raise ValueError("invalid mode")
    if set(meta["versions"]) != {"ardupilot", "container"} or not text(meta["versions"]["ardupilot"]):
        raise ValueError("invalid versions")
    if not re.fullmatch(r"\S+@sha256:[a-fA-F0-9]{64}", meta["versions"]["container"]) or not text(meta["versions"]["container"]):
        raise ValueError("container must be digest pinned")
    if set(meta["git"]) != {"commit", "dirty"} or not re.fullmatch(r"(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})", meta["git"]["commit"]) or type(meta["git"]["dirty"]) is not bool:
        raise ValueError("invalid git provenance")
    sources = meta["input_sources"]
    if not isinstance(sources, list) or not {"runner", "autopilot"} <= set(sources) or not set(sources) <= {"runner", "autopilot", "truth", "camera"}:
        raise ValueError("declare runner, autopilot and all mission inputs")
    if meta["mode"] == "camera" and ("truth" in sources or "camera" not in sources):
        raise ValueError("camera mode requires camera and forbids truth")
    if not text(meta["host"]):
        raise ValueError("invalid host")


def packet_info(packet):
    """Validate the accepted subset without repairing or reserializing packets.

    Return (message id, padded payload), or None for traffic outside 1/1 and
    the two M1 message types. Malformed selected packets fail the run.
    """
    p = bytes(packet)
    if not p or p[0] not in (0xFE, 0xFD):
        raise RunFailure("connection_failed", "Malformed MAVLink packet magic")
    v2 = p[0] == 0xFD
    header = 10 if v2 else 6
    if len(p) < header + 2:
        raise RunFailure("connection_failed", "Truncated MAVLink header")
    msgid = int.from_bytes(p[7:10], "little") if v2 else p[5]
    sysid, compid = p[5:7] if v2 else p[3:5]
    if msgid not in (0, 33) or (sysid, compid) != (1, 1):
        return None
    size, extra = (9, 50) if msgid == 0 else (28, 104)
    if (v2 and p[2] != 0) or len(p) != header + p[1] + 2 or not (1 <= p[1] <= size if v2 else p[1] == size):
        raise RunFailure("connection_failed", "Unsupported selected MAVLink framing")
    crc = 0xFFFF
    for b in p[1:-2] + bytes([extra]):
        tmp = b ^ (crc & 255)
        tmp ^= (tmp << 4) & 255
        crc = (crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)
    if crc != int.from_bytes(p[-2:], "little"):
        raise RunFailure("connection_failed", "Selected MAVLink CRC mismatch")
    payload = p[header:-2].ljust(size, b"\0")
    if msgid == 0 and (payload[4], payload[5], payload[8]) != (2, 3, 3):
        return None  # not the accepted quadrotor autopilot heartbeat
    return msgid, payload


class Evidence:
    """Own a newly reserved run directory and publish JSON after tlog closure.

    Invalid caller metadata is rejected before reserving a directory. Once
    reserved, callers must finish in a finally block. Disk failure or SIGKILL
    can leave an explicitly incomplete directory; never reuse that directory.
    """
    def __init__(self, root, metadata, *, clock=time.monotonic_ns, wall=time.time_ns):
        validate_metadata(metadata)
        self.clock = clock
        self.origin = clock()
        self.start = wall() // 1000
        if not 0 < self.start < U64:
            raise ValueError("invalid Unix clock")
        self.manifest = dict(copy.deepcopy(metadata), schema_version=1, started_unix_us=self.start)
        allowed = {"run_id", "seed", "scenario", "mode", "versions", "git", "host", "input_sources", "schema_version", "started_unix_us"}
        if set(self.manifest) != allowed:
            raise ValueError("unknown metadata fields")
        self.path = Path(root) / metadata["run_id"]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.mkdir()  # exclusive reservation: never overwrite a previous attempt
        self.events = [{"t_us": 0, "kind": "run_started", "source": "runner"}]
        self.count = 0
        self.seen = set()
        self.boot = None
        self.last = 0
        self.finished = False
        self.event_bytes = 0
        self.tlog = (self.path / "flight.tlog").open("xb")

    def elapsed(self):
        return max(self.last, (self.clock() - self.origin) // 1000)

    def event(self, kind, source="runner"):
        if not text(kind) or kind in ("run_started", "run_failed", "run_succeeded") or source not in self.manifest["input_sources"]:
            raise RunFailure("runner_error", "Invalid event kind/source")
        if source == "autopilot" and not self.count:
            raise RunFailure("runner_error", "Autopilot event without telemetry")
        event = {"t_us": self.elapsed(), "kind": kind, "source": source}
        size = len(json.dumps(event, ensure_ascii=True).encode("utf-8"))
        if len(self.events) >= 2000 or self.event_bytes + size > 700000:
            raise RunFailure("runner_error", "Event limit reached")
        self.last = event["t_us"]
        self.event_bytes += size
        self.events.append(event)

    def record(self, packet):
        info = packet_info(packet)
        if info is None:
            return None
        msgid, payload = info
        if msgid == 33:
            boot = int.from_bytes(payload[:4], "little")
            if self.boot is not None and boot < self.boot:
                raise RunFailure("connection_failed", "Autopilot boot clock rolled back")
            self.boot = boot
        stamp = self.elapsed()
        if self.tlog.tell() + 8 + len(packet) > 64 * 1024 * 1024:
            raise RunFailure("runner_error", "Telemetry evidence exceeded 64 MiB")
        mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
        try:
            self.tlog.write(struct.pack(">Q", self.start + stamp) + bytes(packet))
            self.last = stamp
            self.count += 1
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, mask)
        self.seen.add(msgid)
        return msgid

    def finish(self, failure=None):
        if self.finished:
            raise RuntimeError("evidence already finalized")
        if failure is None and self.seen != {0, 33}:
            failure = RunFailure("runner_error", "Mission reported success without required HEARTBEAT and GLOBAL_POSITION_INT evidence")
        if failure and not self.count and failure.code not in EMPTY_CODES:
            failure = RunFailure("runner_error", f"Before telemetry: {failure.code}: {failure.detail}")
        duration = self.elapsed()
        if self.start + duration > U64:
            raise OverflowError("run timestamp overflow")
        self.tlog.flush()
        os.fsync(self.tlog.fileno())
        self.tlog.close()
        result = {k: self.manifest[k] for k in ("schema_version", "run_id", "seed", "scenario", "mode")}
        result.update(success=failure is None, failure_reason=None if failure is None else {"code": failure.code, "detail": failure.detail}, duration_us=duration, tlog_records=self.count,
                      events=self.events + [{"t_us": duration, "kind": "run_succeeded" if failure is None else "run_failed", "source": "runner"}])
        for name, value in (("manifest.json", self.manifest), ("result.json", result)):
            data = json.dumps(value, ensure_ascii=True, allow_nan=False).encode("utf-8")
            if len(data) > 1048576:
                raise ValueError("evidence JSON exceeds schema limit")
            tmp = self.path / (name + ".tmp")
            with tmp.open("xb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(tmp, self.path / name)
        self.finished = True
        return result


def open_link(endpoint):
    """Open a local UDP/TCP transport; never start SITL or install dependencies."""
    if not re.fullmatch(r"(?:udpin|udpout|tcp):127\.0\.0\.1:[0-9]{1,5}", endpoint):
        raise RunFailure("connection_failed", "Endpoint must explicitly use 127.0.0.1")
    # TCP connect in pymavlink can retry indefinitely; UDP is the bounded M1 path.
    if endpoint.startswith("tcp:"):
        raise RunFailure("connection_failed", "Use local UDP for bounded M1 connection setup")
    try:
        from pymavlink import mavutil
        return mavutil.mavlink_connection(endpoint, source_system=255, source_component=190)
    except Exception as exc:
        raise RunFailure("connection_failed", f"Opening transport: {type(exc).__name__}: {exc}") from exc


class Connection:
    def __init__(self, transport, evidence, *, checkpoint=lambda: None, clock=time.monotonic, sleep=time.sleep):
        self.transport, self.evidence = transport, evidence
        self.checkpoint, self.clock, self.sleep = checkpoint, clock, sleep
        self.last_heartbeat = None

    def receive(self, message=None, timeout=1.0):
        if message not in (None, "HEARTBEAT", "GLOBAL_POSITION_INT") or not 0 <= timeout <= 5:
            raise RunFailure("runner_error", "receive expects an M1 message type and timeout in [0,5]")
        deadline = self.clock() + timeout
        while True:
            self.checkpoint()
            try:
                msg = self.transport.recv_match(blocking=False)
                packet = bytes(msg.get_msgbuf()) if msg is not None else None
            except RunFailure:
                raise
            except Exception as exc:
                raise RunFailure("connection_failed", f"Receiving telemetry: {type(exc).__name__}: {exc}") from exc
            if packet is not None:
                msgid = self.evidence.record(packet)
                if msgid == 0:
                    self.last_heartbeat = self.clock()
                name = {0: "HEARTBEAT", 33: "GLOBAL_POSITION_INT"}.get(msgid)
                if name and message in (None, name):
                    return {"type": name, "packet": packet}
            if self.clock() >= deadline:
                return None
            if packet is None:
                self.sleep(min(0.01, max(0, deadline - self.clock())))

    def wait_heartbeat(self, timeout=5):
        return self.receive("HEARTBEAT", timeout)

    def heartbeat_fresh(self, max_age=3):
        if not 0 < max_age <= 60:
            raise ValueError("max_age must be in (0,60]")
        return self.last_heartbeat is not None and self.clock() - self.last_heartbeat <= max_age
