---
slug: memory-compaction
dutySlug: memory-compaction
generatedAt: "2026-06-11T20:13:47Z"
reviewStatus: info
reviewArea: memory
findings:
  - id: memory-compaction.snapshot
    severity: low
    title: "Memory compaction snapshot emitted"
    data: {"raw":"{\"summary\":{\"memoryFiles\":6,\"memoryBytes\":6817,\"recommendationFiles\":5,\"recommendations\":7,\"highConfidenceRecommendations\":6,\"recommendationBytes\":5779},\"snapshotHash\":\"f246950fb21a8ba38d46685bb1f066a794314af0e2b1195295a0aad699fc09b4\"}}"}
  - id: memory-compaction.recommendation-backlog
    severity: medium
    title: "High-confidence task memory recommendations exist"
    data: {"raw":"{\"highConfidenceRecommendations\":6}}"}
  - id: memory-compaction.merge-candidate.feedback
    severity: low
    title: "Multiple memory files share type feedback"
    data: {"raw":"{\"type\":\"feedback\",\"count\":5,\"slugs\":[\"briefing-is-a-priority-queue-not-info\",\"create-kody-duty-frontmatter-unreliable\",\"github_close_issue-is-issues-only-and-parallel-safe-but-risky\",\"goal-pipeline-engine-not-duty\",\"kody-dispatch-uses-bare-kody\"]}}"}
---

# Memory Compaction Proposal

| Area | Count | Bytes |
|---|---:|---:|
| Permanent memory | 6 | 6817 |
| Task recommendations | 7 | 5779 |

Snapshot hash: `f246950fb21a8ba38d46685bb1f066a794314af0e2b1195295a0aad699fc09b4`

## Recommendation

- Keep memory split by purpose.
- Do not compact all memory into one file.
- Run `task-memorize` before deleting or archiving task recommendation files.
- Apply compaction only after a human reviews this proposal.

## Current Memory Types

- feedback: 5
- project: 1

