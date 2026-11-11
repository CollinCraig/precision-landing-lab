#!/usr/bin/env bash
# Repository hygiene checks (see docs/ci.md). Run from the repository root.
set -u
fail=0
report() { echo "FAIL: $1"; fail=1; }

# 1. Raw host data and run outputs must not be tracked.
bad=$(git ls-files | grep -E '^(local|runs)/' || true)
[ -z "$bad" ] || report "tracked files under local/ or runs/:
$bad"

# 2. No absolute home paths or email addresses in tracked text files.
# Allow-list: license files, and this script (it holds the patterns).
allow='^(LICENSE|NOTICE|\.github/scripts/hygiene\.sh)$'
home_re='/home/[A-Za-z0-9_.-]+/'
mail_re='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'
files=$(git ls-files | grep -Ev "$allow" || true)
while IFS= read -r f; do
  [ -f "$f" ] || continue
  grep -Iq . "$f" || continue   # skip binary and empty files
  hits=$(grep -InE -e "$home_re" -e "$mail_re" "$f" || true)
  [ -z "$hits" ] || report "home path or email address in $f:
$hits"
done <<< "$files"

# 3. No tracked file over 5 MB.
limit=$((5 * 1024 * 1024))
while IFS= read -r f; do
  [ -f "$f" ] || continue
  size=$(wc -c < "$f")
  [ "$size" -le "$limit" ] || report "file over 5 MB ($size bytes): $f"
done <<< "$(git ls-files)"

[ "$fail" -eq 0 ] && echo "hygiene: OK"
exit "$fail"
