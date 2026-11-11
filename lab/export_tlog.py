"""Convert a MAVLink tlog into the replay files of the viewer (viewer/FORMAT.md).

Reads a binary tlog (8-byte big-endian microsecond timestamp + one MAVLink
v1 or v2 frame per record, as written by MAVProxy and pymavlink). Writes
`viewer.json` (position, attitude, mode, armed) and a derived `result.json`
(COMMAND_ACK, STATUSTEXT, mode and armed changes as replay events).

The reader uses only the Python standard library. Reason: the CI Python job
and the host have no pymavlink. The reader decodes only five message types and
checks the CRC of each frame. The tests compare it with pymavlink when
pymavlink is installed (the container venv).

The exporter uses only data that the tlog contains. It reads no simulator
truth.

Usage: python3 -m lab.export_tlog TLOG OUT_DIR [--run-id ID] [--t0 MODE]
"""
import argparse
import json
import math
from pathlib import Path
import struct
import sys

SCHEMA_VERSION = 1
GENERATOR = "lab/export_tlog.py"
EARTH_RADIUS_M = 6378137.0

# MAVLink message ids and CRC extras (common.xml). Fields are in wire order.
# msgid: (name, crc_extra, struct format of the base fields, extension format)
KNOWN = {
    0: ("HEARTBEAT", 50, "<IBBBBB", ""),
    30: ("ATTITUDE", 39, "<Iffffff", ""),
    33: ("GLOBAL_POSITION_INT", 104, "<IiiiihhhH", ""),
    77: ("COMMAND_ACK", 143, "<HB", "BiBB"),
    253: ("STATUSTEXT", 83, "<B50s", "HB"),
}

MAV_TYPE_GCS = 6
MAV_AUTOPILOT_INVALID = 8
BASE_MODE_ARMED = 0x80
HDG_UNKNOWN = 65535
# MAV_TYPE values that use ArduCopter flight mode numbers.
COPTER_TYPES = {2, 3, 4, 13, 14, 15}

COPTER_MODES = {
    0: "STABILIZE", 1: "ACRO", 2: "ALT_HOLD", 3: "AUTO", 4: "GUIDED",
    5: "LOITER", 6: "RTL", 7: "CIRCLE", 9: "LAND", 11: "DRIFT", 13: "SPORT",
    14: "FLIP", 15: "AUTOTUNE", 16: "POSHOLD", 17: "BRAKE", 18: "THROW",
    19: "AVOID_ADSB", 20: "GUIDED_NOGPS", 21: "SMART_RTL", 22: "FLOWHOLD",
    23: "FOLLOW", 24: "ZIGZAG", 25: "SYSTEMID", 26: "AUTOROTATE", 27: "AUTO_RTL",
}
SEVERITIES = ["emergency", "alert", "critical", "error", "warning", "notice", "info", "debug"]
COMMANDS = {
    20: "nav_return_to_launch", 21: "nav_land", 22: "nav_takeoff", 176: "do_set_mode",
    246: "preflight_reboot_shutdown", 400: "component_arm_disarm",
    410: "get_home_position", 511: "set_message_interval",
}
RESULTS = ["accepted", "temporarily_rejected", "denied", "unsupported", "failed", "in_progress", "cancelled"]

MIN_PLAUSIBLE_TIMESTAMP_US = 10 ** 15  # year 2001; a tlog written by MAVProxy is later


class TlogError(Exception):
    """The tlog cannot be converted."""


def crc16(data, extra):
    """MAVLink X.25 checksum over data, then the message CRC extra byte."""
    crc = 0xFFFF
    for byte in bytes(data) + bytes([extra]):
        tmp = byte ^ (crc & 0xFF)
        tmp = (tmp ^ (tmp << 4)) & 0xFF
        crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF
    return crc


