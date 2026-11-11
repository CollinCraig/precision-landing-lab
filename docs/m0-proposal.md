# M0 — Inventory and approval proposal

Status: **proposal only; no installation or system modification approved by this document.** Local audit based on main `680e200604154889e5343e2d2b1957c661aa07ee`. Opus reviews this document, then Collin approves or declines each item independently. M1 remains gated. No prior code was inspected or imported. No primer is included.

## Inventory and evidence

Raw evidence is private, ignored, and local under `local/m0/`; it must not be published. Line references below refer to durable text evidence files in that directory. JSON inventory records retain each command, return code, stdout and stderr.

| Area | Observed result | Evidence / practical limit |
| --- | --- | --- |
| CPU / RAM | i7-11370H, 4 cores / 8 threads; 15 GiB RAM, about 7.5 GiB available at sample | `host.json`; suitable candidate for CPU-first M1, performance not measured |
| Storage | btrfs, about 901 GiB available | `host.json`; capacity is a sample, no large files allocated |
| Temperature | existing sensors reported CPU 43°C, cores 39–43°C; fans 2600/3100 RPM | `host.json`; idle sample, lid-shut thermal behavior UNVERIFIED |
| Power | AC online, battery 100%, fully charged; reported capacity 82.25% of design | `power.json`; no battery endurance inference |
| Lid policy | Existing external-power lid action is `ignore`; battery lid action is `suspend`; docked action is `ignore` | Exact evidence below; these settings alone do not enforce wall-power-only workloads |
| Sleep / persistence | logind active; sleep targets unmasked, static and inactive; user linger disabled | `power.json`; session-self lookup failed, so session-specific behavior UNVERIFIED |
| GPU | RTX 3060 Laptop, 6 GiB; `nvidia-smi` returned successfully, driver 615.78.08, idle 38°C / about 11 W | Exact evidence below; container rendering UNVERIFIED |
| Driver | NVIDIA open DKMS module and matching headers installed | `nvidia.json`; unsigned/out-of-tree taint and hybrid-display CRTC message observed, no demonstrated failure |
| Container tools | Docker/runc/shadow present; Podman, Distrobox and NVIDIA Container Toolkit absent | `containers.json`; Docker is not selected as a substitute for D-009 |
| Rootless prerequisites | subordinate UID/GID allocation, newuidmap/newgidmap, user namespaces and cgroup v2 present | `containers.json`; actual Podman storage/network execution UNVERIFIED, deliberately not initialized |
| T3 | desktop process and loopback listener observed; no CLI user service found; Connect reported enabled | `t3-status.json`; remote reachability and boot recovery UNVERIFIED |

Exact lid evidence, `local/m0/power-evidence.txt:178–179`, from `systemd-analyze cat-config systemd/logind.conf`, in existing `90-always-on-ac.conf`:

```ini
IdleAction=ignore
HandleLidSwitchExternalPower=ignore
```

Effective D-Bus reads are recorded at `local/m0/power-evidence.txt:250–254` (return code 0): `HandleLidSwitch` returned `s "suspend"` at line 252, `HandleLidSwitchExternalPower` returned `s "ignore"` at line 253, and `HandleLidSwitchDocked` returned `s "ignore"` at line 254. Commented defaults are not treated as active settings. Docked lid handling can override ordinary battery lid behavior. No continuous workload battery guard has been verified. Existing inhibitors include delay inhibitors; they are not evidence of a blanket sleep block.

Exact NVIDIA evidence, `local/m0/nvidia-evidence.txt:345–354`, from `nvidia-smi` (return code 0 at line 345; GPU model row at line 354, omitted here to avoid copying hardware addresses):

```text
| NVIDIA-SMI 615.78.08              KMD Version: 615.78.08     CUDA UMD Version: 13.4     |

```

PCI model evidence is `local/m0/nvidia-evidence.txt:84`: `NVIDIA Corporation GA106M [GeForce RTX 3060 Mobile / Max-Q]`. This establishes a successful local query at audit time; the older reported failure is not reproduced. **No NVIDIA repair is proposed.**

## Approval register

Approve items separately, in this order. Commands below are **future commands**, not M0 execution records. `$PROJECT` means the selected repository directory; `$LAB_HOME` means a new dedicated persistent simulation home chosen during setup. Neither expands to a personal path in this document. Shell blocks require the corresponding approval before execution.

