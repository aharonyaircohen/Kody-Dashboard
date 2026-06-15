#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_refresh() {
  local label="$1"
  local script="$2"
  local output
  shift 2

  if ! output="$(bash "$SCRIPT_DIR/$script" "$@" 2>&1)"; then
    printf 'FAILED: %s failed\n%s\n' "$label" "$output"
    exit 1
  fi

  if grep -q '^FAILED:' <<<"$output"; then
    printf '%s\n' "$output"
    exit 1
  fi
}

run_refresh "CI health graph" "refresh-ci-health-graph.sh" "$@"
run_refresh "PR graph" "refresh-pr-graph.sh" "$@"

printf 'DONE\nCOMMIT_MSG: chore(reports): refresh delivery graphs\nPR_SUMMARY:\n- Refreshed .kody/reports/ci-health-graph.md.\n- Refreshed .kody/reports/pr-graph.md.\n'