def _frame_at(buf, pos):
    """Parse one frame at buf[pos]. Return (msgid, sysid, compid, payload, end) or None.

    None means: no valid frame here. Frames of unknown message type are
    accepted by length only (no CRC extra is known), with msgid and payload
    set to None for the payload.
    """
    magic = buf[pos]
    if magic == 0xFE:
        if pos + 6 > len(buf):
            return None
        length, sysid, compid, msgid = buf[pos + 1], buf[pos + 3], buf[pos + 4], buf[pos + 5]
        head, signed = 6, 0
    elif magic == 0xFD:
        if pos + 10 > len(buf):
            return None
        length, incompat = buf[pos + 1], buf[pos + 2]
        if incompat & ~0x01:
            return None
        sysid, compid = buf[pos + 5], buf[pos + 6]
        msgid = buf[pos + 7] | (buf[pos + 8] << 8) | (buf[pos + 9] << 16)
        head, signed = 10, 13 if incompat & 0x01 else 0
    else:
        return None
    end = pos + head + length + 2 + signed
    if end > len(buf):
        return None
    payload = buf[pos + head:pos + head + length]
    if msgid in KNOWN:
        crc_extra = KNOWN[msgid][1]
        want = struct.unpack_from("<H", buf, pos + head + length)[0]
        if crc16(buf[pos + 1:pos + head + length], crc_extra) != want:
            return None
    else:
        payload = None
    return msgid, sysid, compid, payload, end


def iter_records(buf):
    """Yield (timestamp_us, msgid, sysid, compid, payload) and finally a stats dict.

    The generator yields tuples for records. Its last item is a dict with
    `records` and `skipped_bytes`. A bad frame makes the reader scan forward
    one byte at a time until a plausible timestamp and a valid frame follow.
    """
    pos, size, records, skipped = 0, len(buf), 0, 0
    last_ts = 0
    while pos + 8 + 8 <= size:
        ts = struct.unpack_from(">Q", buf, pos)[0]
        frame = None
        if ts >= MIN_PLAUSIBLE_TIMESTAMP_US and (not last_ts or abs(ts - last_ts) < 86400 * 10 ** 6):
            frame = _frame_at(buf, pos + 8)
        if frame is None:
            pos += 1
            skipped += 1
            continue
        msgid, sysid, compid, payload, end = frame
        last_ts = ts
        records += 1
        pos = end
        yield ts, msgid, sysid, compid, payload
    skipped += max(0, size - pos)
    yield {"records": records, "skipped_bytes": skipped}


def _decode(msgid, payload):
    """Return a tuple of field values.

    A v2 sender removes trailing zero bytes, and a v1 frame has no extension
    fields. In both cases the missing bytes are zero.
    """
    _, _, base, ext = KNOWN[msgid]
    fmt = base + ext
    want = struct.calcsize(fmt)
    if len(payload) < want:
        payload = payload + bytes(want - len(payload))
    return struct.unpack_from(fmt, payload)


def mode_name(vehicle_type, custom_mode):
    if vehicle_type in COPTER_TYPES and custom_mode in COPTER_MODES:
        return COPTER_MODES[custom_mode]
    return "MODE_%d" % custom_mode