| ID | Item | Needed for | Approval state |
| --- | --- | --- | --- |
| A1 | Host Podman and Distrobox | M1 | Pending |
| A2 | Pinned Ubuntu container and dedicated home | M1 | Pending |
| A3 | Pinned ArduPilot dependencies/build and Python/Rust tooling in container | M1 | Pending |
| A4 | Continuous wall-power workload guard; retain existing AC lid policy | Before heavy runs | Pending; implementation specification below |
| A5 | T3 CLI service installation | Remote continuity | Pending; exact side effects UNVERIFIED |
| A6 | Boot persistence / lingering if required | Reboot test | Pending; separate authorization |
| A7 | Apache-2.0 license file and publication review | Before first public push | Pending |
| A8 | Gazebo / plugin in container | M2 only | Pending |
| A9 | NVIDIA container integration | M2 only, if needed | Pending; host configuration scope requires review |
| A10 | Remote/lid tests 1–6, including separately authorized reboot | Before unattended use | Pending |

### A1 — Host container tooling

What/why: install Podman and Distrobox for the approved Ubuntu-container architecture. Arch `shadow` already supplies subordinate-ID helpers; an Ubuntu `uidmap` host package is not applicable.

Proposed host command:

```sh
sudo pacman -Syu --needed podman distrobox
```

Changes: synchronizes repositories, upgrades installed Arch packages, installs container packages and dependencies. This is broader than adding two packages; the full transaction must be reviewed before confirmation. **Host sudo: yes.** No separate Podman daemon enablement is requested. Avoid a partial upgrade (`pacman -Sy` followed by selective installation).

Undo: record the transaction and preexisting package list first; remove only newly added unneeded packages with `sudo pacman -Rns podman distrobox` after checking reverse dependencies. A full system upgrade is not reliably undone by package removal; rollback requires an independently verified existing snapshot or package-cache recovery plan. **Risk: medium**, especially rolling-release upgrade compatibility. If that scope is unacceptable, BLOCKED pending an alternative transaction plan; do not silently install against stale libraries.

### A2 — Ubuntu container

What/why: rootless Ubuntu LTS userspace with a dedicated home keeps Linux build dependencies out of the host package database. Distrobox shares substantial host integration and is not a security sandbox.

Image digest pin and exact creation commands are supplied in the version section. Pulling an image changes rootless container storage and uses network access. Creating the container adds its writable layer and selected home directory. **Host sudo: no.** Container initialization may install integration packages inside Ubuntu.

Undo, after inspecting contents and stopping runs:

```sh
distrobox stop landing-lab
distrobox rm landing-lab
podman image rm "$UBUNTU_IMAGE"
```

Keep `$LAB_HOME` and experiment artifacts until explicitly selected for deletion. No blanket volume/storage prune. **Risk: medium:** home integration, downloaded supply chain, storage use and unverified rootless networking. Verify image digest and rootless execution before proceeding to A3.

### A3 — CPU-first build and tooling

What/why: external ArduPilot Copter SITL plus Python MAVLink and Rust validator tooling. M1 uses built-in SITL physics; Gazebo/GPU are not prerequisites. Keep ArduPilot source outside the Apache project tree and communicate through MAVLink.

Future setup sequence (inside the approved Ubuntu container):

```sh
sudo apt-get update
sudo apt-get install -y git ca-certificates python3-venv build-essential rustc cargo
mkdir -p "$HOME/src"
cd "$HOME/src"
git clone --no-checkout https://github.com/ArduPilot/ardupilot.git
cd ardupilot
git checkout --detach "$ARDUPILOT_COMMIT"
git submodule update --init --recursive
Tools/environment_install/install-prereqs-ubuntu.sh -y
```

Before running the prerequisite script, inspect its pinned contents and save the proposed apt/pip actions. Stop if it requests host integration or anything outside this approved container. Start a fresh container shell afterward so its environment is loaded, then:

```sh
cd "$HOME/src/ardupilot"
./waf configure --board sitl
./waf copter
python3 -m venv "$HOME/venvs/landing"
"$HOME/venvs/landing/bin/python" -m pip install --require-hashes -r "$PROJECT/requirements-m1.lock"
```

