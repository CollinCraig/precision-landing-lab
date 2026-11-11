mod json;
mod tlog;
use json::Value;
use std::{collections::BTreeMap, fs::File, io::Read, path::Path};
type R<T> = Result<T, String>;
type Object = BTreeMap<String, Value>;

fn object<'a>(v: &'a Value, keys: &[&str], at: &str) -> R<&'a Object> {
    let Value::Object(o) = v else { return Err(format!("{at}: expected object")); };
    for key in keys { if !o.contains_key(*key) { return Err(format!("{at}.{key}: missing")); } }
    for key in o.keys() { if !keys.contains(&key.as_str()) { return Err(format!("{at}.{key}: unknown field")); } }
    Ok(o)
}
fn string<'a>(v: &'a Value, at: &str) -> R<&'a str> {
    match v { Value::String(s) if !s.trim().is_empty() && s.len() <= 1024 => Ok(s),
        _ => Err(format!("{at}: expected nonempty string (max 1024 bytes)")) }
}
fn uint(v: &Value, at: &str) -> R<u64> {
    match v { Value::Number(s) => s.parse().map_err(|_| format!("{at}: expected unsigned 64-bit integer")),
        _ => Err(format!("{at}: expected unsigned integer")) }
}
fn boolean(v: &Value, at: &str) -> R<bool> {
    match v { Value::Bool(b) => Ok(*b), _ => Err(format!("{at}: expected boolean")) }
}
fn array<'a>(v: &'a Value, at: &str) -> R<&'a [Value]> {
    match v { Value::Array(a) => Ok(a), _ => Err(format!("{at}: expected array")) }
}
fn read_json(path: &Path) -> R<Value> {
    regular_file(path)?;
    let mut bytes = Vec::new();
    File::open(path).map_err(|e| format!("{}: {e}", path.display()))?
        .take(1_048_577).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > 1_048_576 { return Err(format!("{}: exceeds 1 MiB", path.display())); }
    json::parse(&bytes).map_err(|e| format!("{}: {e}", path.display()))
}
fn regular_file(path: &Path) -> R<()> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !metadata.file_type().is_file() { return Err(format!("{}: expected regular file, no symlinks", path.display())); }
    Ok(())
}
fn source(v: &Value, camera: bool, at: &str) -> R<()> {
    let s = string(v, at)?;
    if !["runner", "autopilot", "truth", "camera"].contains(&s) { return Err(format!("{at}: unknown source")); }
    if camera && s == "truth" { return Err(format!("{at}: truth input forbidden in camera mode")); }
    Ok(())
}

