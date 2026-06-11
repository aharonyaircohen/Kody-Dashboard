#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

REPORT_SLUG="docs-graph"
REPORT_PATH=".kody/reports/${REPORT_SLUG}.md"
STATE_BRANCH="kody-state"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

NODES="$TMP_DIR/nodes.json"
EDGES="$TMP_DIR/edges.json"
FINDINGS="$TMP_DIR/findings.json"
REPORT_BODY="$TMP_DIR/${REPORT_SLUG}.md"
DOCS="$TMP_DIR/docs.txt"
printf '[]\n' >"$NODES"
printf '[]\n' >"$EDGES"
printf '[]\n' >"$FINDINGS"
: >"$DOCS"

fail() {
  printf 'FAILED: %s\n' "$*"
  exit 1
}

command -v jq >/dev/null 2>&1 || fail "jq is required"
command -v gh >/dev/null 2>&1 || fail "gh is required"
command -v node >/dev/null 2>&1 || fail "node is required"
command -v perl >/dev/null 2>&1 || fail "perl is required"

hash_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

decode_base64() {
  if base64 --help 2>&1 | grep -q -- '--decode'; then
    base64 --decode
  else
    base64 -D
  fi
}

append_unique_json() {
  local file="$1"
  local item="$2"
  local tmp="$file.tmp"
  jq --argjson item "$item" '
    if any(.[]; .id == $item.id) then . else . + [$item] end
  ' "$file" >"$tmp"
  mv "$tmp" "$file"
}

add_node() {
  append_unique_json "$NODES" "$1"
}

add_edge() {
  local from="$1"
  local to="$2"
  local relation="$3"
  [[ -n "$from" && -n "$to" ]] || return 0
  append_unique_json "$EDGES" "$(jq -nc \
    --arg from "$from" \
    --arg to "$to" \
    --arg relation "$relation" \
    '{id: ($from + "->" + $relation + "->" + $to), from: $from, to: $to, relation: $relation}')"
}

add_finding() {
  local id="$1"
  local severity="$2"
  local title="$3"
  local data="${4:-{}}"
  if ! jq -e . >/dev/null 2>&1 <<<"$data"; then
    data="$(jq -nc --arg raw "$data" '{raw: $raw}')"
  fi
  append_unique_json "$FINDINGS" "$(jq -nc \
    --arg id "$id" \
    --arg severity "$severity" \
    --arg title "$title" \
    --arg data "$data" \
    '{id: $id, severity: $severity, title: $title, data: ($data | fromjson)}')"
}

safe_slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+|-+$//g'
}

doc_id() {
  printf 'doc:%s' "$(safe_slug "$1")"
}

normalize_path() {
  node -e 'const path = require("path"); const input = process.argv[1]; console.log(path.posix.normalize(input.replace(/\\/g, "/")).replace(/^\.\//, ""));' "$1"
}

strip_link_target() {
  local target="$1"
  target="${target%% \"*}"
  target="${target#<}"
  target="${target%>}"
  target="${target%%#*}"
  target="${target%%\?*}"
  printf '%s' "$target"
}

is_external_link() {
  case "$1" in
    http://*|https://*|mailto:*|tel:*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

external_host() {
  local target="$1"
  case "$target" in
    http://*|https://*)
      target="${target#*://}"
      printf '%s' "${target%%/*}"
      ;;
    mailto:*)
      printf 'mailto'
      ;;
    tel:*)
      printf 'tel'
      ;;
    *)
      printf '%s' "$target"
      ;;
  esac
}

