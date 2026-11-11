#!/usr/bin/env bash
# Serve the repository root on localhost only, so the viewer can read both
# viewer/ and runs/ (git-ignored local runs). Never binds beyond 127.0.0.1.
#   viewer/serve.sh [port]      default port 8765
set -euo pipefail
port="${1:-8765}"
case "$port" in ''|*[!0-9]*) echo "usage: viewer/serve.sh [port]" >&2; exit 2;; esac
cd "$(dirname "$0")/.."
echo "Replay viewer: http://127.0.0.1:${port}/viewer/index.html?run=samples/sample-clean-hold"
echo "Serving $(pwd) on 127.0.0.1 only. Ctrl-C to stop."
exec python3 -m http.server --bind 127.0.0.1 "$port"