/// Validate evidence only. `Ok(false)` means valid evidence of a failed mission.
/// No flight control, acceptance thresholds, or demo certification happens here.
pub fn check(dir: &Path) -> R<bool> {
    let m = read_json(&dir.join("manifest.json"))?;
    let m = object(&m, &["schema_version", "run_id", "seed", "scenario", "mode", "versions", "git", "host", "started_unix_us", "input_sources"], "manifest")?;
    if uint(&m["schema_version"], "manifest.schema_version")? != 1 { return Err("manifest.schema_version: supported version is 1".into()); }
    let id = string(&m["run_id"], "manifest.run_id")?;
    if id.len() > 128 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c)) { return Err("manifest.run_id: use 1..128 ASCII letters/digits/_/-".into()); }
    uint(&m["seed"], "manifest.seed")?;
    let scenario = object(&m["scenario"], &["name"], "manifest.scenario")?;
    string(&scenario["name"], "manifest.scenario.name")?;
    let mode = string(&m["mode"], "manifest.mode")?;
    if !["truth", "camera", "offline"].contains(&mode) { return Err("manifest.mode: expected truth/camera/offline".into()); }
    let camera = mode == "camera";
    let sources = array(&m["input_sources"], "manifest.input_sources")?;
    if sources.is_empty() { return Err("manifest.input_sources: must declare inputs".into()); }
    for s in sources { source(s, camera, "manifest.input_sources")?; }
    if camera && !sources.iter().any(|s| matches!(s, Value::String(s) if s == "camera")) { return Err("manifest.input_sources: camera mode requires camera input".into()); }
    let versions = object(&m["versions"], &["ardupilot", "container"], "manifest.versions")?;
    string(&versions["ardupilot"], "manifest.versions.ardupilot")?;
    let image = string(&versions["container"], "manifest.versions.container")?;
    let digest = image.rsplit_once("@sha256:").map(|(_, d)| d);
    if !digest.is_some_and(|d| d.len() == 64 && d.bytes().all(|c| c.is_ascii_hexdigit())) { return Err("manifest.versions.container: require image@sha256:<64 hex>".into()); }
    let git = object(&m["git"], &["commit", "dirty"], "manifest.git")?;
    let commit = string(&git["commit"], "manifest.git.commit")?;
    if ![40, 64].contains(&commit.len()) || !commit.bytes().all(|c| c.is_ascii_hexdigit()) { return Err("manifest.git.commit: require full 40/64 hex hash".into()); }
    boolean(&git["dirty"], "manifest.git.dirty")?;
    string(&m["host"], "manifest.host")?;
    let start = uint(&m["started_unix_us"], "manifest.started_unix_us")?;
    if start == 0 { return Err("manifest.started_unix_us: must be positive".into()); }

    let r = read_json(&dir.join("result.json"))?;
    let r = object(&r, &["schema_version", "run_id", "seed", "scenario", "mode", "success", "failure_reason", "duration_us", "tlog_records", "events"], "result")?;
    if uint(&r["schema_version"], "result.schema_version")? != 1 { return Err("result.schema_version: supported version is 1".into()); }
    if string(&r["run_id"], "result.run_id")? != id || uint(&r["seed"], "result.seed")? != uint(&m["seed"], "manifest.seed")?
        || string(&r["mode"], "result.mode")? != mode { return Err("result: run_id/seed/mode differs from manifest".into()); }
    let rs = object(&r["scenario"], &["name"], "result.scenario")?;
    if string(&rs["name"], "result.scenario.name")? != string(&scenario["name"], "manifest.scenario.name")? { return Err("result.scenario: differs from manifest".into()); }
    let success = boolean(&r["success"], "result.success")?;
    let reason = if success {
        if !matches!(r["failure_reason"], Value::Null) { return Err("result.failure_reason: success requires null".into()); }
        None
    } else {
        let f = object(&r["failure_reason"], &["code", "detail"], "result.failure_reason")?;
        let code = string(&f["code"], "result.failure_reason.code")?;
        if !["timeout", "connection_failed", "readiness_failed", "command_rejected", "mission_exception", "ac_unavailable", "ac_lost", "interrupted", "runner_error"].contains(&code) { return Err("result.failure_reason.code: unknown M1 failure code".into()); }
        string(&f["detail"], "result.failure_reason.detail")?;
        Some(code)
    };
    let duration = uint(&r["duration_us"], "result.duration_us")?;
    let end = start.checked_add(duration).ok_or("result.duration_us: timestamp overflow")?;
    let events = array(&r["events"], "result.events")?;
    if events.len() < 2 { return Err("result.events: require run_started and terminal event".into()); }
    let mut previous = 0;
    for (i, e) in events.iter().enumerate() {
        let at = format!("result.events[{i}]");
        let e = object(e, &["t_us", "kind", "source"], &at)?;
        let t = uint(&e["t_us"], &format!("{at}.t_us"))?;
        if t < previous || t > duration { return Err(format!("{at}.t_us: out of order or outside run")); }
        previous = t;
        source(&e["source"], camera, &format!("{at}.source"))?;
        let src = string(&e["source"], &at)?;
        if !sources.iter().any(|s| matches!(s, Value::String(s) if s == src)) { return Err(format!("{at}.source: not declared in manifest.input_sources")); }
        let kind = string(&e["kind"], &format!("{at}.kind"))?;
        if i == 0 {
            if kind != "run_started" || t != 0 || src != "runner" { return Err("result.events[0]: require runner run_started at t_us=0".into()); }
        } else if i == events.len() - 1 {
            if kind != (if success { "run_succeeded" } else { "run_failed" }) || t != duration || src != "runner" { return Err("result.events: terminal event differs from success/duration".into()); }
        } else if ["run_started", "run_succeeded", "run_failed"].contains(&kind) { return Err(format!("{at}: misplaced lifecycle event")); }
    }
    let count = uint(&r["tlog_records"], "result.tlog_records")?;
    regular_file(&dir.join("flight.tlog"))?;
    let stats = tlog::validate(&dir.join("flight.tlog"), start, end)?;
    if stats.records != count { return Err("flight.tlog: record count differs from result.tlog_records".into()); }
    if count > 0 && !sources.iter().any(|s| matches!(s, Value::String(s) if s == "autopilot")) { return Err("flight.tlog: autopilot input not declared in manifest".into()); }
    if success && (!stats.heartbeat || !stats.position) { return Err("flight.tlog: success requires HEARTBEAT and GLOBAL_POSITION_INT".into()); }
    if count == 0 && events.iter().any(|e| matches!(e, Value::Object(o) if matches!(&o["source"], Value::String(s) if s == "autopilot"))) { return Err("result.events: autopilot event without telemetry evidence".into()); }
    if count == 0 && !matches!(reason, Some("connection_failed" | "ac_unavailable" | "runner_error" | "interrupted")) { return Err("flight.tlog: empty evidence allowed only for pre-telemetry failure".into()); }
    Ok(success)
}