resolve_local_target() {
  local doc="$1"
  local raw_target="$2"
  local target
  target="$(strip_link_target "$raw_target")"
  [[ -n "$target" ]] || return 1

  local candidate
  if [[ "$target" == /* ]]; then
    candidate="$(normalize_path ".${target}")"
  else
    candidate="$(normalize_path "$(dirname "$doc")/$target")"
  fi

  if [[ -f "$candidate" ]]; then
    printf '%s' "$candidate"
  elif [[ -f "${candidate}.md" ]]; then
    printf '%s' "${candidate}.md"
  elif [[ -d "$candidate" && -f "$candidate/README.md" ]]; then
    printf '%s' "$candidate/README.md"
  elif [[ -d "$candidate" && -f "$candidate/index.md" ]]; then
    printf '%s' "$candidate/index.md"
  else
    printf '%s' "$candidate"
    return 2
  fi
}

find . \
  -path './node_modules' -prune -o \
  -path './.next' -prune -o \
  -path './.git' -prune -o \
  -path './coverage' -prune -o \
  -name '*.md' -type f -print \
  | sed 's#^\./##' \
  | sort >"$DOCS"

while IFS= read -r doc; do
  add_node "$(jq -nc \
    --arg id "$(doc_id "$doc")" \
    --arg path "$doc" \
    --arg h1 "$(grep -m 1 -E '^# [^#]' "$doc" | sed -E 's/^# //' || true)" \
    '{id: $id, type: "doc", path: $path, h1: $h1}')"

  if ! grep -q -E '^# [^#]' "$doc"; then
    add_finding "docs-graph.missing-h1.$(safe_slug "$doc")" "low" \
      "$doc has no H1 heading" "$(jq -nc --arg file "$doc" '{file: $file}')"
  fi

  todo_count="$(grep -Eic '\b(TODO|FIXME)\b' "$doc" || true)"
  if [[ "$todo_count" -gt 0 ]]; then
    add_finding "docs-graph.todo.$(safe_slug "$doc")" "low" \
      "$doc contains TODO/FIXME markers" \
      "$(jq -nc --arg file "$doc" --arg count "$todo_count" '{file: $file, count: ($count | tonumber)}')"
  fi

  while IFS= read -r raw_target; do
    [[ -n "$raw_target" ]] || continue
    if [[ "$raw_target" == \#* ]]; then
      continue
    fi

    if is_external_link "$raw_target"; then
      host="$(external_host "$raw_target")"
      host_slug="$(safe_slug "$host")"
      add_node "$(jq -nc --arg id "external:$host_slug" --arg host "$host" \
        '{id: $id, type: "external", host: $host}')"
      add_edge "$(doc_id "$doc")" "external:$host_slug" "links_to_external"
      continue
    fi

    set +e
    resolved="$(resolve_local_target "$doc" "$raw_target")"
    resolve_status=$?
    set -e
    [[ -n "$resolved" ]] || continue

    if [[ "$resolve_status" -eq 0 ]]; then
      if [[ "$resolved" == *.md ]]; then
        add_edge "$(doc_id "$doc")" "$(doc_id "$resolved")" "links_to_doc"
      else
        asset_id="asset:$(safe_slug "$resolved")"
        add_node "$(jq -nc --arg id "$asset_id" --arg path "$resolved" \
          '{id: $id, type: "asset", path: $path}')"
        add_edge "$(doc_id "$doc")" "$asset_id" "links_to_asset"
      fi
    elif [[ "$resolve_status" -eq 2 ]]; then
      missing_id="missing:$(safe_slug "$resolved")"
      add_node "$(jq -nc --arg id "$missing_id" --arg path "$resolved" \
        '{id: $id, type: "missing", path: $path}')"
      add_edge "$(doc_id "$doc")" "$missing_id" "links_to_missing"
      add_finding "docs-graph.broken-link.$(safe_slug "$doc").$(safe_slug "$resolved")" "high" \
        "$doc links to missing local target $resolved" \
        "$(jq -nc --arg file "$doc" --arg target "$raw_target" --arg resolved "$resolved" \
          '{file: $file, target: $target, resolved: $resolved}')"
    fi
  done < <(perl -ne 'while (/!?\[[^\]]*\]\(([^)]+)\)/g) { print "$1\n" }' "$doc")
done <"$DOCS"

nodes_sorted="$(jq -c 'sort_by(.id)' "$NODES")"
edges_sorted="$(jq -c 'sort_by(.id)' "$EDGES")"
node_counts="$(jq -nc --argjson nodes "$nodes_sorted" '
  def count_type($t): [$nodes[] | select(.type == $t)] | length;
  {
    docs: count_type("doc"),
    external: count_type("external"),
    assets: count_type("asset"),
    missing: count_type("missing")
  }
')"
edge_counts="$(jq -c '
  group_by(.relation)
  | map({key: .[0].relation, value: length})
  | from_entries
' <<<"$edges_sorted")"
graph="$(jq -nc --argjson nodes "$nodes_sorted" --argjson edges "$edges_sorted" \
  '{schemaVersion: 1, nodes: $nodes, edges: $edges}')"
graph_hash="$(printf '%s' "$graph" | jq -S -c . | hash_stdin)"

add_finding "docs-graph.snapshot" "low" "Docs graph snapshot emitted" \
  "$(jq -nc --arg graphHash "$graph_hash" --argjson nodeCounts "$node_counts" --argjson edgeCounts "$edge_counts" \
    '{nodeCounts: $nodeCounts, edgeCounts: $edgeCounts, graphHash: $graphHash}')"

while IFS= read -r item; do
  path="$(jq -r '.path' <<<"$item")"
  add_finding "docs-graph.orphan.$(safe_slug "$path")" "low" \
    "$path has no incoming or outgoing documentation links" "$item"
done < <(jq -c --argjson edges "$edges_sorted" '
  [.[] | select(.type == "doc")]
  | .[]
  | select(([$edges[] | select(.from == .id or .to == .id)] | length) == 0)
  | {path}
' <<<"$nodes_sorted")

if [[ "$(wc -l <"$DOCS" | tr -d ' ')" -eq 0 ]]; then
  add_finding "docs-graph.no-docs" "medium" "No markdown files found" "{}"
fi

generated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
{
  printf '%s\n' "---"
  printf '%s\n' "slug: ${REPORT_SLUG}"
  printf '%s\n' "dutySlug: ${REPORT_SLUG}"
  printf 'generatedAt: "%s"\n' "$generated_at"
  printf '%s\n' "findings:"
  jq -r '.[] | "  - id: \(.id)\n    severity: \(.severity)\n    title: \(.title | @json)\n    data: \(.data | tojson)"' "$FINDINGS"
  printf '%s\n\n' "---"
  printf '%s\n\n' "# Docs Graph"
  printf '%s\n' "| Node type | Count |"
  printf '%s\n' "|---|---:|"
  jq -r 'to_entries[] | "| \(.key) | \(.value) |"' <<<"$node_counts"
  printf '\n%s\n' "| Edge type | Count |"
  printf '%s\n' "|---|---:|"
  jq -r 'to_entries[] | "| \(.key) | \(.value) |"' <<<"$edge_counts"
  printf '\nGraph hash: `%s`\n\n' "$graph_hash"
  printf '%s\n' "## Graph"
  printf '%s\n' '```json'
  jq . <<<"$graph"
  printf '%s\n' '```'
} >"$REPORT_BODY"

finding_count="$(jq 'length' "$FINDINGS")"
if [[ "$DRY_RUN" == "1" ]]; then
  printf 'DONE\nCOMMIT_MSG: chore(reports): refresh %s\nPR_SUMMARY:\n- Dry run only; no report write attempted.\n- Findings: %s.\n' "$REPORT_SLUG" "$finding_count"
  exit 0
fi

repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
branch="$STATE_BRANCH"

read_remote_report() {
  gh api "/repos/$repo/contents/$REPORT_PATH?ref=$branch" 2>/dev/null || true
}

remote_json="$(read_remote_report)"
remote_sha=""
remote_hash=""
if [[ -n "$remote_json" ]]; then
  remote_sha="$(jq -r '.sha // ""' <<<"$remote_json")"
  remote_hash="$(
    jq -r '.content // ""' <<<"$remote_json" | tr -d '\n' | decode_base64 2>/dev/null \
      | grep -Eo 'Graph hash: `?[a-f0-9]{64}' | grep -Eo '[a-f0-9]{64}' | head -n 1 || true
  )"
fi

if [[ "$remote_hash" == "$graph_hash" ]]; then
  printf 'DONE\nCOMMIT_MSG: chore(reports): refresh %s\nPR_SUMMARY:\n- No report write needed; docs graph was unchanged.\n' "$REPORT_SLUG"
  exit 0
fi

content="$(base64 <"$REPORT_BODY" | tr -d '\n')"
args=(
  api
  -X PUT
  "/repos/$repo/contents/$REPORT_PATH"
  -f "message=chore(reports): refresh ${REPORT_SLUG}"
  -f "content=$content"
  -f "branch=$branch"
)
if [[ -n "$remote_sha" ]]; then
  args+=(-f "sha=$remote_sha")
fi

gh "${args[@]}" >/dev/null
printf 'DONE\nCOMMIT_MSG: chore(reports): refresh %s\nPR_SUMMARY:\n- Refreshed .kody/reports/%s.md.\n- Findings: %s.\n' "$REPORT_SLUG" "$REPORT_SLUG" "$finding_count"
