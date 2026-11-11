"""Synthetic autopilot support. This module does not control SITL."""
import struct
import time

from lab.link import packet_info


def read_selected_tlog(path):
    records = []
    with path.open("rb") as stream:
        while timestamp := stream.read(8):
            if len(timestamp) != 8:
                raise ValueError("Incomplete tlog timestamp")
            prefix = stream.read(2)
            if len(prefix) != 2 or prefix[0] not in (254, 253):
                raise ValueError("Invalid tlog frame")
            header_size = 6 if prefix[0] == 254 else 10
            header = prefix + stream.read(header_size - 2)
            signature_size = 13 if prefix[0] == 253 and len(header) > 2 and header[2] & 1 else 0
            packet = header + stream.read(prefix[1] + 2 + signature_size)
            if len(packet) != header_size + prefix[1] + 2 + signature_size:
                raise ValueError("Incomplete tlog frame")
            selected = packet_info(packet)
            if selected is not None:
                records.append((int.from_bytes(timestamp, "big"), *selected))
    return records


CRC_EXTRA = {0: 50, 11: 89, 33: 104, 76: 152}


def checksum(data):
    value = 65535
    for octet in data:
        value ^= octet
        for bit in range(8):
            value = (value >> 1) ^ (0x8408 if value & 1 else 0)
    return value


def wire(message_id, payload, sequence=0):
    body = bytes([len(payload), sequence % 256, 1, 1, message_id]) + payload
    return b"\xfe" + body + struct.pack("<H", checksum(body + bytes([CRC_EXTRA[message_id]])))


def unpack_wire(packet):
    if len(packet) < 8 or packet[0] not in (254, 253):
        raise ValueError("Expected MAVLink wire packet")
    header = 6 if packet[0] == 254 else 10
    message_id = packet[5] if header == 6 else int.from_bytes(packet[7:10], "little")
    signature = 13 if header == 10 and packet[2] & 1 else 0
    end = header + packet[1]
    if len(packet) != end + 2 + signature or message_id not in CRC_EXTRA:
        raise ValueError("Unsupported or incomplete packet")
    if checksum(packet[1:end] + bytes([CRC_EXTRA[message_id]])) != int.from_bytes(packet[end:end + 2], "little"):
        raise ValueError("Invalid packet checksum")
    return message_id, packet[header:end]


class Message:
    def __init__(self, packet):
        self.packet = packet

    def get_msgbuf(self):
        return self.packet


def metadata(run_id, scenario="m1-fake"):
    return dict(run_id=run_id, seed=42, scenario={"name": scenario}, mode="offline",
                versions={"ardupilot": "synthetic-not-SITL", "container": "synthetic@sha256:" + "a" * 64},
                git={"commit": "b" * 40, "dirty": True}, host="synthetic",
                input_sources=["runner", "autopilot"])


class FakeAutopilot:
    """Emit synthetic MAVLink telemetry. Validate commands without generating a mission."""

    def __init__(self, fault=None, clock=time.monotonic):
        self.fault = fault
        self.clock = clock
        self.origin = clock()
        self.next_pair = self.origin
        self.pending = []
        self.mode = 0
        self.armed = False
        self.arm_observed = False
        self.ready_observed = False
        self.guided_observed = False
        self.disarm_observed = False
        self.takeoff_at = None
        self.land_at = None
        self.reached_at = None
        self.altitude = 0
        self.sequence = 0
        self.closed = False
        self.commands = []
        self.violations = []

    def recv_match(self, blocking=False):
        if blocking:
            raise ValueError("Fake transport requires nonblocking reads")
        now = self.clock()
        if self.closed or self.fault == "no_heartbeat":
            return None
        if self.fault == "telemetry_lost" and self.takeoff_at is not None:
            return None
        if not self.pending:
            if now < self.next_pair:
                return None
            self.next_pair = now + 0.05
            if self.takeoff_at is not None and self.fault != "climb_stuck":
                self.altitude = min(5000, int((now - self.takeoff_at) * 25000))
            if self.land_at is not None:
                self.altitude = max(0, 5000 - int((now - self.land_at) * 25000))
                if self.altitude == 0 and self.fault != "disarm_stuck":
                    self.armed = False
            if self.altitude >= 4750 and self.reached_at is None:
                self.reached_at = now
            status = 1 if self.fault == "not_ready" else (4 if self.armed else 3)
            heartbeat = struct.pack("<IBBBBB", self.mode, 2, 3, 1 | (128 if self.armed else 0), status, 3)
            position = struct.pack("<IiiiihhhH", int((now - self.origin) * 1000), 0, 0,
                                   self.altitude, self.altitude, 0, 0, 0, 0)
            self.pending = [wire(0, heartbeat, self.sequence), wire(33, position, self.sequence + 1)]
            self.sequence += 2
        packet = self.pending.pop(0)
        message_id, payload = unpack_wire(packet)
        if message_id == 0:
            if payload[7] == 3 and not payload[6] & 128:
                self.ready_observed = True
            if int.from_bytes(payload[:4], "little") == 4:
                self.guided_observed = True
            if payload[6] & 128:
                self.arm_observed = True
            elif self.land_at is not None and self.altitude == 0:
                self.disarm_observed = True
        return Message(packet)

    def write(self, packet):
        message_id, payload = unpack_wire(packet)
        now = self.clock()
        if message_id == 0:
            return
        if message_id == 11:
            mode, target, flags = struct.unpack("<IBB", payload.ljust(6, b"\0"))
            self.commands.append(("mode", now, mode))
            self._guided(mode, target, flags)
            return
        if message_id != 76:
            self.violations.append("Unexpected outbound telemetry")
            return
        values = struct.unpack("<7fHBBB", payload.ljust(33, b"\0"))
        parameters, command, target, component = values[:7], values[7], values[8], values[9]
        self.commands.append((command, now, parameters))
        if target != 1 or component not in (0, 1):
            self.violations.append("Wrong command target")
        if command == 176:
            self._guided(int(parameters[1]), target, int(parameters[0]))
        elif command == 400:
            if parameters[0] != 1 or not self.ready_observed or not self.guided_observed or self.mode != 4 or self.fault == "not_ready":
                self.violations.append("Arm before readiness and GUIDED, or explicit disarm")
            elif self.fault != "arm_stuck":
                self.armed = True
        elif command == 22:
            if not self.armed or not self.arm_observed or self.mode != 4 or parameters[6] != 5:
                self.violations.append("Takeoff before armed heartbeat, or wrong height")
            self.takeoff_at = now
        elif command == 21:
            self._land(now)
        elif command != 511:
            self.violations.append("Unexpected command")

    def _guided(self, mode, target, flags):
        if target != 1 or not flags & 1:
            self.violations.append("Invalid mode target or flag")
            return
        if mode == 9:
            self._land(self.clock())
            return
        if mode != 4 or not self.ready_observed or self.fault == "not_ready":
            self.violations.append("Invalid GUIDED request")
        elif self.fault != "mode_stuck":
            self.mode = mode

    def _land(self, now):
        if self.reached_at is None or now - self.reached_at < 5:
            self.violations.append("LAND before height and five-second hold")
        self.land_at = now

    def close(self):
        self.closed = True