**BLOCKED detail:** `requirements-m1.lock` does not exist yet and is a future M1 review artifact. Pin pymavlink and its dependencies with hashes there before running the last command. OpenCV/AprilTag dependencies belong to M2; do not add them to CPU-first setup by implication. Ubuntu apt Rust is a conservative initial candidate; validate its version against the future validator's declared minimum Rust version. No rustup installer or paid API is implied.

Changes: Ubuntu packages, external source checkout/submodules, build artifacts, container Python environment and shell environment installed by ArduPilot's script. **Sudo: inside container only; no host sudo.** Undo: remove/recreate the container after preserving selected source and logs, or remove the dedicated venv/build checkout. Host-integrated home contents survive container removal. **Risk: medium:** prerequisite script has broad container effects; script review, dependency lock and CPU build compatibility are pending. M1 mission code and its five consecutive acceptance passes require a separate milestone authorization.
### A4 — Wall-power guard and lid policy

What/why: retain the observed AC lid policy; add a continuous workload guard because unplugging while the lid remains shut need not generate a new lid event, and docked handling ignores closure. **BLOCKED pending a reviewed guard artifact.** Specify: refuse heavy-run startup unless AC is positively online; continuously monitor AC; on unplug or unknown power state terminate the entire simulation process group gracefully, then force-stop after a bounded timeout; record the reason and do not auto-resume. Verify docked and undocked behavior. Container child processes must not escape the guard. Battery suspend policy is additional protection, not the workload guard.

Exact installation/execution commands cannot responsibly be supplied until that artifact and its process ownership are reviewed. No new logind file is proposed now. If subsequent tests require a policy change, submit its complete diff separately. Changes: future repository runner and possibly an explicitly reviewed user unit; **host sudo: no for a repository runner; any system policy change needs separate approval.** Undo: stop the runner and revert its reviewed commit; remove only specifically installed units if separately approved. **Risk: high until tested:** lost AC events, escaped processes, thermal load and loss of remote access. No blanket sleep inhibitor or battery-lid-ignore change is proposed.

### A5 — T3 Connect CLI service

What/why: independent user-service continuity when the desktop/client disconnects. Observed desktop Connect status does not prove remote accessibility or startup after logout. The installed wrapper has mount/temp-file side effects even for help; no additional help invocation was performed after this was identified.

Candidate future CLI commands, to verify against safe help/public documentation first:

```sh
t3 service status
t3 service install
t3 service status
```

**BLOCKED/UNVERIFIED:** exact unit name/content, executable arguments, installation paths, environment files, listeners/ports, bind address, authentication/token lifecycle, uninstall cleanup and automatic lingering behavior. Do not approve this as a fully specified system transaction yet. Obtain a version-matched service-install preview or upstream documentation, attach the complete unit/environment diff with secret values redacted, and approve that concrete transaction before `install`. No privileged service-protection operation is included. The observed loopback listener is not evidence that service installation preserves its binding.

Changes: expected user-unit files and background process; exact effects remain UNVERIFIED. **Host sudo: not established for all side effects; stop if required.** Candidate undo is `t3 service uninstall`, but completeness is UNVERIFIED until documented; preserve existing authentication and settings. **Risk: medium/high:** persistence, listener exposure and credential handling. No auth file contents are included in this proposal.

### A6 — Boot persistence, separate from service installation

What/why: test 6 requires service startup without an interactive login. Observed `Linger=no` (`power-evidence.txt:247`) does not satisfy this. After A5's unit is known, propose this separately:

```sh
loginctl enable-linger "$USER"
loginctl show-user "$USER" -p Linger
```

Changes: persistent per-user systemd manager at boot; may keep all enabled user services running after logout. **Host privilege: policy-dependent; may require administrator authorization; never escalate automatically.** Undo: `loginctl disable-linger "$USER"` after evaluating other user services. Exact service enablement command remains BLOCKED until the unit is known. **Risk: medium:** background resource consumption and broader user-service persistence. Reboot is separately gated in A10.

### A7 — Apache license and publication preparation

What/why: add the unmodified official Apache License 2.0 text after approval. Official source: <https://www.apache.org/licenses/LICENSE-2.0.txt>; fetched copy and source digest recorded privately in `sources/index.json`.

