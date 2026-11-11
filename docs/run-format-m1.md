# M1 run format, schema version 1

This is the producer/consumer contract for the future Python runner and Rust
`plv` validator. It covers M1 evidence only: no Gazebo, camera scoring, landing
accuracy metrics, detector statistics, or mission implementation is required.
All examples are synthetic and demonstrate encoding, not flight control.

## CLI and acceptance

With an existing Rust toolchain (Rust 1.75 or newer), from the repository root:

```sh
cargo build --locked --manifest-path validator/Cargo.toml
cargo test --locked --manifest-path validator/Cargo.toml
validator/target/debug/plv check runs/EXAMPLE
```

The crate has no external dependencies; Cargo.lock is included. No SITL is
needed for its synthetic integration tests.

| Exit | Prefix | Meaning |
| --- | --- | --- |
| 0 | `VALID: mission reported success` | Structurally valid evidence with `success: true`. |
| 1 | `VALID FAILURE:` | Structurally valid evidence with `success: false`; **never a demo pass**. |
| 3 | `INVALID:` | Missing, malformed, unsupported, truncated, or inconsistent evidence. |
| 2 | `usage:` | Incorrect CLI arguments; exactly `plv check RUN_DIR` is supported. |

Success goes to stdout; failures and usage go to stderr. Validation stops at
the first problem. Invalid-evidence messages are one line, limited to 240
characters after the prefix. Callers must check the exit status; a successfully
parsed failed mission still exits 1. The library distinguishes `Ok(true)`,
`Ok(false)`, and `Err(message)` for integrations needing that distinction.

**Structural validity is not mission acceptance.** `plv` checks the runner's
reported outcome and evidence consistency. It does not decide whether the
learner connected correctly, held altitude, landed, or met the demo gates.
An AUTO plumbing smoke run can have valid successful evidence without being
a learner mission demo pass. Scenario names must distinguish those runs.
The coordinator's independent acceptance review, mission tests, and demo
requirements remain necessary. Checksums detect corruption, not fabrication.

## Directory and JSON rules

Three regular data files (no symlinks) are required: `manifest.json`, `result.json`, and
`flight.tlog`. Other files may exist but are outside this M1 contract and are
not inspected. The directory basename need not equal run_id, allowing copied
or archived runs. Identity comes from matching manifest/result metadata.

Both JSON documents are UTF-8 objects, at most 1 MiB each. Every listed field
is required; unknown fields and duplicate keys are rejected, including nested
objects. Schema versions must both be integer `1`. Numbers must be finite.
Integer fields use JSON integer syntax, not fractions or exponent notation,
and fit unsigned 64-bit integers. Negative values are rejected. All strings
used by the schema must contain non-whitespace text and be at most 1024 UTF-8
bytes. JSON nesting is limited to 32 levels. Malformed Unicode, NaN, Infinity,
trailing content, and incomplete JSON are rejected. Publish complete files
atomically after closing the tlog; an unfinished run is invalid.

### manifest.json

```json
{
  "schema_version": 1,
  "run_id": "EXAMPLE",
  "seed": 42,
  "scenario": {"name": "m1-first-flight"},
  "mode": "truth",
  "versions": {
    "ardupilot": "Copter-4.7.2",
    "container": "ubuntu@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "git": {
    "commit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "dirty": false
  },
  "host": "lab-host",
  "started_unix_us": 1800000000000000,
  "input_sources": ["runner", "autopilot", "truth"]
}
```

- `run_id`: 1–128 ASCII letters, digits, underscores, or hyphens.
- `seed`: explicit reproducibility seed; `0` is valid.
- `scenario`: fixed M1 scenario name, e.g. `m1-first-flight` or
  `m1-auto-smoke`. Version 1 has no free-form scenario parameter bag; introducing
  parameters requires a schema revision so the validator can check them.
- `mode`: exactly `truth`, `camera`, or `offline`. The latter two are reserved
  provenance labels accepted structurally; this does not approve later milestones.
- `versions`: actual ArduPilot version/build identifier and container image
  pinned as `image@sha256:<64 hex digits>`. Examples contain placeholder hashes;
  the producer must supply real provenance. No Gazebo field exists in M1.
- `git`: full 40- or 64-hex repository commit and actual boolean dirty flag.
- `host`: runner's hostname/host identifier, not credentials.
- `started_unix_us`: positive Unix epoch microseconds, anchor for replay.
- `input_sources`: nonempty array of `runner`, `autopilot`, `truth`, `camera`.
  Declare **all** inputs, not just emitted events. `runner` is needed for
  lifecycle events, and `autopilot` for any tlog records. Every event source
  must appear here. `camera` mode rejects any declared `truth` input or any
  event with source `truth`. Autopilot vehicle state for altitude plotting
  is permitted; simulator target estimates must be declared as `truth`.

This is a provenance contract, not a sandbox: the validator cannot prove that
a producer concealed no input or that uninspected files were never read.
Future estimate/frame evidence needs a new schema and validator support,
not extra unvalidated JSON fields in this schema.

### result.json

```json
{
  "schema_version": 1,
  "run_id": "EXAMPLE",
  "seed": 42,
  "scenario": {"name": "m1-first-flight"},
  "mode": "truth",
  "success": true,
  "failure_reason": null,
  "duration_us": 2000000,
  "tlog_records": 2,
  "events": [
    {"t_us": 0, "kind": "run_started", "source": "runner"},
    {"t_us": 1000000, "kind": "sample_received", "source": "autopilot"},
    {"t_us": 2000000, "kind": "run_succeeded", "source": "runner"}
  ]
}
```

`run_id`, `seed`, `scenario.name`, and `mode` must match the manifest exactly.
`success` is boolean. On success, `failure_reason` must be null. On failure:

