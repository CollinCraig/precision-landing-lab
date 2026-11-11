"""Exchange mission-neutral JSON lines with the M1 runner."""
import base64
import json
import math
import sys

from lab.link import RECEIVE_TYPES


class MissionClient:
    """Use one request at a time. Keep stdout for protocol messages only."""

    def __init__(self, reader=None, writer=None):
        self.reader = sys.stdin if reader is None else reader
        self.writer = sys.stdout if writer is None else writer
        self.initial = self._read()
        if self.initial.get("protocol") != "m1-child-v1":
            raise ValueError("Unsupported runner protocol")
        self.finished = False

    def _read(self):
        line = self.reader.readline(4097)
        if not line or len(line.encode("utf-8")) > 4096 or not line.endswith("\n"):
            raise ValueError("Missing or oversized runner line")
        response = json.loads(line)
        if not isinstance(response, dict):
            raise ValueError("Runner response must be an object")
        return response

    def _write(self, request):
        if self.finished:
            raise ValueError("Outcome already sent")
        line = json.dumps(request, allow_nan=False, separators=(",", ":")) + "\n"
        if len(line.encode("utf-8")) > 4096:
            raise ValueError("Oversized request")
        self.writer.write(line)
        self.writer.flush()

    def receive(self, message_type=None, timeout=1.0):
        """Return wire bytes or None. Use a timeout from zero to five seconds."""
        if message_type not in (None,) + RECEIVE_TYPES:
            raise ValueError("Unsupported receive type")
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 <= timeout <= 5:
            raise ValueError("Invalid receive timeout")
        self._write({"op": "receive", "type": message_type, "timeout": timeout})
        response = self._read()
        if response == {"packet": None}:
            return None
        if set(response) != {"type", "packet"} or response["type"] not in RECEIVE_TYPES:
            raise ValueError("Invalid receive response")
        if message_type is not None and response["type"] != message_type:
            raise ValueError("Unexpected receive type")
        return base64.b64decode(response["packet"], validate=True)

    def send(self, packet):
        """Send one encoded wire packet. Transport acceptance does not confirm aircraft state."""
        packet = bytes(packet)
        if not 1 <= len(packet) <= 280:
            raise ValueError("Invalid packet length")
        self._write({"op": "send", "packet": base64.b64encode(packet).decode("ascii")})
        if self._read() != {"sent": len(packet)}:
            raise ValueError("Invalid send response")

    def event(self, kind, source="runner"):
        """Record a declared event. Do not use reserved lifecycle names."""
        self._write({"op": "event", "kind": kind, "source": source})
        if self._read() != {"recorded": True}:
            raise ValueError("Invalid event response")

    def outcome(self, success, code=None, detail=None):
        """Send the final outcome. Do not read a response after this request."""
        if type(success) is not bool:
            raise ValueError("Outcome success must be boolean")
        from lab.link import RunFailure

        if success:
            if code is not None or detail is not None:
                raise ValueError("Success cannot contain a failure reason")
            reason = None
        else:
            if not isinstance(detail, str) or not detail.strip():
                raise ValueError("Failure detail is required")
            failure = RunFailure(code, detail)
            reason = {"code": failure.code, "detail": failure.detail}
        self._write({"op": "outcome", "success": success, "failure_reason": reason})
        self.finished = True
