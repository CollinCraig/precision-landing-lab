"""Tests for lab.export_tlog with a synthetic tlog built in memory (no host data)."""
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest

from lab.export_tlog import TlogError, crc16, export, main, parse_tlog

try:  # only in the container venv; CI and the host skip these tests
    from pymavlink.dialects.v10 import common as mavlink_v1
    from pymavlink.dialects.v20 import common as mavlink_v2
except ImportError:
    mavlink_v1 = mavlink_v2 = None

ROOT = Path(__file__).resolve().parent.parent
T0 = 1_800_000_000_000_000  # microseconds
CRC_EXTRA = {0: 50, 30: 39, 33: 104, 77: 143, 253: 83}


def frame_v2(msgid, payload, sysid=1, compid=1, seq=0, truncate=True):
    if truncate:
        payload = payload.rstrip(b"\0") or b"\0"
    body = bytes([len(payload), 0, 0, seq, sysid, compid]) + msgid.to_bytes(3, "little") + payload
    return b"\xfd" + body + struct.pack("<H", crc16(body, CRC_EXTRA[msgid]))


def frame_v1(msgid, payload, sysid=1, compid=1, seq=0):
    body = bytes([len(payload), seq, sysid, compid, msgid]) + payload
    return b"\xfe" + body + struct.pack("<H", crc16(body, CRC_EXTRA[msgid]))


def record(t_us, frame):
    return struct.pack(">Q", T0 + t_us) + frame


def heartbeat(custom_mode, armed, vtype=2, autopilot=3, sysid=1, compid=1):
    base = 0x80 if armed else 0
    return frame_v2(0, struct.pack("<IBBBBB", custom_mode, vtype, autopilot, base, 4, 3), sysid, compid)


def position(lat, lon, rel_mm, vz_cms, hdg_cdeg):
    return frame_v2(33, struct.pack("<IiiiihhhH", 0, lat, lon, 0, rel_mm, 0, 0, vz_cms, hdg_cdeg))


def attitude(roll, pitch, yaw):
    return frame_v2(30, struct.pack("<Iffffff", 0, roll, pitch, yaw, 0, 0, 0))


def statustext(severity, text):
    return frame_v2(253, struct.pack("<B50s", severity, text.encode()) + bytes(3))


def ack(command, result):
    return frame_v2(77, struct.pack("<HBBiBB", command, result, 0, 0, 255, 230))


LAT, LON = 365_000_000, -1_210_000_000  # 36.5 N, 121.0 W (1e-7 deg)
ONE_M_LAT = round(1e7 / 111_319.49)     # about 1 m north


def sample_tlog():
    """GCS heartbeat, vehicle boot, STABILIZE, GUIDED, arm, climb, LAND, disarm."""
    r = [
        record(0, heartbeat(0, 0, vtype=6, autopilot=8, sysid=255, compid=230)),  # GCS: ignored
        record(500_000, heartbeat(0, 0)),
        record(600_000, statustext(6, "Frame: QUAD/PLUS")),
        record(700_000, ack(410, 4)),
        record(900_000, attitude(0.0, 0.0, math.radians(90))),
        record(1_000_000, position(LAT, LON, 0, 0, 9000)),
        record(1_500_000, heartbeat(4, 0)),                         # GUIDED
        record(1_600_000, ack(176, 0)),
        record(1_700_000, heartbeat(4, 1)),                         # armed
        record(2_000_000, position(LAT + ONE_M_LAT, LON, 2500, -150, 65535)),  # 2.5 m up, climbing, hdg unknown
        record(2_100_000, attitude(math.radians(10), math.radians(-5), math.radians(-90))),
        record(3_000_000, position(LAT + 2 * ONE_M_LAT, LON, 5000, 0, 9000)),
        record(3_500_000, heartbeat(9, 1)),                         # LAND
        record(3_600_000, statustext(4, "SIM Hit ground")),
        record(4_000_000, position(LAT + 2 * ONE_M_LAT, LON, 50, 40, 9000)),
        record(4_500_000, heartbeat(9, 0)),                         # disarmed
    ]
    return b"".join(r)


class ExportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)
        self.tlog = self.dir / "flight.tlog"
        self.tlog.write_bytes(sample_tlog())

    def export(self, **kwargs):
        out = self.dir / "out"
        export(self.tlog, out, **kwargs)
        return (json.loads((out / "viewer.json").read_text()), json.loads((out / "result.json").read_text()))

    def test_series_match_the_viewer_schema(self):
        viewer, _ = self.export(run_id="synthetic")
        s = viewer["series"]
        self.assertEqual(viewer["schema_version"], 1)
        self.assertEqual(viewer["run_id"], "synthetic")
        self.assertEqual(viewer["source"]["kind"], "tlog")
        self.assertEqual(viewer["modes"], ["STABILIZE", "GUIDED", "LAND"])
        self.assertEqual(s["t"], [1.0, 2.0, 3.0, 4.0])
        self.assertEqual(len({len(v) for v in s.values()}), 1)
        self.assertEqual(s["alt"], [0.0, 2.5, 5.0, 0.05])
        self.assertEqual(s["d"], [0.0, -2.5, -5.0, -0.05])
        self.assertEqual(s["vz"], [0.0, -1.5, 0.0, 0.4])
        self.assertEqual(s["mode"], [0, 1, 1, 2])
        self.assertEqual(s["armed"], [0, 1, 1, 1])

    def test_position_is_ned_from_the_first_sample(self):
        viewer, _ = self.export()
        s = viewer["series"]
        self.assertEqual((s["n"][0], s["e"][0]), (0.0, 0.0))
        self.assertAlmostEqual(s["n"][1], 1.0, delta=0.01)
        self.assertAlmostEqual(s["n"][2], 2.0, delta=0.01)
        self.assertEqual(s["e"], [0.0] * 4)

    def test_east_offset_uses_latitude(self):
        extra = record(5_000_000, position(LAT, LON + 10_000, 0, 0, 0))
        self.tlog.write_bytes(sample_tlog() + extra)
        viewer, _ = self.export()
        expected = math.radians(0.001) * 6378137.0 * math.cos(math.radians(36.5))
        self.assertAlmostEqual(viewer["series"]["e"][-1], expected, delta=0.01)

    def test_heading_holds_when_unknown_and_attitude_is_in_degrees(self):
        viewer, _ = self.export()
        s = viewer["series"]
        self.assertEqual(s["hdg"], [90.0, 90.0, 90.0, 90.0])
        self.assertEqual(s["yaw"], [90.0, 90.0, 270.0, 270.0])
        self.assertEqual(s["roll"], [0.0, 0.0, 10.0, 10.0])
        self.assertEqual(s["pitch"], [0.0, 0.0, -5.0, -5.0])

    def test_events_have_replay_shape_and_order(self):
        _, result = self.export()
        kinds = [(e["t_us"], e["kind"]) for e in result["events"]]
        self.assertEqual(kinds, [
            (600_000, "statustext:info: Frame: QUAD/PLUS"),
            (700_000, "ack:get_home_position:failed"),
            (1_500_000, "mode:GUIDED"),
            (1_600_000, "ack:do_set_mode:accepted"),
            (1_700_000, "armed"),
            (3_500_000, "mode:LAND"),
            (3_600_000, "statustext:warning: SIM Hit ground"),
            (4_500_000, "disarmed"),
        ])
        self.assertEqual(result["duration_us"], 4_500_000)
        self.assertTrue(result["derived"])
        self.assertNotIn("success", result)
        times = [e["t_us"] for e in result["events"]]
        self.assertEqual(times, sorted(times))

    def test_gcs_heartbeat_is_not_the_vehicle(self):
        viewer, result = self.export()
        self.assertEqual(viewer["modes"][viewer["series"]["mode"][0]], "STABILIZE")
        self.assertNotIn("mode:STABILIZE", [e["kind"] for e in result["events"]])

    def test_first_position_time_zero_drops_earlier_events(self):
        viewer, result = self.export(t0="first-position")
        self.assertEqual(viewer["series"]["t"][0], 0.0)
        self.assertEqual(result["events"][0]["kind"], "mode:GUIDED")
        self.assertTrue(all(e["t_us"] >= 0 for e in result["events"]))
        self.assertEqual(result["events"][0]["t_us"], 500_000)
        self.assertEqual(result["duration_us"], 3_500_000)

    def test_v1_frames_and_truncated_v2_payloads(self):
        payload = struct.pack("<IiiiihhhH", 0, LAT, LON, 0, 3000, 0, 0, 0, 100)
        data = b"".join([
            record(0, frame_v1(0, struct.pack("<IBBBBB", 0, 2, 3, 0x80, 4, 3))),
            record(100, frame_v1(33, payload)),
            record(200, frame_v2(33, payload, truncate=True)),
        ])
        parsed = parse_tlog(data)
        self.assertEqual([p[3] for p in parsed["positions"]], [3000, 3000])
        self.assertEqual(parsed["heartbeats"][0][3], 1)  # armed

    def test_bad_crc_and_garbage_are_skipped_and_counted(self):
        good = sample_tlog()
        bad = bytearray(record(5_000_000, position(LAT, LON, 9999, 0, 0)))
        bad[-1] ^= 0xFF
        data = good + b"\x00garbage\x01" + bytes(bad) + record(6_000_000, position(LAT, LON, 1000, 0, 0))
        parsed = parse_tlog(data)
        self.assertEqual([p[3] for p in parsed["positions"]], [0, 2500, 5000, 50, 1000])
        self.assertGreater(parsed["stats"]["skipped_bytes"], 0)

    def test_truncated_last_record_is_ignored(self):
        parsed = parse_tlog(sample_tlog() + record(9_000_000, position(LAT, LON, 1, 0, 0))[:-5])
        self.assertEqual(len(parsed["positions"]), 4)

    def test_empty_or_non_tlog_input_fails_clearly(self):
        for data in (b"", b"not a tlog at all, just text bytes"):
            with self.assertRaises(TlogError):
                parse_tlog(data)

    def test_no_vehicle_heartbeat_fails(self):
        with self.assertRaises(TlogError):
            parse_tlog(record(0, heartbeat(0, 0, vtype=6, autopilot=8, sysid=255)))

    def test_tlog_without_positions_gives_an_empty_valid_series(self):
        self.tlog.write_bytes(record(0, heartbeat(0, 0)))
        viewer, result = self.export()
        self.assertEqual(viewer["series"]["t"], [])
        self.assertEqual(viewer["modes"], ["UNKNOWN"])
        self.assertEqual(result["events"], [])

    def test_cli_returns_1_for_missing_file(self):
        self.assertEqual(main([str(self.dir / "missing.tlog"), str(self.dir / "o")]), 1)

    def test_output_is_deterministic(self):
        export(self.tlog, self.dir / "a")
        export(self.tlog, self.dir / "b")
        for name in ("viewer.json", "result.json"):
            self.assertEqual((self.dir / "a" / name).read_bytes(), (self.dir / "b" / name).read_bytes())

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_viewer_parser_accepts_the_output(self):
        export(self.tlog, self.dir / "replay")
        script = (
            "const P=require(process.argv[1]+'/viewer/app.js');const fs=require('fs');"
            "const raw=JSON.parse(fs.readFileSync(process.argv[2]+'/viewer.json'));"
            "const st=P.parseViewer(raw);console.log(st.length, st.modes.join(','));"
        )
        done = subprocess.run(
            ["node", "-e", script, str(ROOT), str(self.dir / "replay")],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout.strip(), "4 STABILIZE,GUIDED,LAND")


