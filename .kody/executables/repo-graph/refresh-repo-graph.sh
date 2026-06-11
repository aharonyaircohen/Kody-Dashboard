#!/usr/bin/env bash
set -euo pipefail

node .kody/scripts/refresh-repo-graph.cjs "$@"