Future repository-only commands:

```sh
curl --fail --location --proto '=https' --proto-redir '=https' https://www.apache.org/licenses/LICENSE-2.0.txt --output LICENSE
git diff -- LICENSE
```

Changes: one repository license file; **sudo: no.** Undo: remove the uncommitted file or revert its subsequent commit. **Risk: low for the file, unresolved for publication:** review project ownership, dependency licenses, assets/data provenance and secrets before the first public push. ArduPilot and plugin licenses require separate review; Apache licensing this project's original files does not relicense upstream code. No repository creation or public push is authorized.

### A8 — Gazebo and plugin, M2 only

What/why: camera/tag scene and rendering after CPU-first M1 succeeds. Select Harmonic and the immutable plugin commit below. Official Ubuntu Harmonic installation instructions: <https://gazebosim.org/docs/harmonic/install_ubuntu/>. The pinned plugin README recommends Harmonic but specifically describes Ubuntu 22.04; its Ubuntu 24.04 build is **UNVERIFIED**.

Candidate commands inside the approved container, after a separate M2 dependency transaction review:

```sh
sudo apt-get update
sudo apt-get install -y curl gnupg lsb-release cmake
sudo curl --fail --location https://packages.osrfoundation.org/gazebo.gpg --output /usr/share/keyrings/pkgs-osrf-archive-keyring.gpg
printf '%s\n' 'deb [arch=amd64 signed-by=/usr/share/keyrings/pkgs-osrf-archive-keyring.gpg] https://packages.osrfoundation.org/gazebo/ubuntu-stable noble main' | sudo tee /etc/apt/sources.list.d/gazebo-stable.list
sudo apt-get update
sudo apt-get install -y gz-harmonic libgz-sim8-dev rapidjson-dev libopencv-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev
cd "$HOME/src"
git clone --no-checkout https://github.com/ArduPilot/ardupilot_gazebo.git
cd ardupilot_gazebo
git checkout --detach f116b03552d05c8d0b0bed5ed67033a1183121d1
GZ_VERSION=harmonic cmake -S . -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build -j2
```

**BLOCKED detail:** freeze exact apt package versions/transitive dependencies and verify signing-key identity before executing the repository/package steps. Pin plugin/source now; do not claim this unversioned apt block is a complete reproducible environment. Runtime resource/model paths must follow the pinned README and be reviewed before adding environment exports. Changes: container repository/key, packages, source and build artifacts; **sudo: container only.** Undo: recreate the container or remove the reviewed M2 packages, repository/key and build directory; preserve selected logs/models. **Risk: medium:** package drift, plugin compatibility, camera timing and performance.

### A9 — NVIDIA container rendering, no repair now

What/why: only if M2 needs accelerated rendering. Local GPU query works; no driver/module/kernel repair is warranted. Toolkit/CDI and rendering-library integration are separate questions. Distrobox's supported NVIDIA integration candidate is creation with `--nvidia`, using a separately named M2 container; do not recreate the M1 environment silently.

**BLOCKED:** exact toolkit packages/CDI generation/configuration commands require a version-matched host proposal. No host configuration command is approved by this document. Validate whether Distrobox integration alone supplies the required graphics libraries before proposing NVIDIA Container Toolkit. Changes may include host packages, CDI configuration and container device access; **sudo: potentially host, pending exact design.** Undo depends on the concrete package/config diff; retain existing working host driver. **Risk: medium/high:** hybrid graphics and host-driver/container-library mismatch. CPU M1 is independent.

## Version selection and verification boundaries

| Component | Selected pin | Evidence and qualification |
| --- | --- | --- |
| Ubuntu | 24.04 LTS amd64; OCI index `sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852` | Official `library/ubuntu:24.04` registry manifest saved in `sources/ubuntu-manifest.txt`, response digest in `pins-index.json`. Index includes architecture manifests; explicitly select amd64. Container integration and apt updates still change the writable environment. |
| ArduPilot Copter | `Copter-4.7.2`, commit `fb773567896014da007bca58358704d4a0d8516f` | Official matching refs <https://api.github.com/repos/ArduPilot/ardupilot/git/matching-refs/tags/Copter-4>; stable-form tag observed. Build/runtime acceptance still required; this is a selected stable tag, not a promise that it is newest. |
| Gazebo | Harmonic LTS / gz-sim 8 series | Official Ubuntu installation docs support Noble; API reference fetched identifies 8.15.0. **Exact apt patch/transitive version freeze BLOCKED** until install proposal refresh; API documentation version does not establish available package version. |
| ardupilot_gazebo | `f116b03552d05c8d0b0bed5ed67033a1183121d1` | <https://github.com/ArduPilot/ardupilot_gazebo/blob/f116b03552d05c8d0b0bed5ed67033a1183121d1/README.md>; Harmonic recommended; Noble combination UNVERIFIED. |

