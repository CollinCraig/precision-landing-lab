# Continuous integration (CI)

The workflow file is `.github/workflows/ci.yml`. It runs on each push and each pull request to `main`.
It has read-only permission, uses no secrets and deploys nothing. A newer run cancels an older run on the same ref.
Each third-party action is pinned by full commit SHA.

## Jobs

| Job | What it checks |
|---|---|
| `python` | Builds `plv`. Runs `tests/test_runner.py`, `tests/test_sitl_up.py`, `tests/test_export_tlog.py` and the M1 platform tests (`test_m1_infrastructure`, `test_pilot_api`, `test_learn_cli`, `test_step_checks`, `test_learner_text`) with `unittest` on Python 3.12. Pilot step tests skip without `M1_PILOT`. The tests use the `plv` binary for the end-to-end case. |
| `rust` | In `validator/`, with Rust 1.75.0 (the minimum supported version): `cargo fmt --check`, `cargo clippy` and `cargo test`. |
| `viewer` | Runs `node --test viewer/tests/*.test.js` on Node 24.11.0 (LTS). |
| `hygiene` | Runs `.github/scripts/hygiene.sh`. It fails on the items in the next list. |

The hygiene job fails on:

- tracked files under `local/` or `runs/`
- an absolute home path (`/home/<name>/`) in a tracked text file
- an email address in a tracked text file
- a tracked file larger than 5 MB

The files `LICENSE` and `NOTICE` are exempt from the home-path and email checks.

## Known limit: clippy

The `rust` job runs clippy without `-D warnings`. Clippy and rustfmt were not installed on the build machine when this file was written.
After the first green run on GitHub, read the clippy output. If it shows no warnings, add `-- -D warnings` to the clippy step.

## Run the same checks locally

Run all commands from the repository root.

1. Run the Python tests.
   - Build `plv`: `cargo build --locked --manifest-path validator/Cargo.toml`
   - Run the tests: `PLV=$PWD/validator/target/debug/plv python3 -m unittest tests.test_runner -v`
   - Without `PLV`, the `plv` end-to-end test is skipped.
2. Run the Rust checks.
   - Go to the validator: `cd validator`
   - Check the format: `cargo fmt --check`
   - Run clippy: `cargo clippy --locked --all-targets`
   - Run the tests: `cargo test --locked`
   - Use Rust 1.75.0 for the same result as CI.
3. Run the viewer tests: `node --test viewer/tests/*.test.js`
4. Run the hygiene checks: `bash .github/scripts/hygiene.sh`
   - The script reads the list of tracked files. Add new files with `git add` first.

In the `landing-lab` container, use `distrobox enter landing-lab -- <command>` for the Rust steps.
The container has no `git` command, so the Python test `test_cli_connection_refusal_records_real_provenance` fails there.
Run the Python tests and the hygiene script on the host.
