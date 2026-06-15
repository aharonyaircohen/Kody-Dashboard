#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

REPORT_SLUG="pr-graph"
REPORT_PATH=".kody/reports/${REPORT_SLUG}.md"
STATE_BRANCH="kody-state"
STALE_DAYS=7
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

NODES="$TMP_DIR/nodes.json"
EDGES="$TMP_DIR/edges.json"
FINDINGS="$TMP_DIR/findings.json"
REPORT_BODY="$TMP_DIR/${REPORT_SLUG}.md"
PRS="$TMP_DIR/prs.json"
printf '[]\n' >"$NODES"
printf '[]\n' >"$EDGES"
printf '[]\n' >"$FINDINGS"
printf '[]\n' >"$PRS"

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

if ! gh pr list --state all --limit 100 --json number,title,state,isDraft,author,headRefName,baseRefName,createdAt,updatedAt,mergedAt,closedAt,reviewDecision,statusCheckRollup,labels,url,body >"$PRS" 2>"$TMP_DIR/prs.err"; then
  add_finding "pr-graph.scan-failed" "high" "Could not read pull requests" \
    "$(jq -nc --rawfile error "$TMP_DIR/prs.err" '{error: $error}')"
  printf '[]\n' >"$PRS"
fi

while IFS= read -r pr; do
  number="$(jq -r '.number // empty' <<<"$pr")"
  [[ -n "$number" ]] || continue
  state="$(jq -r '.state // "UNKNOWN"' <<<"$pr")"
  title="$(jq -r '.title // ""' <<<"$pr")"
  author="$(jq -r '.author.login // "unknown"' <<<"$pr")"
  head_branch="$(jq -r '.headRefName // "unknown"' <<<"$pr")"
  base_branch="$(jq -r '.baseRefName // "unknown"' <<<"$pr")"

  add_node "$(jq -nc \
    --arg id "pr:$number" \
    --arg number "$number" \
    --arg title "$title" \
    --arg state "$state" \
    --arg url "$(jq -r '.url // ""' <<<"$pr")" \
    --arg createdAt "$(jq -r '.createdAt // ""' <<<"$pr")" \
    --arg updatedAt "$(jq -r '.updatedAt // ""' <<<"$pr")" \
    --arg reviewDecision "$(jq -r '.reviewDecision // ""' <<<"$pr")" \
    --argjson isDraft "$(jq -c '.isDraft == true' <<<"$pr")" \
    '{id: $id, type: "pr", number: ($number | tonumber? // $number), title: $title, state: $state, url: $url, createdAt: $createdAt, updatedAt: $updatedAt, reviewDecision: $reviewDecision, isDraft: $isDraft}')"

  add_node "$(jq -nc --arg id "author:$author" --arg login "$author" \
    '{id: $id, type: "author", login: $login}')"
  add_node "$(jq -nc --arg id "branch:$base_branch" --arg name "$base_branch" \
    '{id: $id, type: "branch", name: $name, branchRole: "base"}')"
  add_node "$(jq -nc --arg id "branch:$head_branch" --arg name "$head_branch" \
    '{id: $id, type: "branch", name: $name, branchRole: "head"}')"
  add_edge "pr:$number" "author:$author" "authored_by"
  add_edge "pr:$number" "branch:$base_branch" "targets"
  add_edge "pr:$number" "branch:$head_branch" "uses_branch"

  while IFS= read -r label; do
    label_name="$(jq -r '.name // empty' <<<"$label")"
    [[ -n "$label_name" ]] || continue
    label_slug="$(safe_slug "$label_name")"
    add_node "$(jq -nc --arg id "label:$label_slug" --arg name "$label_name" \
      '{id: $id, type: "label", name: $name}')"
    add_edge "pr:$number" "label:$label_slug" "has_label"
  done < <(jq -c '.labels[]?' <<<"$pr")

  while IFS= read -r check; do
    check_name="$(jq -r '.name // .context // "check"' <<<"$check")"
    check_slug="$(safe_slug "$check_name")"
    check_id="check:$number/$check_slug"
    add_node "$(jq -nc \
      --arg id "$check_id" \
      --arg name "$check_name" \
      --arg workflow "$(jq -r '.workflowName // ""' <<<"$check")" \
      --arg status "$(jq -r '.status // .state // ""' <<<"$check")" \
      --arg conclusion "$(jq -r '.conclusion // ""' <<<"$check")" \
      --arg url "$(jq -r '.detailsUrl // ""' <<<"$check")" \
      '{id: $id, type: "check", name: $name, workflow: $workflow, status: $status, conclusion: $conclusion, url: $url}')"
    add_edge "pr:$number" "$check_id" "has_check"
  done < <(jq -c '.statusCheckRollup[]?' <<<"$pr")
done < <(jq -c '.[]' "$PRS")

node_counts="$(jq -nc --argjson nodes "$(jq -c 'sort_by(.id)' "$NODES")" '
  def count_type($t): [$nodes[] | select(.type == $t)] | length;
  {
    prs: count_type("pr"),
    authors: count_type("author"),
    branches: count_type("branch"),
    labels: count_type("label"),
    checks: count_type("check")
  }