A2 exact future creation sequence (dedicated home must be an unused approved directory):

```sh
export UBUNTU_IMAGE='docker.io/library/ubuntu@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852'
export ARDUPILOT_COMMIT='fb773567896014da007bca58358704d4a0d8516f'
podman pull --arch amd64 "$UBUNTU_IMAGE"
mkdir -p "$LAB_HOME"
distrobox create --name landing-lab --image "$UBUNTU_IMAGE" --home "$LAB_HOME"
distrobox enter landing-lab
```

Re-establish `$PROJECT` and `ARDUPILOT_COMMIT` explicitly inside the container; shell inheritance is not assumed. Record resulting image ID, distrobox/podman/package versions, source/submodule SHAs and apt/pip locks in the future run manifest. Build script/package compatibility is UNVERIFIED until the approved setup runs.

Precision landing: official developer documentation explicitly describes MAVLink `LANDING_TARGET` for Copter and QuadPlane, with `PLND_TYPE=1` and at least 2 Hz messages: <https://ardupilot.org/dev/docs/mavlink-precision-landing.html>. Copter parameter/behavior guide: <https://ardupilot.org/copter/docs/precision-landing-and-loiter.html>. The selected source contains `AC_PrecLand` estimator, target timeout and `PLND_STRICT` handling: <https://github.com/ArduPilot/ardupilot/blob/fb773567896014da007bca58358704d4a0d8516f/libraries/AC_PrecLand/AC_PrecLand.cpp>. **SITL operation on this exact pin remains UNVERIFIED**: no firmware was built or run during M0. Validate enabled feature flags, backend, required sensor/range configuration, message frame/signs and landing behavior in M3. A failed guessed backend source URL was discarded as evidence.

Wind: official Harmonic WindEffects documentation describes approximate link forces based on link mass and relative wind velocity at the link origin: <https://gazebosim.org/api/sim/8/classgz_1_1sim_1_1systems_1_1WindEffects.html>. **UNVERIFIED:** selected world/model enables the system and link wind, plugin/flight dynamics force coupling, and measurable wind response. M4 must prove vehicle displacement/attitude response and avoid applying both Gazebo and SITL wind to the same physics unintentionally. Seeds do not guarantee exact deterministic physics.

Roadmap only: QuadPlane precision landing is documented by the MAVLink guide, but aircraft setup, landing transitions and this pin's behavior remain UNVERIFIED. SITL simulated ADS-B is supported by selected source: <https://github.com/ArduPilot/ardupilot/blob/fb773567896014da007bca58358704d4a0d8516f/libraries/SITL/SITL.cpp> defines `ADSB_COUNT`, `ADSB_RADIUS` and `ADSB_ALT` within the SIM parameter group; <https://github.com/ArduPilot/ardupilot/blob/fb773567896014da007bca58358704d4a0d8516f/libraries/SITL/SIM_ADSB.cpp> implements simulated aircraft and `ADSB_VEHICLE` messages. Runtime `SIM_ADSB_*` availability, enablement and encounter behavior remain UNVERIFIED. No avoidance/safety performance claim follows from simulated traffic.

Rootless references: <https://docs.podman.io/en/latest/markdown/podman.1.html> and <https://distrobox.it/>. Existing subordinate IDs/helpers and namespaces support suitability, but do not prove storage/network/device execution. No Podman initialization was attempted in M0.
## A10 — Remote/lid acceptance procedure (future, after approvals)