## Snapshot
```json
{
  "memories": [
    {
      "slug": "briefing-is-a-priority-queue-not-info",
      "path": ".kody/memory/briefing-is-a-priority-queue-not-info.md",
      "title": "Briefing is a priority queue, not info",
      "description": "Treat /briefing output as an ordered action list (Urgent → Needs decision → In progress → Can wait); execute the urgent items before asking the user anything else.",
      "type": "feedback",
      "created": "2026-06-11T19:57:13.139Z",
      "bytes": 1442,
      "lines": 12,
      "hash": "8a749bed73167f0fa93c5f231350e53fc48f32a67107f38c2ee34a67d5534f3f"
    },
    {
      "slug": "create-kody-duty-frontmatter-unreliable",
      "path": ".kody/memory/create-kody-duty-frontmatter-unreliable.md",
      "title": "create_kody_duty frontmatter is unreliable",
      "description": "create_kody_duty tool may not write the every/staff/disabled frontmatter from its parameters; verify with read_duty after every create, fix the file directly if missing",
      "type": "feedback",
      "created": "2026-06-11T12:38:30.835Z",
      "bytes": 1390,
      "lines": 12,
      "hash": "f37d8b09abf618fc7e1b9dd12b3f1786798c142497c32df7dd1dc3b1bfcf2a74"
    },
    {
      "slug": "github_close_issue-is-issues-only-and-parallel-safe-but-risky",
      "path": ".kody/memory/github_close_issue-is-issues-only-and-parallel-safe-but-risky.md",
      "title": "github_close_issue is issues-only and parallel-safe-but-risky",
      "description": "close_issue tool works on issues, NOT PRs; parallel close batches can silently no-op; always re-read state 5s+ later to verify",
      "type": "feedback",
      "created": "2026-06-11T19:54:32.205Z",
      "bytes": 1440,
      "lines": 16,
      "hash": "c0877c0d3a2e196769805f140d7cb58cf4768a82f18d1336a484af7ab2355085"
    },
    {
      "slug": "goal-pipeline-engine-not-duty",
      "path": ".kody/memory/goal-pipeline-engine-not-duty.md",
      "title": "Goal pipeline = engine, not duty",
      "description": "Use engine plumbing for goal lifecycle, not scheduled duties",
      "type": "feedback",
      "created": "2026-06-07T19:46:06.063Z",
      "bytes": 770,
      "lines": 12,
      "hash": "635c9e0f40b8e25b7320f7d0078e22de5864dd1580d9232ad6073cfb6ab927ca"
    },
    {
      "slug": "kody-dispatch-uses-bare-kody",
      "path": ".kody/memory/kody-dispatch-uses-bare-kody.md",
      "title": "Kody dispatch uses bare @kody",
      "description": "Use bare @kody comment to trigger pipeline, not @kody run",
      "type": "feedback",
      "created": "2026-06-01T18:09:41.386Z",
      "bytes": 668,
      "lines": 11,
      "hash": "3b047d8d2c7dadd717fd3f0e626d746db5c52cb2986241f1321f16d446cb4898"
    },
    {
      "slug": "voice-wake-lock-recurring",
      "path": ".kody/memory/voice-wake-lock-recurring.md",
      "title": "Voice wake-lock is a recurring issue",
      "description": "User has flagged \\\"voice screen dims on mobile\\\" multiple times; prior fixes haven't stuck — verify any new fix actually holds on Android Chrome before closing.",
      "type": "project",
      "created": "2026-06-08T08:55:01.222Z",
      "bytes": 1107,
      "lines": 12,
      "hash": "f5c114558c54c8f8f9b460ae1487e82c66395879792ad4d73fc2e3fa6a8cb66d"
    }
  ],
  "recommendations": [
    {
      "task": "102",
      "path": ".kody/tasks/102/memory-recs.json",
      "type": "lesson",
      "name": "engine-goal-slug-detection-is-external",
      "hook": "Goal-slug detection lives in @kody-ade/kody-engine, not dashboard repo",
      "confidence": 0.95,
      "bodyBytes": 761,
      "whyBytes": 105,
      "howToApplyBytes": 0
    },
    {
      "task": "103",
      "path": ".kody/tasks/103/memory-recs.json",
      "type": "lesson",
      "name": "prettier-check-can-block-verify",
      "hook": "Prettier --check is part of the verify gate; pre-existing format drift on the branch can fail the gate for unrelated work",
      "confidence": 0.7,
      "bodyBytes": 380,
      "whyBytes": 220,
      "howToApplyBytes": 0
    },
    {
      "task": "13",
      "path": ".kody/tasks/13/memory-recs.json",
      "type": "decision",
      "name": "mention-event-exported-from-mention-dispatch",
      "hook": "MentionEvent must be exported from mention-dispatch for use by notification-types tests",
      "confidence": 1.0,
      "bodyBytes": 509,
      "whyBytes": 85,
      "howToApplyBytes": 0
    },
    {
      "task": "13",
      "path": ".kody/tasks/13/memory-recs.json",
      "type": "lesson",
      "name": "module-level-cache-needs-test-reset",
      "hook": "Module-level Map cache must be reset between unit tests",
      "confidence": 1.0,
      "bodyBytes": 484,
      "whyBytes": 113,
      "howToApplyBytes": 0
    },
    {
      "task": "13",
      "path": ".kody/tasks/13/memory-recs.json",
      "type": "decision",
      "name": "server-notification-type-subset",
      "hook": "ServerNotificationType is only the webhook-backed subset, not all NotificationTypes",
      "confidence": 0.95,
      "bodyBytes": 724,
      "whyBytes": 91,
      "howToApplyBytes": 0
    },
    {
      "task": "66",
      "path": ".kody/tasks/66/memory-recs.json",
      "type": "decision",
      "name": "unified-chat-thread",
      "hook": "Chat thread is global; scope flows through system-prompt blocks, not parallel message stores",
      "confidence": 0.95,
      "bodyBytes": 1084,
      "whyBytes": 135,
      "howToApplyBytes": 0
    },
    {
      "task": "72",
      "path": ".kody/tasks/72/memory-recs.json",
      "type": "lesson",
      "name": "mergeStateStatus-dirty-not-ci-failure",
      "hook": "GitHub's DIRTY mergeStateStatus means merge conflicts, not CI failure — never map it to ciStatus: failure",
      "confidence": 0.9,
      "bodyBytes": 907,
      "whyBytes": 181,
      "howToApplyBytes": 0
    }
  ],
  "summary": {
    "memoryFiles": 6,
    "memoryBytes": 6817,
    "recommendationFiles": 5,
    "recommendations": 7,
    "highConfidenceRecommendations": 6,
    "recommendationBytes": 5779
  },
  "byType": {
    "feedback": 5,
    "project": 1
  },
  "proposedBuckets": [
    "feedback",
    "project",
    "architecture",
    "workflow",
    "open-questions"
  ],
  "actions": {
    "memorizeExecutable": "task-memorize"
  }
}
```
