#!/usr/bin/env bash
set -u -o pipefail

# Runs every evals/*.mjs suite in parallel and reports one trustworthy exit code.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EVALS_DIR="$REPO_ROOT/evals"
TIMEOUT_SECONDS=300
DEFAULT_CONCURRENCY=8

# A BSD host without coreutils has no timeout, so fail closed rather than run unbounded.
TIMEOUT_BIN="$(command -v timeout || command -v gtimeout || true)"
if [ -z "$TIMEOUT_BIN" ]; then
  echo "run-evals: needs timeout from coreutils (brew install coreutils)" >&2
  exit 69
fi

usage() {
  echo "usage: $(basename "$0") [concurrency]" >&2
  echo "concurrency is an integer from 1 to 32" >&2
}

# Worker mode: run one suite, apply the per-suite timeout, and print one result line.
if [ "${1:-}" = "--run-one" ]; then
  suite="$2"
  name="$(basename "$suite")"
  out="$(mktemp)"

  "$TIMEOUT_BIN" -k 1 "$TIMEOUT_SECONDS" node "$suite" >"$out" 2>&1
  status=$?

  last_line="$(tail -n 1 "$out" 2>/dev/null)"
  if [ "$status" -eq 124 ]; then
    status=1
    last_line="timed out after ${TIMEOUT_SECONDS}s"
  fi
  rm -f "$out"
  printf '%s\t%s\t%s\n' "$name" "$status" "$last_line"
  exit 0
fi

concurrency="$DEFAULT_CONCURRENCY"
if [ "$#" -ge 1 ]; then
  case "$1" in
    ''|*[!0-9]*)
      usage
      exit 64
      ;;
    *)
      concurrency="$1"
      ;;
  esac
  if [ "$concurrency" -lt 1 ] || [ "$concurrency" -gt 32 ]; then
    usage
    exit 64
  fi
fi

all_suites=("$EVALS_DIR"/*.mjs)
if [ ! -e "${all_suites[0]}" ]; then
  echo "run-evals: no eval suites found in $EVALS_DIR" >&2
  exit 1
fi

# build-layer-test measures real scheduler overlap, so pool contention fails it.
SERIAL_SUITES=(build-layer-test.mjs)
suites=()
serial=()
for suite in "${all_suites[@]}"; do
  name="$(basename "$suite")"
  is_serial=0
  for reserved in "${SERIAL_SUITES[@]}"; do
    [ "$name" = "$reserved" ] && is_serial=1
  done
  if [ "$is_serial" -eq 1 ]; then serial+=("$suite"); else suites+=("$suite"); fi
done

results_file="$(mktemp)"
trap 'rm -f "$results_file"' EXIT
start_ts=$(date +%s)

for suite in ${serial[@]+"${serial[@]}"}; do
  "$SELF" --run-one "$suite" >> "$results_file"
done
printf '%s\n' ${suites[@]+"${suites[@]}"} | xargs -P "$concurrency" -I{} "$SELF" --run-one {} >> "$results_file"

end_ts=$(date +%s)
elapsed=$((end_ts - start_ts))
passed=0
failed=0
failures=()

while IFS=$'\t' read -r name code lastline; do
  printf '%s exit=%s last: %s\n' "$name" "$code" "$lastline"
  if [ "$code" -eq 0 ]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    failures+=("$name")
  fi
done < "$results_file"

echo
echo "passed: $passed  failed: $failed  time: ${elapsed}s"
if [ "$failed" -gt 0 ]; then
  echo "failures:"
  for name in "${failures[@]}"; do
    echo "  $name"
  done
  exit 1
fi
exit 0
