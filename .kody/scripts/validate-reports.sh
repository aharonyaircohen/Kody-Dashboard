#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
node "$ROOT/scripts/validate-reports.mjs" "$ROOT/.kody/reports"
