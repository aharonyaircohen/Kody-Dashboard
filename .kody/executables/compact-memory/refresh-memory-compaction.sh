#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

REPORT_SLUG="memory-compaction"
REPORT_PATH=".kody/reports/${REPORT_SLUG}.md"
STATE_BRANCH="kody-state"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

MEMORIES_JSONL="$TMP_DIR/memories.jsonl"
RECS_JSONL="$TMP_DIR/recs.jsonl"
FINDINGS="$TMP_DIR/findings.json"
REPORT_BODY="$TMP_DIR/${REPORT_SLUG}.md"
: >"$MEMORIES_JSONL"
: >"$RECS_JSONL"
printf '[]\n' >"$FINDINGS"

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

safe_slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+|-+$//g'
}

fm_value() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    NR == 1 && $0 == "---" { front = 1; next }
    front && $0 == "---" { exit }
    front {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ "^" key ":[[:space:]]*") {
        sub("^[^:]+:[[:space:]]*", "", line)
        gsub(/^[ \"'\'']+|[ \"'\'']+$/, "", line)
        print line
        exit
      }
    }
  ' "$file"
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

title_from_body() {
  local file="$1"
  grep -m 1 -E '^# [^#]' "$file" | sed -E 's/^# //' || true
}

if [[ -d ".kody/memory" ]]; then
  while IFS= read -r file; do
    slug="$(basename "$file" .md)"
    [[ "$slug" == "INDEX" ]] && continue
    title="$(fm_value "$file" "name")"
    [[ -n "$title" ]] || title="$(title_from_body "$file")"
    [[ -n "$title" ]] || title="$slug"
    description="$(fm_value "$file" "description")"
    type="$(fm_value "$file" "type")"
    created="$(fm_value "$file" "created")"
    bytes="$(wc -c <"$file" | tr -d ' ')"
    lines="$(wc -l <"$file" | tr -d ' ')"
    file_hash="$(shasum -a 256 "$file" | awk '{print $1}')"
    jq -nc \
      --arg slug "$slug" \
      --arg path "$file" \
      --arg title "$title" \
      --arg description "$description" \
      --arg type "${type:-unknown}" \
      --arg created "$created" \
      --arg bytes "$bytes" \
      --arg lines "$lines" \
      --arg hash "$file_hash" \
      '{slug: $slug, path: $path, title: $title, description: $description, type: $type, created: $created, bytes: ($bytes | tonumber), lines: ($lines | tonumber), hash: $hash}' >>"$MEMORIES_JSONL"
  done < <(find .kody/memory -maxdepth 1 -type f -name '*.md' | sort)
fi

if [[ -d ".kody/tasks" ]]; then
  while IFS= read -r file; do
    task_id="$(basename "$(dirname "$file")")"
    if jq -e 'type == "array"' "$file" >/dev/null 2>&1; then
      jq -c --arg task "$task_id" --arg path "$file" '
        .[]
        | {
            task: $task,
            path: $path,
            type: (.type // "unknown"),
            name: (.name // ""),
            hook: (.hook // .title // ""),
            confidence: (.confidence // 0),
            bodyBytes: ((.body // "") | length),
            whyBytes: ((.why // "") | length),
            howToApplyBytes: ((.how_to_apply // "") | length)
          }
      ' "$file" >>"$RECS_JSONL"
    fi
  done < <(find .kody/tasks -path '*/memory-recs.json' -type f | sort)
fi

memories="$(jq -s 'sort_by(.slug)' "$MEMORIES_JSONL")"
recommendations="$(jq -s 'sort_by(.task, .name)' "$RECS_JSONL")"

snapshot="$(jq -nc --argjson memories "$memories" --argjson recommendations "$recommendations" '
  def sum($field): map(.[$field] // 0) | add // 0;
  {
    memories: $memories,
    recommendations: $recommendations,
    summary: {
      memoryFiles: ($memories | length),
      memoryBytes: ($memories | sum("bytes")),
      recommendationFiles: ($recommendations | map(.path) | unique | length),
      recommendations: ($recommendations | length),
      highConfidenceRecommendations: ($recommendations | map(select((.confidence // 0) >= 0.8)) | length),
      recommendationBytes: ($recommendations | map((.bodyBytes // 0) + (.whyBytes // 0) + (.howToApplyBytes // 0)) | add // 0)
    },
    byType: ($memories | group_by(.type) | map({key: .[0].type, value: length}) | from_entries),
    proposedBuckets: [
      "feedback",
      "project",
      "architecture",
      "workflow",
      "open-questions"
    ],
    actions: {
      memorizeExecutable: "task-memorize"
    }
  }
')"
snapshot_hash="$(printf '%s' "$snapshot" | jq -S -c . | hash_stdin)"

memory_count="$(jq '.summary.memoryFiles' <<<"$snapshot")"
memory_bytes="$(jq '.summary.memoryBytes' <<<"$snapshot")"
rec_count="$(jq '.summary.recommendations' <<<"$snapshot")"
high_rec_count="$(jq '.summary.highConfidenceRecommendations' <<<"$snapshot")"

add_finding "memory-compaction.snapshot" "low" "Memory compaction snapshot emitted" \
  "$(jq -nc --arg graphHash "$snapshot_hash" --argjson summary "$(jq -c '.summary' <<<"$snapshot")" '{summary: $summary, snapshotHash: $graphHash}')"

if [[ "$memory_count" -eq 0 ]]; then
  add_finding "memory-compaction.no-memory" "medium" "No permanent memory files found" "{}"
fi

if [[ "$high_rec_count" -gt 0 ]]; then
  add_finding "memory-compaction.recommendation-backlog" "medium" \
    "High-confidence task memory recommendations exist" \
    "$(jq -nc --arg count "$high_rec_count" '{highConfidenceRecommendations: ($count | tonumber)}')"
fi

while IFS= read -r item; do
  slug="$(jq -r '.slug' <<<"$item")"
  add_finding "memory-compaction.large-memory.$(safe_slug "$slug")" "medium" \
    "$slug is a large memory file" "$item"
done < <(jq -c '.memories[] | select(.bytes >= 4000)' <<<"$snapshot")

while IFS= read -r item; do
  type="$(jq -r '.type' <<<"$item")"
  add_finding "memory-compaction.merge-candidate.$(safe_slug "$type")" "low" \
    "Multiple memory files share type $type" "$item"
done < <(jq -c '
  .memories
  | group_by(.type)
  | .[]
  | select(length >= 3)
  | {type: .[0].type, count: length, slugs: map(.slug)}
' <<<"$snapshot")

generated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
{
  printf '%s\n' "---"
  printf '%s\n' "slug: ${REPORT_SLUG}"
  printf '%s\n' "dutySlug: ${REPORT_SLUG}"
  printf 'generatedAt: "%s"\n' "$generated_at"
  printf '%s\n' "reviewStatus: info"
  printf '%s\n' "reviewArea: memory"
  printf '%s\n' "findings:"
  jq -r '.[] | "  - id: \(.id)\n    severity: \(.severity)\n    title: \(.title | @json)\n    data: \(.data | tojson)"' "$FINDINGS"
  printf '%s\n\n' "---"
  printf '%s\n\n' "# Memory Compaction Proposal"
  printf '%s\n' "| Area | Count | Bytes |"
  printf '%s\n' "|---|---:|---:|"
  printf '| Permanent memory | %s | %s |\n' "$memory_count" "$memory_bytes"
  printf '| Task recommendations | %s | %s |\n\n' "$rec_count" "$(jq '.summary.recommendationBytes' <<<"$snapshot")"
  printf 'Snapshot hash: `%s`\n\n' "$snapshot_hash"
  printf '%s\n\n' "## Recommendation"
  printf '%s\n' "- Keep memory split by purpose."
  printf '%s\n' "- Do not compact all memory into one file."
  printf '%s\n' '- Run `task-memorize` before deleting or archiving task recommendation files.'
  printf '%s\n' "- Apply compaction only after a human reviews this proposal."
  printf '\n%s\n\n' "## Current Memory Types"
  jq -r '.byType | to_entries[] | "- \(.key): \(.value)"' <<<"$snapshot"
  printf '\n%s\n' "## Snapshot"
  printf '%s\n' '```json'
  jq . <<<"$snapshot"
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
      | grep -Eo 'Snapshot hash: `?[a-f0-9]{64}' | grep -Eo '[a-f0-9]{64}' | head -n 1 || true
  )"
fi

if [[ "$remote_hash" == "$snapshot_hash" ]]; then
  printf 'DONE\nCOMMIT_MSG: chore(reports): refresh %s\nPR_SUMMARY:\n- No report write needed; memory compaction proposal was unchanged.\n' "$REPORT_SLUG"
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
