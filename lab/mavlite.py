"""Small MAVLink codec for the M1 pilot interface (platform code, not a learner piece).

It decodes seven message types and encodes two. The wire format is plumbing:
the owner works with decoded messages, not with bytes (D-038, review A-01).
CRC extra values were checked against packets from a real SITL flight.
"""
import struct

CRC_EXTRA = {0: 50, 1: 124, 11: 89, 24: 24, 33: 104, 76: 152, 77: 143, 193: 71, 253: 83}

# id -> (name, struct format of the full payload, field names)
SPECS = {
    0: ("HEARTBEAT", "<IBBBBB",
        ("custom_mode", "type", "autopilot", "base_mode", "system_status", "mavlink_version")),
    1: ("SYS_STATUS", "<IIIHHhHHHHHHb",
        ("sensors_present", "sensors_enabled", "sensors_health", "load", "voltage_battery",
         "current_battery", "drop_rate_comm", "errors_comm", "errors_count1", "errors_count2",
         "errors_count3", "errors_count4", "battery_remaining")),
    24: ("GPS_RAW_INT", "<QiiiHHHHBB",
         ("time_usec", "lat", "lon", "alt", "eph", "epv", "vel", "cog", "fix_type", "satellites_visible")),
    33: ("GLOBAL_POSITION_INT", "<IiiiihhhH",
         ("time_boot_ms", "lat", "lon", "alt", "relative_alt", "vx", "vy", "vz", "hdg")),
    77: ("COMMAND_ACK", "<HBBiBB",
         ("command", "result", "progress", "result_param2", "target_system", "target_component")),
    193: ("EKF_STATUS_REPORT", "<5fHf",
          ("velocity_variance", "pos_horiz_variance", "pos_vert_variance", "compass_variance",
           "terrain_alt_variance", "flags", "airspeed_variance")),
    253: ("STATUSTEXT", "<B50sHB", ("severity", "text", "id", "chunk_seq")),
}
MSGID = {spec[0]: msgid for msgid, spec in SPECS.items()}

# Vocabulary. These are names for numbers. They are not mission logic.
CMD_NAV_LAND = 21
CMD_NAV_TAKEOFF = 22
CMD_DO_SET_MODE = 176
CMD_COMPONENT_ARM_DISARM = 400
CMD_SET_MESSAGE_INTERVAL = 511
MODE_GUIDED = 4          # ArduCopter custom_mode value
MODE_LAND = 9            # ArduCopter custom_mode value
BASE_MODE_ARMED = 128    # bit in HEARTBEAT.base_mode
EKF_POS_HORIZ_ABS = 16   # bit in EKF_STATUS_REPORT.flags
RESULT_NAMES = {0: "ACCEPTED", 1: "TEMPORARILY_REJECTED", 2: "DENIED", 3: "UNSUPPORTED",
                4: "FAILED", 5: "IN_PROGRESS", 6: "CANCELLED"}
SYSTEM_STATUS_NAMES = {0: "UNINIT", 1: "BOOT", 2: "CALIBRATING", 3: "STANDBY", 4: "ACTIVE",
                       5: "CRITICAL", 6: "EMERGENCY", 7: "POWEROFF", 8: "FLIGHT_TERMINATION"}

SOURCE_SYSTEM, SOURCE_COMPONENT = 255, 190
GCS_TARGET = (1, 1)


def checksum(data, extra):
    """MAVLink X.25 CRC over data plus the message CRC extra byte."""
    value = 0xFFFF
    for octet in bytes(data) + bytes([extra]):
        tmp = octet ^ (value & 255)
        tmp ^= (tmp << 4) & 255
        value = (value >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)
    return value & 0xFFFF


def split_packet(packet):
    """Return (msgid, sysid, compid, payload) for a MAVLink v1 or v2 packet.

    Raise ValueError for a bad frame or CRC, or for an unknown message id.
    """
    p = bytes(packet)
    if len(p) < 8 or p[0] not in (0xFE, 0xFD):
        raise ValueError("Not a MAVLink packet")
    v2 = p[0] == 0xFD
    header = 10 if v2 else 6
    signature = 13 if v2 and p[2] & 1 else 0
    end = header + p[1]
    if len(p) != end + 2 + signature:
        raise ValueError("Wrong packet length")
    msgid = int.from_bytes(p[7:10], "little") if v2 else p[5]
    sysid, compid = (p[5], p[6]) if v2 else (p[3], p[4])
    if msgid not in CRC_EXTRA:
        raise ValueError(f"Unknown message id {msgid}")
    if checksum(p[1:end], CRC_EXTRA[msgid]) != int.from_bytes(p[end:end + 2], "little"):
        raise ValueError("Bad packet checksum")
    return msgid, sysid, compid, p[header:end]


