#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

REPORT_SLUG="ci-health-graph"
REPORT_PATH=".kody/reports/${REPORT_SLUG}.md"
STATE_BRANCH="kody-state"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

NODES="$TMP_DIR/nodes.json"
EDGES="$TMP_DIR/edges.json"
FINDINGS="$TMP_DIR/findings.json"
REPORT_BODY="$TMP_DIR/${REPORT_SLUG}.md"
RUNS="$TMP_DIR/runs.json"
PRS="$TMP_DIR/prs.json"
printf '[]\n' >"$NODES"
printf '[]\n' >"$EDGES"
printf '[]\n' >"$FINDINGS"
printf '[]\n' >"$RUNS"
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

if ! gh run list --limit 100 --json databaseId,workflowName,name,displayTitle,headBranch,event,status,conclusion,createdAt,updatedAt,url >"$RUNS" 2>"$TMP_DIR/runs.err"; then
  add_finding "ci-health-graph.run-scan-failed" "high" "Could not read workflow runs" \
    "$(jq -nc --rawfile error "$TMP_DIR/runs.err" '{error: $error}')"
  printf '[]\n' >"$RUNS"
fi

if ! gh pr list --state open --limit 100 --json number,title,headRefName,isDraft,updatedAt,url,statusCheckRollup >"$PRS" 2>"$TMP_DIR/prs.err"; then
  add_finding "ci-health-graph.pr-scan-failed" "medium" "Could not read open PR checks" \
    "$(jq -nc --rawfile error "$TMP_DIR/prs.err" '{error: $error}')"
  printf '[]\n' >"$PRS"
fi

while IFS= read -r run; do
  workflow="$(jq -r '.workflowName // .name // "unknown"' <<<"$run")"
  workflow_slug="$(safe_slug "$workflow")"
  run_id="$(jq -r '.databaseId // empty' <<<"$run")"
  branch="$(jq -r '.headBranch // "unknown"' <<<"$run")"
  [[ -n "$run_id" ]] || continue
  add_node "$(jq -nc --arg id "workflow:$workflow_slug" --arg name "$workflow" \
    '{id: $id, type: "workflow", name: $name}')"
	  add_node "$(jq -nc \
	    --arg id "run:$run_id" \
	    --arg databaseId "$run_id" \
	    --arg workflow "$workflow" \
	    --arg status "$(jq -r '.status // ""' <<<"$run")" \
	    --arg conclusion "$(jq -r '.conclusion // ""' <<<"$run")" \
	    --arg title "$(jq -r '.displayTitle // ""' <<<"$run")" \
	    --arg url "$(jq -r '.url // ""' <<<"$run")" \
	    --arg createdAt "$(jq -r '.createdAt // ""' <<<"$run")" \
	    '{id: $id, type: "run", databaseId: ($databaseId | tonumber? // $databaseId), workflow: $workflow, status: $status, conclusion: $conclusion, title: $title, url: $url, createdAt: $createdAt}')"
  add_node "$(jq -nc --arg id "branch:$branch" --arg name "$branch" \
    '{id: $id, type: "branch", name: $name}')"
  add_edge "workflow:$workflow_slug" "run:$run_id" "has_run"
  add_edge "run:$run_id" "branch:$branch" "ran_on"
done < <(jq -c '.[]' "$RUNS")

while IFS= read -r pr; do
  number="$(jq -r '.number' <<<"$pr")"
  branch="$(jq -r '.headRefName // "unknown"' <<<"$pr")"
	  add_node "$(jq -nc \
	    --arg id "pr:$number" \
	    --arg number "$number" \
	    --arg title "$(jq -r '.title // ""' <<<"$pr")" \
	    --arg url "$(jq -r '.url // ""' <<<"$pr")" \
	    --arg updatedAt "$(jq -r '.updatedAt // ""' <<<"$pr")" \
	    --argjson isDraft "$(jq -c '.isDraft == true' <<<"$pr")" \
	    '{id: $id, type: "pr", number: ($number | tonumber? // $number), title: $title, url: $url, updatedAt: $updatedAt, isDraft: $isDraft}')"
  add_node "$(jq -nc --arg id "branch:$branch" --arg name "$branch" \
    '{id: $id, type: "branch", name: $name}')"
  add_edge "pr:$number" "branch:$branch" "uses_branch"
  while IFS= read -r check; do
    check_name="$(jq -r '.name // .context // "check"' <<<"$check")"
    check_slug="$(safe_slug "$check_name")"
    check_id="check:$number/$check_slug"
	    add_node "$(jq -nc \
	      --arg id "$check_id" \
	      --arg name "$check_name" \
	      --arg status "$(jq -r '.status // .state // ""' <<<"$check")" \
	      --arg conclusion "$(jq -r '.conclusion // ""' <<<"$check")" \
	      '{id: $id, type: "check", name: $name, status: $status, conclusion: $conclusion}')"
    add_edge "pr:$number" "$check_id" "has_check"
  done < <(jq -c '.statusCheckRollup[]?' <<<"$pr")