def parse_tlog(buf):
    """Decode a tlog into plain lists. Raise TlogError if it has no usable data.

    The vehicle is the first system that sends a HEARTBEAT that is not from a
    ground station and not from an invalid autopilot. Only messages from that
    system are used. MAVProxy writes its own GCS heartbeat into the tlog; the
    exporter skips it.
    """
    heartbeats, positions, attitudes, acks, texts = [], [], [], [], []
    vehicle = None  # (sysid, compid) of the first vehicle heartbeat
    first_ts = last_ts = None
    stats = {"records": 0, "skipped_bytes": 0, "time_backwards": 0}
    running_max = 0
    for item in iter_records(buf):
        if isinstance(item, dict):
            stats.update(item)
            break
        ts, msgid, sysid, compid, payload = item
        if ts < running_max:
            stats["time_backwards"] += 1
            ts = running_max
        running_max = ts
        if first_ts is None:
            first_ts = ts
        last_ts = ts
        if payload is None:
            continue
        if msgid == 0:
            custom_mode, vtype, autopilot, base_mode, _status, _ver = _decode(0, payload)
            if vehicle is None and vtype != MAV_TYPE_GCS and autopilot != MAV_AUTOPILOT_INVALID:
                vehicle = (sysid, compid)
            heartbeats.append((ts, sysid, compid, vtype, custom_mode, 1 if base_mode & BASE_MODE_ARMED else 0))
        elif msgid == 33:
            _t, lat, lon, _alt, rel, _vx, _vy, vz, hdg = _decode(33, payload)
            positions.append((ts, sysid, lat, lon, rel, vz, hdg))
        elif msgid == 30:
            _t, roll, pitch, yaw, *_rates = _decode(30, payload)
            attitudes.append((ts, sysid, roll, pitch, yaw))
        elif msgid == 77:
            command, result = _decode(77, payload)[:2]
            acks.append((ts, sysid, command, result))
        elif msgid == 253:
            severity, raw = _decode(253, payload)[:2]
            text = raw.split(b"\0", 1)[0].decode("utf-8", errors="replace")
            texts.append((ts, sysid, severity, text))
    if first_ts is None:
        raise TlogError("no valid MAVLink records in the tlog")
    if vehicle is None:
        raise TlogError("no vehicle HEARTBEAT in the tlog")
    sysid = vehicle[0]
    return {
        "first_ts": first_ts, "last_ts": last_ts, "stats": stats,
        "heartbeats": [(h[0],) + h[3:] for h in heartbeats if h[1:3] == vehicle],
        "positions": [(p[0],) + p[2:] for p in positions if p[1] == sysid],
        "attitudes": [(a[0],) + a[2:] for a in attitudes if a[1] == sysid],
        "acks": [(a[0],) + a[2:] for a in acks if a[1] == sysid],
        "texts": [(t[0],) + t[2:] for t in texts if t[1] == sysid],
    }


def _clean(value, digits):
    value = round(value, digits)
    return 0.0 if value == 0 else value  # no negative zero


def build_replay(data, run_id="tlog-export", t0="first-record"):
    """Return (viewer_json, result_json) dictionaries from parse_tlog output."""
    if t0 not in ("first-record", "first-position"):
        raise TlogError("t0 must be first-record or first-position")
    positions, heartbeats = data["positions"], data["heartbeats"]
    t0_us = data["first_ts"]
    if t0 == "first-position":
        if not positions:
            raise TlogError("no GLOBAL_POSITION_INT in the tlog")
        t0_us = positions[0][0]

    modes, mode_index = [], {}
    series = {k: [] for k in ("t", "n", "e", "d", "alt", "vz", "mode", "armed", "hdg")}
    have_att = bool(data["attitudes"])
    if have_att:
        series.update(roll=[], pitch=[], yaw=[])
    notes = {"samples_without_heartbeat": 0, "samples_before_t0": 0}
    lat0 = lon0 = None
    hb_i = att_i = -1
    last_hdg = 0.0
    for ts, lat, lon, rel, vz, hdg in positions:
        while hb_i + 1 < len(heartbeats) and heartbeats[hb_i + 1][0] <= ts:
            hb_i += 1
        if hb_i < 0:
            notes["samples_without_heartbeat"] += 1
            continue
        if ts < t0_us:
            notes["samples_before_t0"] += 1
            continue
        if lat0 is None:
            lat0, lon0 = lat, lon  # home: first accepted sample (FORMAT.md)
        n = math.radians((lat - lat0) / 1e7) * EARTH_RADIUS_M
        e = math.radians((lon - lon0) / 1e7) * EARTH_RADIUS_M * math.cos(math.radians(lat0 / 1e7))
        alt = rel / 1000.0
        if hdg != HDG_UNKNOWN:
            last_hdg = hdg / 100.0
        _, vtype, custom_mode, armed = heartbeats[hb_i]
        name = mode_name(vtype, custom_mode)
        if name not in mode_index:
            mode_index[name] = len(modes)
            modes.append(name)
        series["t"].append(_clean((ts - t0_us) / 1e6, 6))
        series["n"].append(_clean(n, 3))
        series["e"].append(_clean(e, 3))
        series["d"].append(_clean(-alt, 3))
        series["alt"].append(_clean(alt, 3))
        series["vz"].append(_clean(vz / 100.0, 3))
        series["mode"].append(mode_index[name])
        series["armed"].append(armed)
        series["hdg"].append(_clean(last_hdg, 2))
        if have_att:
            att = data["attitudes"]
            while att_i + 1 < len(att) and att[att_i + 1][0] <= ts:
                att_i += 1
            _, roll, pitch, yaw = att[max(att_i, 0)]  # before the first ATTITUDE: the first one
            series["roll"].append(_clean(math.degrees(roll), 2))
            series["pitch"].append(_clean(math.degrees(pitch), 2))
            series["yaw"].append(_clean(math.degrees(yaw) % 360.0, 2))
    if not modes:
        modes = ["UNKNOWN"]  # the viewer needs a modes table; an empty series is valid

    events = []
    dropped = 0

    def add(ts, kind):
        nonlocal dropped
        if ts < t0_us:
            dropped += 1
            return
        events.append((ts - t0_us, kind))

    prev_mode = prev_armed = None
    for ts, vtype, custom_mode, armed in heartbeats:
        name = mode_name(vtype, custom_mode)
        if prev_mode is not None and name != prev_mode:
            add(ts, "mode:" + name)
        if prev_armed is not None and armed != prev_armed:
            add(ts, "armed" if armed else "disarmed")
        prev_mode, prev_armed = name, armed
    for ts, command, result in data["acks"]:
        cmd = COMMANDS.get(command, "cmd_%d" % command)
        res = RESULTS[result] if result < len(RESULTS) else "result_%d" % result
        add(ts, "ack:%s:%s" % (cmd, res))
    for ts, severity, text in data["texts"]:
        sev = SEVERITIES[severity] if severity < len(SEVERITIES) else "severity_%d" % severity
        add(ts, "statustext:%s: %s" % (sev, text))
    events.sort(key=lambda item: item[0])  # stable: keeps order for equal times

    duration_us = data["last_ts"] - t0_us
    stats = data["stats"]
    viewer = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "source": {
            "kind": "tlog", "generator": GENERATOR, "t0": t0,
            "t0_unix_us": t0_us, "tlog_records": stats["records"],
        },
        "frame": {"name": "NED", "origin": "home", "units": "m"},
        "pad": {"n": 0.0, "e": 0.0},
        "modes": modes,
        "series": series,
    }
    result = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "derived": True,
        "note": "Events derived from the tlog by %s. This is not an M1 result: it has no verdict." % GENERATOR,
        "duration_us": duration_us,
        "tlog_records": stats["records"],
        "events": [{"t_us": t, "kind": k, "source": "autopilot"} for t, k in events],
    }
    notes.update(
        dropped_events_before_t0=dropped, skipped_bytes=stats["skipped_bytes"],
        time_backwards=stats["time_backwards"],
    )
    return viewer, result, notes