@unittest.skipIf(mavlink_v1 is None, "pymavlink is not installed (run in the container venv)")
class PymavlinkCrossCheck(unittest.TestCase):
    """Frames built by pymavlink must decode to the same values (v1 and v2)."""

    def build(self, version):
        mav = (mavlink_v1 if version == 1 else mavlink_v2).MAVLink(None, srcSystem=1, srcComponent=1)
        msgs = [
            mav.heartbeat_encode(2, 3, 0x80, 4, 4, 3),
            mav.global_position_int_encode(1000, LAT, LON, 584000, 7123, 10, -20, -137, 4567),
            mav.attitude_encode(1000, 0.1, -0.2, 3.0, 0, 0, 0),
            mav.command_ack_encode(400, 0),
            mav.statustext_encode(6, b"Arming motors"),
        ]
        out = b""
        for i, msg in enumerate(msgs):
            out += struct.pack(">Q", T0 + i * 1000) + msg.pack(mav)
        return out

    def check(self, version):
        parsed = parse_tlog(self.build(version))
        self.assertEqual(parsed["positions"][0][1:], (LAT, LON, 7123, -137, 4567))
        self.assertEqual(parsed["heartbeats"][0][1:], (2, 4, 1))
        self.assertEqual(parsed["acks"][0][1:], (400, 0))
        self.assertEqual(parsed["texts"][0][1:], (6, "Arming motors"))
        att = parsed["attitudes"][0]
        self.assertTrue(all(abs(a - b) < 1e-6 for a, b in zip(att[1:], (0.1, -0.2, 3.0))))

    def test_v1(self):
        self.check(1)

    def test_v2(self):
        self.check(2)


if __name__ == "__main__":
    unittest.main()