done < <(jq -c '.[]' "$PRS")

node_counts="$(jq -nc --argjson nodes "$(jq -c 'sort_by(.id)' "$NODES")" '
  def count_type($t): [$nodes[] | select(.type == $t)] | length;
  {
    workflows: count_type("workflow"),
    runs: count_type("run"),
    branches: count_type("branch"),
    prs: count_type("pr"),
    checks: count_type("check")
  }
')"

nodes_sorted="$(jq -c 'sort_by(.id)' "$NODES")"
edges_sorted="$(jq -c 'sort_by(.id)' "$EDGES")"
graph="$(jq -nc --argjson nodes "$nodes_sorted" --argjson edges "$edges_sorted" \
  '{schemaVersion: 1, nodes: $nodes, edges: $edges}')"
graph_hash="$(printf '%s' "$graph" | jq -S -c . | hash_stdin)"

add_finding "ci-health-graph.snapshot" "low" "CI health snapshot emitted" \
  "$(jq -nc --arg graphHash "$graph_hash" --argjson nodeCounts "$node_counts" \
    '{nodeCounts: $nodeCounts, graphHash: $graphHash}')"

while IFS= read -r item; do
  workflow="$(jq -r '.workflow' <<<"$item")"
  conclusion="$(jq -r '.conclusion' <<<"$item")"
  add_finding "ci-health-graph.latest-failing.$(safe_slug "$workflow")" "high" \
    "$workflow latest completed run is $conclusion" "$item"
done < <(jq -c '
  group_by(.workflowName // .name // "unknown")
  | .[]
  | sort_by(.createdAt) | reverse
  | map(select((.status // "") == "completed")) | .[0]?
  | select(.conclusion != null and .conclusion != "" and .conclusion != "success" and .conclusion != "skipped")
  | {workflow: (.workflowName // .name // "unknown"), conclusion, url, createdAt}
' "$RUNS")

while IFS= read -r item; do
  workflow="$(jq -r '.workflow' <<<"$item")"
  add_finding "ci-health-graph.flaky.$(safe_slug "$workflow")" "medium" \
    "$workflow has mixed recent results" "$item"
done < <(jq -c '
  group_by(.workflowName // .name // "unknown")
  | .[]
  | {
      workflow: (.[0].workflowName // .[0].name // "unknown"),
      conclusions: ([.[].conclusion // empty] | unique)
    }
  | select((.conclusions | index("success")) and (.conclusions | map(select(. != "success" and . != "skipped")) | length > 0))
' "$RUNS")

while IFS= read -r pr; do
  bad_checks="$(jq -c '
    [.statusCheckRollup[]?
      | select(
	          ((.conclusion // "") != "" and (.conclusion // "") != "SUCCESS" and (.conclusion // "") != "success" and (.conclusion // "") != "SKIPPED")
	          or
	          ((.status // .state // "") != "" and (.status // .state // "") != "SUCCESS" and (.status // .state // "") != "success" and (.status // .state // "") != "COMPLETED")
	        )
	      | {name: (.name // .context // "check"), status: (.status // .state // ""), conclusion: (.conclusion // "")}]
	  ' <<<"$pr")"
  if [[ "$(jq 'length' <<<"$bad_checks")" -gt 0 ]]; then
    number="$(jq -r '.number' <<<"$pr")"
    add_finding "ci-health-graph.pr-blocked.$number" "high" \
	      "PR #$number has non-green checks" \
	      "$(jq -nc --arg number "$number" --arg title "$(jq -r '.title // ""' <<<"$pr")" --arg url "$(jq -r '.url // ""' <<<"$pr")" --argjson checks "$bad_checks" '{number: ($number | tonumber? // $number), title: $title, url: $url, checks: $checks}')"
  fi
done < <(jq -c '.[]' "$PRS")

if [[ "$(jq 'length' "$RUNS")" -eq 0 ]]; then
  add_finding "ci-health-graph.no-runs" "medium" "No workflow runs found" "{}"
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
  printf '%s\n\n' "# CI Health Graph"
  printf '%s\n' "| Node type | Count |"
  printf '%s\n' "|---|---:|"
  jq -r 'to_entries[] | "| \(.key) | \(.value) |"' <<<"$node_counts"
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
  printf 'DONE\nCOMMIT_MSG: chore(reports): refresh %s\nPR_SUMMARY:\n- No report write needed; CI health graph was unchanged.\n' "$REPORT_SLUG"
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
