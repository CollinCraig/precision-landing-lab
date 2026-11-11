use std::{fs, path::PathBuf, process::Command, sync::atomic::{AtomicU64, Ordering}};
static NEXT: AtomicU64 = AtomicU64::new(0);
const START: u64 = 1_800_000_000_000_000;
const MANIFEST: &str = r#"{
  "schema_version":1,"run_id":"synthetic-1","seed":42,
  "scenario":{"name":"m1-first-flight"},"mode":"truth",
  "versions":{"ardupilot":"Copter-4.7.2","container":"ubuntu@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
  "git":{"commit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","dirty":false},
  "host":"synthetic-host","started_unix_us":1800000000000000,
  "input_sources":["runner","autopilot","truth"]
}"#;
const RESULT: &str = r#"{
  "schema_version":1,"run_id":"synthetic-1","seed":42,
  "scenario":{"name":"m1-first-flight"},"mode":"truth",
  "success":true,"failure_reason":null,"duration_us":2000000,"tlog_records":2,
  "events":[{"t_us":0,"kind":"run_started","source":"runner"},
    {"t_us":1000000,"kind":"sample_received","source":"autopilot"},
    {"t_us":2000000,"kind":"run_succeeded","source":"runner"}]
}"#;
struct Run(PathBuf);
impl Run {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("plv-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&dir).unwrap();
        let run = Self(dir);
        run.write("manifest.json", MANIFEST);
        run.write("result.json", RESULT);
        let mut bytes = record(START, 0, false, 0);
        bytes.extend(record(START + 1_000_000, 33, false, 1000));
        fs::write(run.0.join("flight.tlog"), bytes).unwrap();
        run
    }
    fn write(&self, name: &str, text: &str) { fs::write(self.0.join(name), text).unwrap(); }
    fn replace(&self, name: &str, from: &str, to: &str) {
        let old = fs::read_to_string(self.0.join(name)).unwrap();
        assert!(old.contains(from), "fixture mutation missing: {from}");
        self.write(name, &old.replace(from, to));
    }
    fn check(&self) -> Result<bool, String> { plv::check(&self.0) }
    fn invalid(&self, expected: &str) { let e = self.check().unwrap_err(); assert!(e.contains(expected), "{e:?} should contain {expected:?}"); }
    fn failure(&self, code: &str) {
        self.replace("result.json", "\"success\":true", "\"success\":false");
        self.replace("result.json", "\"failure_reason\":null", &format!("\"failure_reason\":{{\"code\":\"{code}\",\"detail\":\"synthetic failure\"}}"));
        self.replace("result.json", "run_succeeded", "run_failed");
    }
}
impl Drop for Run { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
// Independent bitwise reference CRC, unlike the optimized validator implementation.
fn checksum(bytes: &[u8], extra: u8) -> u16 {
    let mut crc = 0xffff;
    for b in bytes.iter().copied().chain(std::iter::once(extra)) {
        crc ^= b as u16;
        for _ in 0..8 { crc = if crc & 1 != 0 { (crc >> 1) ^ 0x8408 } else { crc >> 1 }; }
    }
    crc
}
fn record(t: u64, id: u8, v2: bool, boot: u32) -> Vec<u8> {
    let mut payload = vec![0u8; if id == 0 { 9 } else { 28 }];
    if id == 0 { payload[4] = 2; payload[5] = 3; payload[8] = 3; } else { payload[..4].copy_from_slice(&boot.to_le_bytes()); }
    // MAVLink 2 legally elides zero payload suffixes.
    if v2 { while payload.len() > 1 && payload.last() == Some(&0) { payload.pop(); } }
    let mut data = if v2 { vec![payload.len() as u8, 0, 0, 0, 1, 1, id, 0, 0] }
        else { vec![payload.len() as u8, 0, 1, 1, id] };
    data.extend(payload);
    let crc = checksum(&data, if id == 0 { 50 } else { 104 });
    let mut out = t.to_be_bytes().to_vec();
    out.push(if v2 { 0xfd } else { 0xfe });
    out.extend(data);
    out.extend(crc.to_le_bytes());
    out
}

#[test]
fn valid_success_and_cli() {
    let run = Run::new();
    assert_eq!(run.check().unwrap(), true);
    let output = Command::new(env!("CARGO_BIN_EXE_plv")).args(["check"]).arg(&run.0).output().unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("demo acceptance requires separate review"));
}
#[test]
fn valid_failures_are_not_passes() {
    for code in ["timeout", "connection_failed", "readiness_failed", "command_rejected", "mission_exception", "ac_unavailable", "ac_lost", "interrupted", "runner_error"] {
        let run = Run::new(); run.failure(code);
        assert_eq!(run.check().unwrap(), false);
        let output = Command::new(env!("CARGO_BIN_EXE_plv")).arg("check").arg(&run.0).output().unwrap();
        assert_eq!(output.status.code(), Some(1));
        assert!(String::from_utf8_lossy(&output.stderr).contains("VALID FAILURE"));
    }
}
#[test]
fn early_failure_empty_log_is_explicit() {
    let run = Run::new(); run.failure("connection_failed");
    run.replace("result.json", "\"tlog_records\":2", "\"tlog_records\":0");
    fs::write(run.0.join("flight.tlog"), []).unwrap();
    run.invalid("autopilot event without telemetry");
    run.replace("result.json", "\"source\":\"autopilot\"", "\"source\":\"runner\"");
    assert_eq!(run.check().unwrap(), false);
    run.replace("result.json", "connection_failed", "timeout");
    run.invalid("empty evidence");
}
#[test]
fn schema_and_consistency_rejections() {
    for (name, from, to, expected) in [
        ("manifest.json", "\"schema_version\":1", "\"schema_version\":2", "supported version"),
        ("result.json", "\"seed\":42", "\"seed\":43", "differs from manifest"),
        ("result.json", "synthetic-1", "other", "differs from manifest"),
        ("result.json", "m1-first-flight", "smoke", "differs from manifest"),
        ("result.json", "\"mode\":\"truth\"", "\"mode\":\"offline\"", "differs from manifest"),
        ("manifest.json", "\"dirty\":false", "\"dirty\":0", "expected boolean"),
        ("manifest.json", "\"seed\":42", "\"seed\":1e999", "finite"),
        ("manifest.json", "\"seed\":42", "\"seed\":NaN", "expected JSON value"),
        ("manifest.json", "\"seed\":42", "\"seed\":-1", "unsigned"),
        ("manifest.json", "\"seed\":42", "\"seed\":1.5", "integer"),
        ("manifest.json", "\"seed\":42", "\"seed\":18446744073709551616", "integer"),
        ("manifest.json", "\"seed\":42", "\"seed\":42,\"seed\":42", "duplicate key"),
        ("manifest.json", "\"seed\":42,", "", "seed: missing"),
        ("manifest.json", "\"seed\":42", "\"seed\":42,\"gazebo\":null", "unknown field"),
        ("manifest.json", "\"host\":\"synthetic-host\"", "\"host\":\" \"", "nonempty"),
        ("manifest.json", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "short", "full 40/64"),
        ("manifest.json", "ubuntu@sha256:", "ubuntu:", "require image@"),
        ("manifest.json", "\"mode\":\"truth\"", "\"mode\":\"bad\"", "expected truth/camera/offline"),
        ("result.json", "\"failure_reason\":null", "\"failure_reason\":{}", "success requires null"),
        ("result.json", "\"success\":true", "\"success\":false", "expected object"),
        ("result.json", "run_succeeded", "run_failed", "terminal event"),
        ("result.json", "\"t_us\":2000000", "\"t_us\":500000", "out of order"),
        ("result.json", "\"t_us\":1000000", "\"t_us\":3000000", "outside run"),
        ("result.json", "\"t_us\":0", "\"t_us\":1", "run_started"),
        ("result.json", "sample_received", "run_failed", "misplaced lifecycle"),
        ("result.json", "\"source\":\"autopilot\"", "\"source\":\"camera\"", "not declared"),
        ("result.json", "\"tlog_records\":2", "\"tlog_records\":3", "record count"),
        ("result.json", "\"duration_us\":2000000", "\"duration_us\":18446744073709551615", "overflow"),
    ] {
        let run = Run::new(); run.replace(name, from, to); run.invalid(expected);
    }
}
#[test]
fn malformed_missing_truncated_files() {
    for name in ["manifest.json", "result.json", "flight.tlog"] {
        let run = Run::new(); fs::remove_file(run.0.join(name)).unwrap(); run.invalid(name);
    }
    for bad in ["{", "{} trailing", "{\"a\":01}", "{\"a\":\"\\uD800\"}", "{\"a\":\"\\x\"}", "{\"a\":true,}"] {
        let run = Run::new(); run.write("manifest.json", bad); assert!(run.check().is_err());
    }
    let run = Run::new(); fs::write(run.0.join("manifest.json"), [0xff]).unwrap(); run.invalid("UTF-8");
    run.write("manifest.json", &" ".repeat(1_048_577)); run.invalid("exceeds 1 MiB");
    let run = Run::new(); let data = fs::read(run.0.join("flight.tlog")).unwrap();
    for len in 0..data.len() {
        fs::write(run.0.join("flight.tlog"), &data[..len]).unwrap();
        assert!(run.check().is_err(), "accepted truncation at {len}");
    }
}
#[test]
fn camera_truth_rejected_and_clean_camera_allowed() {
    let run = Run::new();
    for name in ["manifest.json", "result.json"] { run.replace(name, "\"mode\":\"truth\"", "\"mode\":\"camera\""); }
    run.invalid("truth input forbidden");
    run.replace("manifest.json", ",\"truth\"", "");
    run.invalid("camera mode requires camera input");
    run.replace("manifest.json", "\"autopilot\"]", "\"autopilot\",\"camera\"]");
    assert!(run.check().unwrap());
    run.replace("result.json", "\"source\":\"autopilot\"", "\"source\":\"truth\"");
    run.invalid("truth input forbidden");
}
#[test]
fn telemetry_crc_order_bounds_boot_and_v2() {
    let run = Run::new();
    for (t, boot, expected) in [(START - 1, 1000, "timestamp"), (START + 3_000_000, 1000, "timestamp")] {
        let mut data = record(START, 0, false, 0); data.extend(record(t, 33, false, boot));
        fs::write(run.0.join("flight.tlog"), data).unwrap(); run.invalid(expected);
    }
    let mut data = record(START, 0, false, 0); data.extend(record(START, 33, false, 2000)); data.extend(record(START, 33, false, 1000));
    fs::write(run.0.join("flight.tlog"), data).unwrap(); run.invalid("time_boot_ms decreased");
    let mut data = record(START, 0, true, 0); data.extend(record(START + 1, 33, true, 1));
    fs::write(run.0.join("flight.tlog"), &data).unwrap(); assert!(run.check().unwrap());
    let last = data.len() - 1; data[last] ^= 1;
    fs::write(run.0.join("flight.tlog"), data).unwrap(); run.invalid("checksum mismatch");
    let mut data = record(START, 0, false, 0); data.extend(record(START, 0, false, 0));
    fs::write(run.0.join("flight.tlog"), data).unwrap(); run.invalid("requires HEARTBEAT and GLOBAL_POSITION_INT");
}
#[test]
fn rejects_unsupported_frames_and_vehicle_mixing() {
    for (offset, value, expected) in [
        (8, 0, "magic"),
        (9, 0, "payload length"),
        (13, 1, "message 1 unsupported"),
        (11, 0, "system/component"),
    ] {
        let run = Run::new();
        let mut data = fs::read(run.0.join("flight.tlog")).unwrap();
        data[offset] = value;
        fs::write(run.0.join("flight.tlog"), data).unwrap(); run.invalid(expected);
    }
    let run = Run::new();
    let mut data = record(START, 0, true, 0); data[10] = 1;
    fs::write(run.0.join("flight.tlog"), data).unwrap(); run.invalid("incompatibility flags");
    let mut first = record(START, 0, false, 0);
    let mut second = record(START, 33, false, 1); second[11] = 2;
    first.extend(second);
    fs::write(run.0.join("flight.tlog"), first).unwrap(); run.invalid("system/component");
}
#[test]
fn failure_code_and_empty_success_rejected() {
    let run = Run::new(); run.failure("unrecognized"); run.invalid("unknown M1 failure code");
    let run = Run::new();
    run.replace("result.json", "\"tlog_records\":2", "\"tlog_records\":0");
    fs::write(run.0.join("flight.tlog"), []).unwrap(); run.invalid("success requires");
}
#[cfg(unix)]
#[test]
fn rejects_symlinks_and_directories() {
    use std::os::unix::fs::symlink;
    let run = Run::new();
    fs::rename(run.0.join("flight.tlog"), run.0.join("saved")).unwrap();
    symlink(run.0.join("saved"), run.0.join("flight.tlog")).unwrap(); run.invalid("regular file");
    fs::remove_file(run.0.join("flight.tlog")).unwrap();
    fs::create_dir(run.0.join("flight.tlog")).unwrap(); run.invalid("regular file");
}
#[test]
fn cli_usage_and_invalid_evidence() {
    let output = Command::new(env!("CARGO_BIN_EXE_plv")).output().unwrap(); assert_eq!(output.status.code(), Some(2));
    let run = Run::new(); run.write("result.json", "{");
    let output = Command::new(env!("CARGO_BIN_EXE_plv")).arg("check").arg(&run.0).output().unwrap();
    assert_eq!(output.status.code(), Some(3)); assert!(String::from_utf8_lossy(&output.stderr).contains("INVALID:"));
}

#[test]
fn invalid_evidence_has_distinct_exit() {
    let run = Run::new(); run.write("manifest.json", "{}");
    let output = Command::new(env!("CARGO_BIN_EXE_plv")).arg("check").arg(&run.0).output().unwrap();
    assert_eq!(output.status.code(), Some(3));
}
#[test]
fn gcs_heartbeat_is_rejected() {
    let run = Run::new();
    let mut data = record(START, 0, false, 0);
    data[9 + 5 + 4] = 6; // HEARTBEAT MAV_TYPE_GCS, recompute CRC.
    let crc = checksum(&data[9..data.len()-2], 50);
    let n = data.len(); data[n-2..].copy_from_slice(&crc.to_le_bytes());
    data.extend(record(START + 1, 33, false, 1));
    fs::write(run.0.join("flight.tlog"), data).unwrap();
    run.invalid("expected ArduPilot quadrotor HEARTBEAT");
}