class Message:
    """A decoded message. Read a field as an attribute, for example `msg.custom_mode`."""

    def __init__(self, msgid, name, fields, sysid=1, compid=1):
        self.msgid, self.type, self.fields = msgid, name, fields
        self.sysid, self.compid = sysid, compid

    def __getattr__(self, name):
        try:
            return self.__dict__["fields"][name]
        except KeyError:
            raise AttributeError(f"{self.__dict__.get('type', 'message')} has no field '{name}'") from None

    def __repr__(self):
        return f"{self.type}({', '.join(f'{k}={v!r}' for k, v in self.fields.items())})"

    def pretty(self):
        """One readable line. It shows names and units. It is safe to print."""
        f = self.fields
        if self.type == "HEARTBEAT":
            state = SYSTEM_STATUS_NAMES.get(f["system_status"], f["system_status"])
            armed = "ARMED" if f["base_mode"] & BASE_MODE_ARMED else "disarmed"
            return f"HEARTBEAT custom_mode={f['custom_mode']} {armed} system_status={state}"
        if self.type == "GLOBAL_POSITION_INT":
            return f"GLOBAL_POSITION_INT relative_alt={f['relative_alt']} mm  alt={f['alt']} mm"
        if self.type == "COMMAND_ACK":
            result = RESULT_NAMES.get(f["result"], f["result"])
            return f"COMMAND_ACK command={f['command']} result={f['result']} ({result})"
        if self.type == "STATUSTEXT":
            return f"STATUSTEXT severity={f['severity']} text={f['text']!r}"
        if self.type == "GPS_RAW_INT":
            return f"GPS_RAW_INT fix_type={f['fix_type']} satellites_visible={f['satellites_visible']}"
        if self.type == "EKF_STATUS_REPORT":
            return f"EKF_STATUS_REPORT flags={f['flags']} (0x{f['flags']:X})"
        if self.type == "SYS_STATUS":
            return (f"SYS_STATUS present=0x{f['sensors_present']:X} enabled=0x{f['sensors_enabled']:X} "
                    f"health=0x{f['sensors_health']:X}")
        return repr(self)


def decode(packet):
    """Decode a packet to a Message. Return None for a valid packet of an unknown type."""
    try:
        msgid, sysid, compid, payload = split_packet(packet)
    except ValueError as error:
        if str(error).startswith("Unknown message id"):
            return None
        raise
    if msgid not in SPECS:
        return None
    name, fmt, names = SPECS[msgid]
    values = struct.unpack(fmt, payload.ljust(struct.calcsize(fmt), b"\0")[:struct.calcsize(fmt)])
    fields = dict(zip(names, values))
    if "text" in fields:
        fields["text"] = fields["text"].split(b"\0", 1)[0].decode("ascii", "replace")
    return Message(msgid, name, fields, sysid, compid)


def _encode(msgid, payload, sequence):
    # MAVLink 2 trims trailing zero bytes but keeps at least one byte.
    payload = payload.rstrip(b"\0") or payload[:1]
    body = bytes([len(payload), 0, 0, sequence % 256, SOURCE_SYSTEM, SOURCE_COMPONENT]) + msgid.to_bytes(3, "little") + payload
    return b"\xfd" + body + checksum(body, CRC_EXTRA[msgid]).to_bytes(2, "little")


def encode_command_long(command, params=(), *, target=GCS_TARGET, sequence=0):
    """Encode COMMAND_LONG. `params` has up to seven numbers (param1 to param7)."""
    values = [float(v) for v in params]
    if len(values) > 7:
        raise ValueError("COMMAND_LONG has seven parameters")
    values += [0.0] * (7 - len(values))
    payload = struct.pack("<7fHBBB", *values, command, target[0], target[1], 0)
    return _encode(76, payload, sequence)


def encode_set_mode(custom_mode, *, target_system=1, sequence=0):
    """Encode SET_MODE with the custom-mode flag set."""
    return _encode(11, struct.pack("<IBB", custom_mode, target_system, 1), sequence)