def export(tlog_path, out_dir, run_id=None, t0="first-record"):
    """Write viewer.json and result.json into out_dir. Return a summary dict."""
    tlog_path, out_dir = Path(tlog_path), Path(out_dir)
    try:
        buf = tlog_path.read_bytes()
    except OSError as exc:
        raise TlogError("cannot read tlog: %s" % exc.strerror) from exc
    viewer, result, notes = build_replay(parse_tlog(buf), run_id or tlog_path.parent.name or "tlog-export", t0)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, doc in (("viewer.json", viewer), ("result.json", result)):
        (out_dir / name).write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    return {
        "samples": len(viewer["series"]["t"]), "events": len(result["events"]),
        "tlog_records": result["tlog_records"], "duration_s": result["duration_us"] / 1e6,
        "modes": viewer["modes"], **notes,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Export a MAVLink tlog to viewer replay files.")
    parser.add_argument("tlog", help="input tlog file")
    parser.add_argument("out_dir", help="output directory (viewer.json and result.json are written here)")
    parser.add_argument("--run-id", help="run id shown in the viewer (default: name of the tlog directory)")
    parser.add_argument(
        "--t0", choices=("first-record", "first-position"), default="first-record",
        help="time zero: first tlog record (default) or first GLOBAL_POSITION_INT (drops earlier events)",
    )
    args = parser.parse_args(argv)
    try:
        summary = export(args.tlog, args.out_dir, args.run_id, args.t0)
    except TlogError as exc:
        print("export_tlog: %s" % exc, file=sys.stderr)
        return 1
    for key, value in summary.items():
        print("%s: %s" % (key, value))
    return 0


if __name__ == "__main__":
    sys.exit(main())
