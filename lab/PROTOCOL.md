# M1 runner API

`python -m lab.run --help` lists required provenance and child command flags.
`--pilot <folder>` runs the owner's `mission.py` from an external folder (D-038); see
`docs/pilot-interface.md`. Use `--pilot` or a command after `--`, not both.
The runner never starts SITL. `--ardupilot-version` and `--container` must
describe the actual connected build/image, not an intended version. The CLI
inspects Git commit/dirty state and hostname. Declare every mission input with
`--input-source`, including `runner` and `autopilot`. Version 1 of the accepted
run format is unchanged. Synthetic tests use explicitly synthetic provenance.

`run(root, metadata, command, endpoint=..., timeout=..., factory=..., guard=...)`
reserves `root/run_id` exclusively and returns `(Path, result_dict)`. Metadata
contains the accepted manifest fields except schema_version/started_unix_us,
which the writer supplies. Invalid metadata, duplicate directories, and storage
errors raise; no fallback provenance or replacement run is invented. After
reservation, ordinary connection, launch, protocol, mission and interruption
failures produce failed evidence. Disk exhaustion, SIGKILL, and power loss can
leave incomplete evidence; such a directory must remain for diagnosis and must
never be reused. JSON publication follows tlog fsync/close; the two JSON files
are individually atomic, not an atomic directory transaction.
`invocation.json` separately records child argv, endpoint, protocol and timeout;
it is diagnostic provenance outside the validator's strict schema.

Child stdin/stdout use UTF-8 JSON objects, one per line, flushed promptly. Stderr
is saved as `mission.stderr`. Stdout is exclusively protocol, at most 4096 bytes
per line. No shell is involved. The parent sends one initial object:

    {"protocol":"m1-child-v1","seed":42,"scenario":{"name":"synthetic-plumbing"},"mode":"offline"}

The child issues one request at a time and reads its response before issuing
another. No request IDs or concurrent requests are supported. Exact keys:

* `{"op":"receive","type":null,"timeout":1}`: type is null, HEARTBEAT,
  GLOBAL_POSITION_INT, SYS_STATUS, GPS_RAW_INT, EKF_STATUS_REPORT, COMMAND_ACK or
  STATUSTEXT; timeout is finite seconds in [0,5]. Reply is
  `{"type":"HEARTBEAT","packet":"<base64 wire packet>"}`, or `{"packet":null}`
  on timeout. Each selected incoming packet is recorded before delivery;
  packets skipped while waiting for a selected type are also recorded.
  HEARTBEAT and GLOBAL_POSITION_INT go to `flight.tlog` (run format v1).
  The other types go to the sidecar `aux.tlog` (same record layout, 8 MiB limit,
  malformed packets ignored). The validator does not read `aux.tlog`.
  The pilot interface (`lab/pilot_api.py`) always asks with type null and decodes the packets.
* `{"op":"send","packet":"<base64 bytes>"}`: writes 1..280 bytes to the
  connected transport. Reply `{"sent":N}`. There is no command selection,
  encoding, retry, mode transition, or mission policy in the runner. An ack
  here means bytes were handed to transport, not autopilot command acceptance.
* `{"op":"event","kind":"learner_note","source":"runner"}`: reply
  `{"recorded":true}`. Source must be declared; lifecycle kinds are reserved.
* `{"op":"outcome","success":true,"failure_reason":null}`: terminal request,
  no reply. Failure uses false and the accepted `{code,detail}` reason object.
  Then close stdout and exit zero. A nonzero exit, extra protocol content,
  missing outcome, or failure to exit before timeout overrides claimed success.

The child launcher (`lab/mission_child.py`) keeps this protocol on a private copy of
stdout and points `sys.stdout` to stderr, so a stray `print()` cannot break the protocol.

Telemetry is pulled by receive requests, not a background thread. This is a
filtered receive trace, not proof of continuous coverage. There is no implicit
readiness or mission acceptance: the child owns those decisions. Reported
success still requires the schema's heartbeat and position packets. Before any
accepted telemetry, failure codes disallowed for empty tlogs become runner_error
with the original code/detail preserved in the detail. Malformed selected
packets and boot rollback are rejected before storage; previously valid records
remain. Other traffic and non-1/1 traffic are filtered without rewriting packets.

`Connection.receive(type, timeout)`, `wait_heartbeat(timeout)`, and
`heartbeat_fresh(max_age)` are mission-neutral, bounded helpers. A fake transport
needs `recv_match(blocking=False)` returning None or an object with
`get_msgbuf() -> bytes`, `write(bytes)`, and `close()`. These methods and the
factory **must return promptly**; injected Python code is not forcibly timed
out. The lazy pymavlink default supports only explicit 127.0.0.1 UDP endpoints;
TCP retry behavior is deliberately excluded. No dependency is installed.

The default live path and CLI use `WallPowerGuard` from `lab.power`.
The guard reads `/sys/class/power_supply` at each checkpoint. Only supplies
with type `Mains` qualify. At least one supply must report `online=1`.
Missing, unreadable, malformed or oversized attributes cause unknown status.
Battery status does not prove wall power. Other supply types do not qualify.
The source reads at most 128 entries and 64 bytes per attribute.
Reads use local sysfs files. No external commands or system changes occur.

Offline or unknown status prevents connection and child launch. During a run,
either status stops the child process group. The runner writes the failure
reason. An AC failure remains in result detail before telemetry, even when
the accepted format requires `runner_error`. The format remains unchanged.
The guard keeps its first failure. AC recovery does not resume the run.
Start a new run after AC checks pass.

For an injected guard, supply `guard(phase, process)`; phases are
`before_connect`, `before_launch`, `poll`. Raise `RunFailure("ac_unavailable",
detail)` or `RunFailure("ac_lost", detail)` as appropriate. It is called every
receive iteration and approximately every 20 ms while awaiting child output.
The callback must itself be bounded. The run deadline is checked at the same
checkpoints, including during receives.
Each child starts a new POSIX session; `stop_child(process, grace=0.5)` sends
group TERM then KILL and reaps the leader, including after leader exit. Children
must not daemonize or escape their group. This is cleanup isolation, not a
security sandbox. SIGINT/SIGTERM finalize interrupted evidence from the main
thread; other-thread embedders provide cancellation through the guard callback.

## Review clarifications

`read_ac(root=...)` returns `ACState.ONLINE`, `OFFLINE` or `UNKNOWN`.
`WallPowerGuard(source=...)` accepts a prompt, zero-argument source for tests.
Source exceptions and invalid return values cause unknown status.
The guard never signals, polls or reaps the child. The runner owns cleanup.
Create a new guard for each run. Injected fake transports skip the default
guard, so tests do not depend on host power. Supply a guard to test AC loss.
The CLI always supplies a guard. It has no AC bypass flag.

Version/image strings are operator assertions, not
independent verification of a running autopilot or container.

The child is trusted as the author of its declared events and outcome. Source
labels and failure codes supplied by the child are declarations, not verified
provenance. Flight acceptance must inspect evidence separately. Incoming child
protocol is UTF-8 only. Selected malformed telemetry remains a fail-closed
connection error; BAD_DATA recovery is not implemented in M1.

Telemetry evidence is capped at 64 MiB. Child stderr is checked on each runner
checkpoint and aborts over 1 MiB; this is a polled limit and can overshoot during
a burst. It is not a disk quota or a sandbox for hostile child code.

Guard callbacks must not reap the child leader. Use `stop_child` for cleanup.
The runner observes exit with `waitid(WNOWAIT)` until it sends group signals.