All six tests are **NOT RUN / UNVERIFIED**. Use existing T3 clients; no Mac-hosted runtime dependency. Record timestamps, power events, process IDs/run ID, existing sensor readings, exit reasons, reconnect time and result/log paths in ignored local artifacts. Never capture tokens or authentication URLs. Before testing, verify the approved runner can stop its entire workload, preserve logs and recover from client loss. Run the CPU M1 mission only after M1 authorization. A desktop/idle-only smoke test can precede that, but cannot establish mission continuity.

1. **AC lid closure and remote access.** Confirm wall power positively online and battery charge adequate, start the approved runner on the laptop, connect from the portable client, close the laptop lid, then reconnect/check status within two minutes. Pass: fresh remote status and timestamps, intended processes alive, AC remains online. Fail: suspend, lost access, stale status or a blocked battery guard. Reopen lid to recover; no configuration changes during the test.
2. **Ten-minute thermal/mission run.** On AC, record baseline readings using the existing sensor reader, start an approved ten-minute CPU workload/mission sequence, close lid, and sample temperatures/status remotely at one-minute intervals. Pass: complete logs, no thermal shutdown/suspend, guard remains active, and temperatures stay within a pre-agreed limit derived from the host's reported critical thresholds. **Threshold approval remains pending**; do not invent a universal CPU limit. Stop on critical warnings, overheating signs or missing telemetry. This validates only the tested load; GPU M2 needs a separate thermal test.
3. **Client disconnect.** During an AC run, note run/process IDs and last log timestamp, disconnect/close the portable T3 client for two minutes, then reconnect. Pass: same run/process IDs, advancing logs through the gap, no duplicate runner and readable completion result. Inspect the service/runner logs if it stops; do not auto-restart a failed experiment.
4. **Network interruption.** With permission for this test, disconnect the portable client's own network for two minutes using its ordinary UI; leave laptop networking unchanged. Restore client access and reconnect. Pass: same run continues, logs span the gap and connection recovers within two minutes of client network restoration. Laptop-side outage recovery remains **UNVERIFIED** unless separately authorized and tested; no firewall, router or laptop-network changes are included.
5. **Battery refusal and unplug guard.** Start with no active heavy workload. Unplug, confirm battery state, and attempt the approved runner: it must refuse startup with a recorded reason. Reconnect AC, start a brief approved load, close lid, then unplug while observing from the portable client. Pass: workload stops within the reviewed guard deadline, logs flush, no auto-resume and no continued heavy battery use. Repeat with an external display/docked condition only if that hardware is already available and approved. If suspension prevents immediate log reads, reopen lid and inspect after recovery. Stop if the workload continues; no repeated heavy battery experiments.
6. **Boot recovery without login.** **Explicit reboot authorization is required immediately before execution.** After A5/A6 and all other applicable approvals, save open work, stop simulations, record enabled unit and linger state, and reboot using an explicitly approved command. Do not log in locally. From the portable client, attempt Connect access after boot and inspect the expected user service. Pass: remote access and service readiness without interactive login; simulations remain stopped until AC and runner checks pass. Failure is a recorded limitation; recover with local login, not unapproved service/security changes.

The test operator must remain available to reopen the lid/reconnect power. No unattended-use claim is valid before these pass. Tests 1–5 do not authorize test 6's reboot.

## Handoff and open gates

M0 supplies inventory and proposals only. Opus must review source/evidence accuracy and the incomplete transactions above before Collin approves each item. A4 guard, A5 exact service transaction, A8 full package freeze and A9 graphics integration need further concrete review artifacts. Runtime precision landing, wind force coupling, ADS-B, rootless execution and all remote/lid tests remain UNVERIFIED. No model training, old-code import, physical vehicle work or public publication is included.

Usage/quota indicators are not visible in the execution interface. Effort calibration belongs to M1; no effort/provider switch or paid fallback was requested. Wall time and the command audit are reported in the local completion report; raw host evidence remains ignored.

Audit limitation: `local/m0/command-audit.md` reconstructs the captured inventory commands and known repository/research activity. Exact full-session shell invocation history is **INCOMPLETE**, including earlier T3 help/source-inspection wrappers. Their possible transient mount/temp-file effects are not certified. No package installation, sudo, service/configuration/driver changes, reboot or push was intentionally executed. The complete-command-history acceptance criterion remains **BLOCKED** on missing historical records; Opus must review this limitation.