')"
state_counts="$(jq -c '
  group_by(.state // "UNKNOWN")
  | map({key: (.[0].state // "UNKNOWN"), value: length})
  | from_entries
' "$PRS")"

nodes_sorted="$(jq -c 'sort_by(.id)' "$NODES")"
edges_sorted="$(jq -c 'sort_by(.id)' "$EDGES")"
graph="$(jq -nc --argjson nodes "$nodes_sorted" --argjson edges "$edges_sorted" \
  '{schemaVersion: 1, nodes: $nodes, edges: $edges}')"
graph_hash="$(printf '%s' "$graph" | jq -S -c . | hash_stdin)"

add_finding "pr-graph.snapshot" "low" "PR graph snapshot emitted" \
  "$(jq -nc --arg graphHash "$graph_hash" --argjson nodeCounts "$node_counts" --argjson stateCounts "$state_counts" \
    '{nodeCounts: $nodeCounts, stateCounts: $stateCounts, graphHash: $graphHash}')"

while IFS= read -r item; do
  number="$(jq -r '.number' <<<"$item")"
  add_finding "pr-graph.stale-open.$number" "medium" \
    "PR #$number has not changed for at least ${STALE_DAYS} days" "$item"
done < <(jq -c --argjson days "$STALE_DAYS" '
  .[]
  | select((.state // "") == "OPEN" and (.updatedAt // "") != "")
  | ((now - (.updatedAt | fromdateiso8601)) / 86400 | floor) as $daysStale
  | select($daysStale >= $days)
  | {number, title, url, updatedAt, daysStale: $daysStale, isDraft}
' "$PRS")

while IFS= read -r item; do
  number="$(jq -r '.number' <<<"$item")"
  add_finding "pr-graph.stale-draft.$number" "medium" \
    "Draft PR #$number has been quiet for at least ${STALE_DAYS} days" "$item"
done < <(jq -c --argjson days "$STALE_DAYS" '
  .[]
  | select((.state // "") == "OPEN" and (.isDraft == true) and (.updatedAt // "") != "")
  | ((now - (.updatedAt | fromdateiso8601)) / 86400 | floor) as $daysStale
  | select($daysStale >= $days)
  | {number, title, url, updatedAt, daysStale: $daysStale}
' "$PRS")

while IFS= read -r item; do
  number="$(jq -r '.number' <<<"$item")"
  add_finding "pr-graph.blocked-checks.$number" "high" \
    "PR #$number has non-green checks" "$item"
done < <(jq -c '
  .[]
  | select((.state // "") == "OPEN")
  | [.statusCheckRollup[]?
      | select(
          ((.conclusion // "") != "" and (.conclusion // "") != "SUCCESS" and (.conclusion // "") != "success" and (.conclusion // "") != "SKIPPED" and (.conclusion // "") != "NEUTRAL")
          or
          ((.status // .state // "") != "" and (.status // .state // "") != "SUCCESS" and (.status // .state // "") != "success" and (.status // .state // "") != "COMPLETED")
        )
      | {name: (.name // .context // "check"), status: (.status // .state // ""), conclusion: (.conclusion // ""), url: (.detailsUrl // "")}] as $checks
  | select(($checks | length) > 0)
  | {number, title, url, checks: $checks}
' "$PRS")

while IFS= read -r item; do
  number="$(jq -r '.number' <<<"$item")"
  add_finding "pr-graph.no-checks.$number" "medium" \
    "PR #$number has no reported checks" "$item"
done < <(jq -c '
  .[]
  | select((.state // "") == "OPEN")
  | select((.statusCheckRollup // []) | length == 0)
  | {number, title, url}
' "$PRS")

while IFS= read -r item; do
  number="$(jq -r '.number' <<<"$item")"
  add_finding "pr-graph.needs-review.$number" "medium" \
    "PR #$number still needs review" "$item"
done < <(jq -c '
  .[]
  | select((.state // "") == "OPEN" and (.isDraft != true))
  | select((.reviewDecision // "") == "" or (.reviewDecision // "") == "REVIEW_REQUIRED" or (.reviewDecision // "") == "CHANGES_REQUESTED")
  | {number, title, url, reviewDecision}
' "$PRS")

while IFS= read -r item; do
  number="$(jq -r '.number' <<<"$item")"
  add_finding "pr-graph.no-issue-link.$number" "low" \
    "PR #$number does not show clear issue linkage" "$item"
done < <(jq -c '
  .[]
  | select((.state // "") == "OPEN")
  | ((.title // "") + " " + (.body // "")) as $text
  | select(($text | test("(?i)(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#\\d+|#\\d+") | not))
  | {number, title, url}
' "$PRS")

if [[ "$(jq 'length' "$PRS")" -eq 0 ]]; then
  add_finding "pr-graph.no-prs" "medium" "No pull requests found" "{}"
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
  printf '%s\n\n' "# PR Graph"
  printf '%s\n' "| Node type | Count |"
  printf '%s\n' "|---|---:|"
  jq -r 'to_entries[] | "| \(.key) | \(.value) |"' <<<"$node_counts"
  printf '\n%s\n' "| PR state | Count |"
  printf '%s\n' "|---|---:|"
  jq -r 'to_entries[] | "| \(.key) | \(.value) |"' <<<"$state_counts"
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
  printf 'DONE\nCOMMIT_MSG: chore(reports): refresh %s\nPR_SUMMARY:\n- No report write needed; PR graph was unchanged.\n' "$REPORT_SLUG"
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