```json
{"code": "timeout", "detail": "Timed out waiting for the expected state"}
```

Valid codes are `timeout`, `connection_failed`, `readiness_failed`,
`command_rejected`, `mission_exception`, `ac_unavailable`, `ac_lost`,
`interrupted`, `runner_error`. Detail must be nonempty; use it for the specific
operation/exception. An unknown code is invalid evidence. A failed result
must end with `run_failed`, never `run_succeeded`, and exits 1 even if failure
was an intentional safety refusal or correct abort.

`duration_us` is elapsed monotonic microseconds at completion, nonnegative;
adding it to the start anchor must not overflow u64. `tlog_records` is the
exact number of complete stored records. `events` requires at least two
objects, each with exactly `t_us`, `kind`, `source`. Times are relative
microseconds, nondecreasing (ties allowed), in `[0, duration_us]`.
The first event is runner `run_started` at 0; the final event is runner
`run_succeeded` or `run_failed`, matching success, at duration_us. Those three
lifecycle kinds cannot occur in the middle. Other kinds are nonempty text
for console replay, without prescribing mission states or implementing them.

## flight.tlog: filtered binary MAVLink evidence

This is a **binary, pymavlink-compatible timestamped tlog**, not JSONL.
The M1 writer must filter the incoming stream to `HEARTBEAT` (message 0) and
`GLOBAL_POSITION_INT` (33), preserving complete serialized packets and their
wire CRC. This intentional small subset keeps validation dependency-free
and supplies heartbeat plus relative altitude for the future plot. A raw
unfiltered SITL tlog may be saved separately; it is not `flight.tlog` for
schema 1. Producers should filter messages before writing, not rewrite their
payloads. A future broader dialect requires validator/schema review.

Each record is:

```text
8 bytes big-endian unsigned Unix microseconds
1 full MAVLink 1 (0xfe) or MAVLink 2 (0xfd) packet
```

There is no file header/footer or padding. MAVLink 1 uses a 5-byte header
after magic, exact payload lengths 9/28, then a 2-byte little-endian X.25 CRC.
MAVLink 2 uses a 9-byte header after magic, payload length 1..9/1..28
(legal zero-tail truncation is reconstructed for decoding), and the same CRC.
CRC includes header after magic and payload followed by dialect CRC_EXTRA
50/104 for messages 0/33. Signed packets and any nonzero incompatibility
flags are unsupported and rejected. All records must use default SITL vehicle system/component IDs 1/1. Packet sequence numbers may have gaps because of
filtering. Unknown message IDs, invalid lengths, bad magic/CRC, partial
timestamps/headers/payloads/CRCs, and trailing garbage are rejected.

All record timestamps must be nondecreasing and within
`[started_unix_us, started_unix_us + duration_us]`. Derive them from the same
monotonic clock as events, anchored once to Unix time; do not continually
resample a wall clock that can step backwards. `GLOBAL_POSITION_INT`'s
`time_boot_ms` must also be nondecreasing; reboot/wrap during a single M1 run
is rejected. Plot time is `(record_timestamp - started_unix_us) / 1e6` seconds;
relative altitude is the signed little-endian `relative_alt` field at payload
bytes 16..20 divided by 1000 metres. These two message types have integer
payload fields, so no binary NaN/Infinity can enter plot data.

A reported success requires at least one HEARTBEAT and one GLOBAL_POSITION_INT.
An empty file is allowed only with `tlog_records: 0`, `success: false`, and
code `connection_failed`, `ac_unavailable`, `runner_error`, or `interrupted`
for failure before telemetry. Missing flight.tlog is always invalid. Other
failures require at least one valid record. The exact record count catches
truncation at a packet boundary; framing/CRC catches partial packets. This
does not prove the tlog covers every moment of flight or independently
establish mission completion.

## Synthetic verification

`validator/tests/synthetic.rs` creates isolated temporary run directories and
binary MAVLink records without SITL. Its independent bitwise CRC generator
exercises the validator's optimized CRC reader. Tests cover successful and
all supported failed outcomes, CLI statuses, explicit empty preflight failure,
manifest/result mismatches, missing/unknown/duplicate fields, invalid types,
nonfinite/out-of-range numbers, bad Unicode/JSON, size limits, camera truth
rejection, event ordering/bounds/lifecycle, every byte truncation of a valid
tlog, record count mismatch, corrupted CRC, timestamp bounds, boot rollback,
MAVLink 1/2, and missing success telemetry. Tests verify evidence plumbing;
they contain no mission implementation or acceptance solution.

## Review clarifications

CLI exit codes: 0 means structurally valid reported success (not flight
acceptance), 1 means valid evidence of a failed mission, 2 means usage error,
and 3 means invalid evidence. Use the exit code to distinguish these cases.
Camera mode requires a declared `camera` input and forbids `truth` inputs.
M1 filtered tlogs require the default SITL vehicle system/component 1/1,
quadrotor type 2, ArduPilot autopilot 3, and MAVLink version field 3 in HEARTBEAT.
GCS heartbeats cannot satisfy this evidence requirement. Empty tlogs cannot
accompany autopilot-sourced events. This is a coarse evidence consistency
check; events are not a packet-by-packet transcript, and one heartbeat plus a
position packet does not prove altitude, hold, landing or disarm acceptance.
The writer must separately establish those mission conditions.

Validate completed, quiescent run directories. File-type checks and reads are
separate operations; concurrent replacement is outside this local validator's
trust model. Do not validate a directory being modified by another process.

Minimum supported Rust: 1.75.0, confirmed in landing-lab with Ubuntu packaged
`rustc 1.75.0 (82e1608df 2023-12-21)`. Cargo.toml declares Rust 1.75.
