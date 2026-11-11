# M1 runner API

`python -m lab.run --help` lists required provenance and child command flags.
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

* `{"op":"receive","type":null,"timeout":1}`: type is null, HEARTBEAT, or
  GLOBAL_POSITION_INT; timeout is finite seconds in [0,5]. Reply is
  `{"type":"HEARTBEAT","packet":"<base64 wire packet>"}`, or `{"packet":null}`
  on timeout. Each selected incoming packet is recorded before delivery;
  packets skipped while waiting for a selected type are also recorded.
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

For the next wall-power guard task, supply `guard(phase, process)`; phases are
`before_connect`, `before_launch`, `poll`. Raise `RunFailure("ac_unavailable",
detail)` or `RunFailure("ac_lost", detail)` as appropriate. It is called every
receive iteration and approximately every 20 ms while awaiting child output.
The callback must itself be bounded. The run deadline is checked at the same
checkpoints, including during receives. No power check is implemented here.
Each child starts a new POSIX session; `stop_child(process, grace=0.5)` sends
group TERM then KILL and reaps the leader, including after leader exit. Children
must not daemonize or escape their group. This is cleanup isolation, not a
security sandbox. SIGINT/SIGTERM finalize interrupted evidence from the main
thread; other-thread embedders provide cancellation through the guard callback.
