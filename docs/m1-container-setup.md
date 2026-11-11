# A2 — Rootless container setup and validator evidence

Status: A2 environment created and verified; validator builds, but tests require rework.
Scope: coordinator authorized A2 early solely to unblock validator, plus container-only
Rust/Cargo and linker tooling. No ArduPilot prerequisites/build, mission execution,
host sudo/install/config/service changes, merge, push, or coordinator STATE edits.

Paths below use variables and a worktree placeholder to protect private data.
The recorded results describe the original setup and tests.
This document update does not repeat those operations.

## Verified environment

- Host tools checked before container work: podman 6.1.4-1; distrobox 1.8.2.5-1.
- Rootless Podman: true; container /run/.containerenv reports rootless=1 and name=landing-lab.
- Image index: docker.io/library/ubuntu@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852.
- Explicit pull architecture: amd64; image inspect and container dpkg both confirm amd64.
- Image ID: d9b8c34d61a9b9a3c44cab883d7d2f2619d674966ab520186f799cf32e3e0377.
- Selected architecture manifest in RepoDigests: sha256:78d4744ead1f5b19b04d0df558ab182a5300903900755e515b2ca4d10eb2044d.
- Container OS identifies Ubuntu 24.04.5 LTS (Noble).
- Dedicated initially unused home: `$LAB_HOME`,
  with host path `$HOME/.local/share/landing-lab-home`,
  verified as HOME inside landing-lab and outside all project worktrees.
- AC0 type=Mains, online=1 verified before pull, initialization, apt installation,
  build and test. These are startup checks, not the pending A4 continuous power guard.
- Distrobox is integrated with host home/mounts, not a security sandbox.

## Reproduce setup

Use an unused dedicated home and absent landing-lab container. Check AC positively
online before each setup/build operation; refuse offline/unknown. Commands below
must be logged before execution; exact executed commands are in local evidence.

```sh
pacman -Q podman distrobox
test "$(cat /sys/class/power_supply/AC0/type)" = Mains
test "$(cat /sys/class/power_supply/AC0/online)" = 1
podman info --format '{{.Host.Security.Rootless}}'
UBUNTU_IMAGE=docker.io/library/ubuntu@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852
PROJECT="$HOME/Projects/autonomy-landing-lab"
LAB_HOME="$HOME/.local/share/landing-lab-home"
podman pull --arch amd64 "$UBUNTU_IMAGE"
test ! -e "$LAB_HOME"
mkdir -p "$LAB_HOME"
distrobox create --yes --name landing-lab --image "$UBUNTU_IMAGE" --home "$LAB_HOME"
podman image inspect "$UBUNTU_IMAGE"
distrobox enter landing-lab -- bash -lc '
  set -eu
  . /run/.containerenv
  test "$name" = landing-lab
  test "$rootless" = 1
  test "$HOME" = "$1"
  dpkg --print-architecture
  sudo apt-get update
  sudo apt-get install -y rustc cargo build-essential
  rustc --version --verbose
  cargo --version
  dpkg-query -W
' bash "$LAB_HOME"
```

First entry initializes Distrobox integration packages inside Ubuntu. Complete
initialization log and before/after package inventories are retained locally.
build-essential supplies cc/linker tooling for Cargo linking; no host tooling was installed.

Installed rustc/cargo package versions: 1.75.0+dfsg0ubuntu1-0ubuntu7.4 each.
build-essential: 12.10ubuntu1. rustc/cargo/cc resolve under /usr/bin in Ubuntu.
Exact compiler: **rustc 1.75.0 (82e1608df 2023-12-21) (built from a source tarball)**;
host x86_64-unknown-linux-gnu, LLVM 17.0.6. Cargo: 1.75.0.
Validator declares rust-version="1.75"; **minimum Rust version is 1.75.0**.
Compilation is verified at that version; no claim that the current test suite passes.

The base image is immutable by digest, but Ubuntu repositories and Distrobox
initialization evolve. Recorded package inventories are evidence of this transaction,
not a frozen apt mirror or a promise of byte-identical recreation.
A container timezone mount warning appeared during apt triggers (/etc/localtime,
missing /usr/share/zoneinfo/US/Eastern); installation exited 0 and compilation ran.
No host repair was attempted.

## Validator validation and rework

Target existing worktree:
 `<worktree>/validator`
on m1/validator, base HEAD 71c19e061f70b75ae8718a8bfe2a8fb069b88d90.
Tests included coordinator's uncommitted D1–D4 revisions and regressions.
No validator files were edited, staged, committed or discarded by this task.
Build artifacts were redirected into dedicated home.

Use the same host shell as the setup commands.
Replace `<worktree>` with the path to the existing validator worktree.

```sh
distrobox enter landing-lab -- bash -lc '
  set -eu
  . /run/.containerenv
  test "$name" = landing-lab
  test "$rootless" = 1
  test "$HOME" = "$1"
  export CARGO_TARGET_DIR="$HOME/validator-target"
  cd "$2/validator"
  cargo build --locked
  cargo test --locked
' bash "$LAB_HOME" '<worktree>'
```

Build: exit 0. Test: exit 101. One library unit test passed; main has zero tests;
integration suite: 12 passed, 1 failed (13 total). Failure:
cli_usage_and_invalid_evidence at tests/synthetic.rs:224, actual Some(3),
expected Some(1). No compilation failures. Doc tests were not reached.

An initial source hash comparison detected concurrent coordinator changes to
src/lib.rs. A fresh confirmation build/test reproduced the failure against a
stable before/after source hash set. Use validator-confirm.diff and
validator-confirm-before/after.sha256 to identify that tested uncommitted tree.
Coordinator owns subsequent fixes/commit and fresh review.

## Local evidence and audit limits

Private evidence directory: `$PROJECT/local/m1/`.
The setup commands define `$PROJECT` as the main project directory.
Keep raw private data in ignored `local/`.

- commands.log: commands logged before execution.
- preflight.log, image-pull.log, container-create.log, verification.log:
  tooling/rootless/image/container mounts and digest evidence.
- container-init.log, distrobox-init-full.log: initialization and identity/home evidence.
- rust-install.log: complete apt output, exact compiler/package versions.
- packages-after-init.tsv, packages-after-rust.tsv: full installed package inventories.
- posttest-details.log: apt history/terminal log including image-inherited history.
- validator-build.log, validator-tests.log: initial revised-tree results.
- validator-confirm.log, validator-confirm.diff, validator-confirm-before.sha256,
  validator-confirm-after.sha256: stable-tree repeated result and source evidence.
- validator-pretest.diff, validator-pretest.sha256, validator-posttest.sha256:
  initial snapshot and concurrent-edit evidence.
- m0-proposal-input.md: setup proposal used for pin/home requirements.

Shell output after establishing the capture wrapper was saved fully, with at most
3000 characters displayed per command. Two initial inspection calls preceded that
wrapper; their output was visible in tool results, with the proposal read truncated.
The proposal is now copied in full. **Audit exception:** the initial mkdir -p of
the evidence directory and logging printf bootstrap were not themselves prelogged;
pacman -Q was prelogged and ran before any container task. Subsequent payload
commands were prelogged. This does not claim perfect compliance with the command
audit requirement.

Effort: medium; validator rework remains. No delegation. A3 prerequisite-script
review/log remains required before any full ArduPilot setup. Environment remains
available; no blanket cleanup/prune was run.

Wall time: first recorded timestamp 2026-11-11T11:14:33-05:00 to artifact finalization 2026-11-11T11:19:26.560712-05:00; 294 seconds (initial package check occurred immediately before the first timestamp).
