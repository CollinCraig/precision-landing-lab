"""Convert a MAVLink tlog into the replay files of the viewer (viewer/FORMAT.md).

Reads a binary tlog (8-byte big-endian microsecond timestamp + one MAVLink
v1 or v2 frame per record, as written by MAVProxy and pymavlink). Writes
`viewer.json` (position, attitude, mode, armed) and a derived `result.json`
(COMMAND_ACK, STATUSTEXT, mode and armed changes as replay events).

The reader uses only the Python standard library. Reason: the CI Python job
and the host have no pymavlink. The reader decodes only five message types. It
checks the CRC of every frame, also of the types it does not decode, with the
table in lab/mavlink_crc_extra.py. The tests compare it with pymavlink when
pymavlink is installed (the container venv).

The exporter uses only data that the tlog contains. It reads no simulator
truth.

Usage: python3 -m lab.export_tlog TLOG OUT_DIR [--run-id ID] [--t0 MODE]
       [--verdict PASS|FAIL] [--viewer-only] [--sysid N] [--compid N]
"""
import argparse
import json
import math
from pathlib import Path
import struct
import sys

from lab.mavlink_crc_extra import CRC_EXTRA

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
MAX_PLAUSIBLE_TIMESTAMP_US = 4 * 10 ** 15  # year 2096
LARGE_GAP_US = 86400 * 10 ** 6  # a gap above one day is reported, never fatal
VERDICTS = {"PASS": True, "FAIL": False}


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

    None means: no valid frame here. Every frame must have a msgid of the
    ardupilotmega dialect and a valid CRC (checked with CRC_EXTRA). A frame of
    a supported message type must also have a valid payload length (MAVLink v1:
    the exact base length; v2: 1 byte up to the full length, because the sender
    removes trailing zero bytes). For a frame of another type the payload is
    None; the reader does not decode it.
    """
    magic = buf[pos]
    if magic == 0xFE:
        if pos + 6 > len(buf):
            return None
        length, sysid, compid, msgid = buf[pos + 1], buf[pos + 3], buf[pos + 4], buf[pos + 5]
        head, signed, v1 = 6, 0, True
    elif magic == 0xFD:
        if pos + 10 > len(buf):
            return None
        length, incompat = buf[pos + 1], buf[pos + 2]
        if incompat & ~0x01:
            return None
        sysid, compid = buf[pos + 5], buf[pos + 6]
        msgid = buf[pos + 7] | (buf[pos + 8] << 8) | (buf[pos + 9] << 16)
        head, signed, v1 = 10, 13 if incompat & 0x01 else 0, False
    else:
        return None
    crc_extra = CRC_EXTRA.get(msgid)
    if crc_extra is None:
        return None
    end = pos + head + length + 2 + signed
    if end > len(buf):
        return None
    payload = buf[pos + head:pos + head + length]
    if msgid in KNOWN:
        _, _, base, ext = KNOWN[msgid]
        base_len, full_len = struct.calcsize(base), struct.calcsize(base + ext)
        if v1 and length != base_len:
            return None
        if not v1 and not 1 <= length <= full_len:
            return None
    want = struct.unpack_from("<H", buf, pos + head + length)[0]
    if crc16(buf[pos + 1:pos + head + length], crc_extra) != want:
        return None
    if msgid not in KNOWN:
        payload = None
    return msgid, sysid, compid, payload, end


def iter_records(buf):
    """Yield (timestamp_us, msgid, sysid, compid, payload) and finally a stats dict.

    The generator yields tuples for records. Its last item is a dict with
    `records`, `skipped_bytes` and `large_gaps`. A bad frame makes the reader
    scan forward one byte at a time until a plausible timestamp and a frame
    with a valid CRC follow. A gap of more than one day between records is
    counted in `large_gaps`; the reader continues after it.
    """
    pos, size, records, skipped, gaps = 0, len(buf), 0, 0, 0
    last_ts = 0
    while pos + 8 + 8 <= size:
        ts = struct.unpack_from(">Q", buf, pos)[0]
        frame = None
        if MIN_PLAUSIBLE_TIMESTAMP_US <= ts <= MAX_PLAUSIBLE_TIMESTAMP_US:
            frame = _frame_at(buf, pos + 8)
        if frame is None:
            pos += 1
            skipped += 1
            continue
        msgid, sysid, compid, payload, end = frame
        if last_ts and ts - last_ts > LARGE_GAP_US:
            gaps += 1
        last_ts = max(last_ts, ts)
        records += 1
        pos = end
        yield ts, msgid, sysid, compid, payload
    skipped += max(0, size - pos)
    yield {"records": records, "skipped_bytes": skipped, "large_gaps": gaps}


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


def parse_tlog(buf, sysid=None, compid=None):
    """Decode a tlog into plain lists. Raise TlogError if it has no usable data.

    The vehicle is the first (system, component) that sends a HEARTBEAT that is
    not from a ground station and not from an invalid autopilot. You can select
    another vehicle with `sysid` and `compid`. Only messages from that system
    and component are used. MAVProxy writes its own GCS heartbeat into the
    tlog, and other components (gimbal, companion computer) send their own
    position or attitude. The exporter skips them.
    """
    heartbeats, positions, attitudes, acks, texts = [], [], [], [], []
    vehicle = None
    if sysid is not None or compid is not None:
        if sysid is None or compid is None:
            raise TlogError("give both sysid and compid, or neither")
        vehicle = (sysid, compid)
    first_ts = last_ts = None
    stats = {"records": 0, "skipped_bytes": 0, "large_gaps": 0, "time_backwards": 0, "nonfinite_attitudes": 0}
    running_max = 0
    for item in iter_records(buf):
        if isinstance(item, dict):
            stats.update(item)
            break
        ts, msgid, src_sys, src_comp, payload = item
        if ts < running_max:
            stats["time_backwards"] += 1
            ts = running_max
        running_max = ts
        if first_ts is None:
            first_ts = ts
        last_ts = ts
        if payload is None:
            continue
        src = (src_sys, src_comp)
        if msgid == 0:
            custom_mode, vtype, autopilot, base_mode, _status, _ver = _decode(0, payload)
            if vehicle is None and vtype != MAV_TYPE_GCS and autopilot != MAV_AUTOPILOT_INVALID:
                vehicle = src
            heartbeats.append((ts, src, vtype, custom_mode, 1 if base_mode & BASE_MODE_ARMED else 0))
        elif msgid == 33:
            _t, lat, lon, _alt, rel, _vx, _vy, vz, hdg = _decode(33, payload)
            positions.append((ts, src, lat, lon, rel, vz, hdg))
        elif msgid == 30:
            _t, roll, pitch, yaw, *_rates = _decode(30, payload)
            if not all(math.isfinite(v) for v in (roll, pitch, yaw)):
                stats["nonfinite_attitudes"] += 1
                roll = pitch = yaw = None  # unknown; JSON has no NaN
            attitudes.append((ts, src, roll, pitch, yaw))
        elif msgid == 77:
            command, result = _decode(77, payload)[:2]
            acks.append((ts, src, command, result))
        elif msgid == 253:
            severity, raw = _decode(253, payload)[:2]
            text = raw.split(b"\0", 1)[0].decode("utf-8", errors="replace")
            texts.append((ts, src, severity, text))
    if first_ts is None:
        raise TlogError("no valid MAVLink records in the tlog")
    if vehicle is None:
        raise TlogError("no vehicle HEARTBEAT in the tlog")
    own = [h for h in heartbeats if h[1] == vehicle]
    if not own:
        raise TlogError("no HEARTBEAT from sysid %d compid %d in the tlog" % vehicle)
    return {
        "first_ts": first_ts, "last_ts": last_ts, "stats": stats, "vehicle": vehicle,
        "heartbeats": [(h[0],) + h[2:] for h in own],
        "positions": [(p[0],) + p[2:] for p in positions if p[1] == vehicle],
        "attitudes": [(a[0],) + a[2:] for a in attitudes if a[1] == vehicle],
        "acks": [(a[0],) + a[2:] for a in acks if a[1] == vehicle],
        "texts": [(t[0],) + t[2:] for t in texts if t[1] == vehicle],
    }


def _clean(value, digits):
    value = round(value, digits)
    return 0.0 if value == 0 else value  # no negative zero


def build_replay(data, run_id="tlog-export", t0="first-record", verdict=None):
    """Return (viewer_json, result_json, notes) from parse_tlog output.

    `verdict` is None, "PASS" or "FAIL". The tlog has no verdict, so the
    operator supplies it. The result then has `success` for the viewer.
    """
    if t0 not in ("first-record", "first-position"):
        raise TlogError("t0 must be first-record or first-position")
    if verdict is not None:
        verdict = str(verdict).upper()
        if verdict not in VERDICTS:
            raise TlogError("verdict must be one of: %s" % ", ".join(VERDICTS))
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
            if att_i < 0 or att[att_i][1] is None:
                roll = pitch = yaw = None  # no attitude yet (never a later one), or not finite
            else:
                _, roll, pitch, yaw = att[att_i]
                roll, pitch = _clean(math.degrees(roll), 2), _clean(math.degrees(pitch), 2)
                yaw = _clean(math.degrees(yaw) % 360.0, 2)
            series["roll"].append(roll)
            series["pitch"].append(pitch)
            series["yaw"].append(yaw)
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
            "sysid": data["vehicle"][0], "compid": data["vehicle"][1],
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
    if verdict is not None:
        result["success"] = VERDICTS[verdict]
        result["verdict"] = verdict
        result["verdict_source"] = "operator"
        result["note"] = (
            "Events derived from the tlog by %s. The verdict %s comes from the operator, not from the tlog."
            % (GENERATOR, verdict)
        )
    notes.update(
        dropped_events_before_t0=dropped, skipped_bytes=stats["skipped_bytes"],
        time_backwards=stats["time_backwards"], large_gaps=stats["large_gaps"],
        nonfinite_attitudes=stats["nonfinite_attitudes"],
        vehicle="sysid %d compid %d" % data["vehicle"],
    )
    return viewer, result, notes


def _dump(doc):
    """Strict JSON: NaN and Infinity raise ValueError."""
    return json.dumps(doc, indent=1, allow_nan=False) + "\n"


def _check_result_slot(path):
    """Refuse to replace a result.json that is not a derived export.

    A run directory holds its own result.json (verdict and metrics). The
    exporter never replaces it. It replaces only a file that it wrote before
    (`"derived": true`).
    """
    if not (path.exists() or path.is_symlink()):
        return
    try:
        old = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        old = None
    if not (isinstance(old, dict) and old.get("derived") is True):
        raise TlogError(
            "%s already exists and is not a derived export; it may hold run evidence. "
            "Export into another directory, or use --viewer-only to write only viewer.json" % path
        )


def export(tlog_path, out_dir, run_id=None, t0="first-record", verdict=None, viewer_only=False,
           sysid=None, compid=None):
    """Write viewer.json and result.json into out_dir. Return a summary dict.

    An existing result.json that the exporter did not write is never replaced
    (TlogError). With `viewer_only` the exporter writes only viewer.json.
    """
    tlog_path, out_dir = Path(tlog_path), Path(out_dir)
    if viewer_only and verdict is not None:
        raise TlogError("--verdict needs result.json; it cannot be used with --viewer-only")
    try:
        buf = tlog_path.read_bytes()
    except OSError as exc:
        raise TlogError("cannot read tlog: %s" % exc.strerror) from exc
    data = parse_tlog(buf, sysid, compid)
    viewer, result, notes = build_replay(data, run_id or tlog_path.parent.name or "tlog-export", t0, verdict)
    try:
        texts = [("viewer.json", _dump(viewer))]
        if not viewer_only:
            _check_result_slot(out_dir / "result.json")
            texts.append(("result.json", _dump(result)))
    except ValueError as exc:  # non-finite number: never write invalid JSON
        raise TlogError("output has a value that JSON cannot hold: %s" % exc) from exc
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, text in texts:
        (out_dir / name).write_text(text, encoding="utf-8")
    return {
        "samples": len(viewer["series"]["t"]), "events": len(result["events"]),
        "tlog_records": result["tlog_records"], "duration_s": result["duration_us"] / 1e6,
        "modes": viewer["modes"], "verdict": result.get("verdict", "none"),
        "result_written": not viewer_only, **notes,
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
    parser.add_argument(
        "--verdict", type=str.upper, choices=sorted(VERDICTS),
        help="verdict for the viewer (the tlog has none; you supply it). Default: no verdict",
    )
    parser.add_argument(
        "--viewer-only", action="store_true",
        help="write only viewer.json; keep an existing result.json (run evidence) untouched",
    )
    parser.add_argument("--sysid", type=int, help="vehicle system id (default: first vehicle HEARTBEAT)")
    parser.add_argument("--compid", type=int, help="vehicle component id (needs --sysid)")
    args = parser.parse_args(argv)
    try:
        summary = export(args.tlog, args.out_dir, args.run_id, args.t0, args.verdict, args.viewer_only,
                         args.sysid, args.compid)
    except TlogError as exc:
        print("export_tlog: %s" % exc, file=sys.stderr)
        return 1
    for key, value in summary.items():
        print("%s: %s" % (key, value))
    for key, text in (
        ("skipped_bytes", "bad or corrupt data was skipped"),
        ("large_gaps", "a gap of more than one day between records"),
        ("nonfinite_attitudes", "ATTITUDE records with NaN or Infinity became null"),
    ):
        if summary[key]:
            print("export_tlog: warning: %s (%s: %s)" % (text, key, summary[key]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
