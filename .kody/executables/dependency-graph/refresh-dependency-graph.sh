#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

REPORT_SLUG="dependency-graph"
REPORT_PATH=".kody/reports/${REPORT_SLUG}.md"
STATE_BRANCH="kody-state"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

NODES="$TMP_DIR/nodes.json"
EDGES="$TMP_DIR/edges.json"
FINDINGS="$TMP_DIR/findings.json"
REPORT_BODY="$TMP_DIR/${REPORT_SLUG}.md"
DECLARATIONS="$TMP_DIR/declarations.jsonl"
PACKAGES="$TMP_DIR/packages.txt"
printf '[]\n' >"$NODES"
printf '[]\n' >"$EDGES"
printf '[]\n' >"$FINDINGS"
: >"$DECLARATIONS"
: >"$PACKAGES"

fail() {
  printf 'FAILED: %s\n' "$*"
  exit 1
}

command -v jq >/dev/null 2>&1 || fail "jq is required"
command -v gh >/dev/null 2>&1 || fail "gh is required"

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

package_id_for() {
  local file="$1"
  local dir
  dir="$(dirname "$file")"
  if [[ "$dir" == "." ]]; then
    printf 'package:root'
  else
    printf 'package:%s' "$(safe_slug "$dir")"
  fi
}

find . \
  -path './node_modules' -prune -o \
  -path './.next' -prune -o \
  -path './.git' -prune -o \
  -name package.json -type f -print \
  | sort >"$PACKAGES"

while IFS= read -r package_file; do
  rel="${package_file#./}"
  package_id="$(package_id_for "$package_file")"
  dir="$(dirname "$package_file")"
  display_dir="${dir#./}"
  if [[ "$display_dir" == "." ]]; then
    display_dir="."
  fi

  if ! jq empty "$package_file" >/dev/null 2>&1; then
    add_finding "dependency-graph.invalid-package.$(safe_slug "$rel")" "high" \
      "$rel is not valid JSON" "$(jq -nc --arg file "$rel" '{file: $file}')"
    continue
  fi

  name="$(jq -r '.name // ""' "$package_file")"
  package_manager="$(jq -r '.packageManager // ""' "$package_file")"
  add_node "$(jq -nc \
    --arg id "$package_id" \
    --arg file "$rel" \
    --arg name "$name" \
    --arg packageManager "$package_manager" \
    '{id: $id, type: "package", file: $file, name: $name, packageManager: $packageManager}')"

  lockfile=""
  for candidate in "$dir/pnpm-lock.yaml" "$dir/package-lock.json" "$dir/yarn.lock" "$dir/bun.lock" "$dir/bun.lockb"; do
    if [[ -f "$candidate" ]]; then
      lockfile="${candidate#./}"
      lock_id="lockfile:$(safe_slug "$lockfile")"
      add_node "$(jq -nc --arg id "$lock_id" --arg file "$lockfile" \
        '{id: $id, type: "lockfile", file: $file}')"
      add_edge "$package_id" "$lock_id" "locked_by"
    fi
  done

  dep_total="$(jq '[.dependencies, .devDependencies, .peerDependencies, .optionalDependencies] | map(. // {} | length) | add' "$package_file")"
  if [[ "$dep_total" -gt 0 && -z "$lockfile" ]]; then
    add_finding "dependency-graph.missing-lockfile.$(safe_slug "$rel")" "high" \
      "$rel declares dependencies without an adjacent lockfile" \
      "$(jq -nc --arg file "$rel" --arg directory "$display_dir" '{file: $file, directory: $directory}')"
  fi

  if [[ -z "$package_manager" ]]; then
    add_finding "dependency-graph.missing-package-manager.$(safe_slug "$rel")" "low" \
      "$rel does not declare packageManager" \
      "$(jq -nc --arg file "$rel" '{file: $file}')"
  fi

  for section in dependencies devDependencies peerDependencies optionalDependencies; do
    while IFS= read -r dep; do
      dep_name="$(jq -r '.key' <<<"$dep")"
      dep_version="$(jq -r '.value' <<<"$dep")"
      dep_slug="$(safe_slug "$dep_name")"
      dep_id="dependency:$dep_slug"
      relation="$section"
      add_node "$(jq -nc --arg id "$dep_id" --arg name "$dep_name" \
        '{id: $id, type: "dependency", name: $name}')"
      add_edge "$package_id" "$dep_id" "$relation"
      jq -nc \
        --arg package "$rel" \
        --arg packageId "$package_id" \
        --arg name "$dep_name" \
        --arg version "$dep_version" \
        --arg section "$section" \
        '{package: $package, packageId: $packageId, name: $name, version: $version, section: $section}' >>"$DECLARATIONS"

      case "$dep_version" in
        "*"|"latest"|file:*|link:*|git:*|git+*|github:*|http:*|https:*)
          add_finding "dependency-graph.risky-range.$(safe_slug "$rel").$dep_slug" "medium" \
            "$dep_name uses a risky dependency range" \
            "$(jq -nc --arg package "$rel" --arg name "$dep_name" --arg version "$dep_version" --arg section "$section" \
              '{package: $package, name: $name, version: $version, section: $section}')"
          ;;
      esac
    done < <(jq -c --arg section "$section" '.[$section] // {} | to_entries[]' "$package_file")
  done
done <"$PACKAGES"

declarations_json="$(jq -s '.' "$DECLARATIONS")"
node_counts="$(jq -nc --argjson nodes "$(jq -c 'sort_by(.id)' "$NODES")" '
  def count_type($t): [$nodes[] | select(.type == $t)] | length;
  {
    packages: count_type("package"),
    lockfiles: count_type("lockfile"),
    dependencies: count_type("dependency")
  }
')"
dependency_counts="$(jq -c '
  group_by(.section)
  | map({key: .[0].section, value: length})
  | from_entries
' <<<"$declarations_json")"

while IFS= read -r item; do
  dep_name="$(jq -r '.name' <<<"$item")"
  add_finding "dependency-graph.version-conflict.$(safe_slug "$dep_name")" "medium" \
    "$dep_name is declared with multiple version ranges" "$item"
done < <(jq -c '
  group_by(.name)
  | .[]
  | {name: .[0].name, versions: ([.[].version] | unique), declarations: .}
  | select((.versions | length) > 1)
' <<<"$declarations_json")

lockfile_shapes="$(find . \
  -path './node_modules' -prune -o \
  -path './.next' -prune -o \
  -path './.git' -prune -o \
  \( -name pnpm-lock.yaml -o -name package-lock.json -o -name yarn.lock -o -name bun.lock -o -name bun.lockb \) -type f -print \
  | sed 's#^\./##' \
  | awk -F/ '{print $NF}' \
  | sort -u \
  | jq -R . \
  | jq -s '.')"
if [[ "$(jq 'length' <<<"$lockfile_shapes")" -gt 1 ]]; then
  add_finding "dependency-graph.mixed-lockfiles" "medium" "Repo uses multiple lockfile types" \
    "$(jq -nc --argjson lockfileTypes "$lockfile_shapes" '{lockfileTypes: $lockfileTypes}')"
fi

nodes_sorted="$(jq -c 'sort_by(.id)' "$NODES")"
edges_sorted="$(jq -c 'sort_by(.id)' "$EDGES")"
graph="$(jq -nc --argjson nodes "$nodes_sorted" --argjson edges "$edges_sorted" \
  '{schemaVersion: 1, nodes: $nodes, edges: $edges}')"
graph_hash="$(printf '%s' "$graph" | jq -S -c . | hash_stdin)"

add_finding "dependency-graph.snapshot" "low" "Dependency graph snapshot emitted" \
  "$(jq -nc --arg graphHash "$graph_hash" --argjson nodeCounts "$node_counts" --argjson dependencyCounts "$dependency_counts" \
    '{nodeCounts: $nodeCounts, dependencyCounts: $dependencyCounts, graphHash: $graphHash}')"

if [[ "$(wc -l <"$PACKAGES" | tr -d ' ')" -eq 0 ]]; then
  add_finding "dependency-graph.no-packages" "medium" "No package.json files found" "{}"
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
  printf '%s\n\n' "# Dependency Graph"
  printf '%s\n' "| Node type | Count |"
  printf '%s\n' "|---|---:|"
  jq -r 'to_entries[] | "| \(.key) | \(.value) |"' <<<"$node_counts"
  printf '\n%s\n' "| Dependency section | Count |"
  printf '%s\n' "|---|---:|"
  jq -r 'to_entries[] | "| \(.key) | \(.value) |"' <<<"$dependency_counts"
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
  printf 'DONE\nCOMMIT_MSG: chore(reports): refresh %s\nPR_SUMMARY:\n- No report write needed; dependency graph was unchanged.\n' "$REPORT_SLUG"
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
