# Kody Engine — Event-Driven Hook System

## Overview

A generic, event-driven system that enables human-in-the-loop CI/CD workflows. Kody agents (GitHub Actions) emit named events at key moments; a configurable hook registry decides what happens when each event fires — labels, API calls, dashboard updates, etc.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Pipeline / Action                     │
│   emit("step.waiting")  emit("user.response")  ...      │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                      Event Engine                        │
│                                                          │
│  emit(event, payload) → Hook Registry → fires hooks     │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────┼──────────────────────────────────┐
          ▼            ▼                                   ▼
    github-action  github-label                     dashboard
    (start poll)   (update labels)                 (update UI)
```

---

## Event Types

### Core Events

| Event              | Payload                            | Fired When                      |
| ------------------ | ---------------------------------- | ------------------------------- |
| `pipeline.started` | `{ runId, pipeline }`              | Pipeline begins                 |
| `pipeline.success` | `{ runId }`                        | Pipeline completes successfully |
| `pipeline.failed`  | `{ runId, error }`                 | Pipeline fails                  |
| `action.cancelled` | `{ runId }`                        | Action cancelled by user        |
| `step.started`     | `{ runId, step }`                  | Step begins                     |
| `step.waiting`     | `{ runId, step, context }`         | **Human input needed**          |
| `step.complete`    | `{ runId, step, result }`          | Step completes                  |
| `step.failed`      | `{ runId, step, error }`           | Step fails                      |
| `user.response`    | `{ runId, actionId, instruction }` | User sends instruction          |

### PR Events

| Event               | Payload                                           | Fired When                    |
| ------------------- | ------------------------------------------------- | ----------------------------- |
| `task.pr.created`   | `{ runId, taskId, prNumber, prUrl, title, body }` | Task PR created               |
| `task.pr.merged`    | `{ runId, taskId, prNumber }`                     | Task PR merged                |
| `session.completed` | `{ runId, sessionId, tasks: TaskResult[] }`       | Session ends (all tasks done) |

---

## Hook Types (v1)

| Hook              | Description                                                         |
| ----------------- | ------------------------------------------------------------------- |
| `github-action`   | Manages action polling state (heartbeat, poll, deliver instruction) |
| `github-label`    | Adds/removes labels on the PR                                       |
| `github-pr`       | Creates a PR for a task or session summary                          |
| `github-pr-merge` | Merges a PR (auto or on approval)                                   |
| `dashboard`       | Pushes state to dashboard (chat, pipeline view)                     |
| `log`             | Logs the event (dev/debug)                                          |

---

## Hook Configuration

Environment variable:

```bash
KODY_DASHBOARD_ENDPOINTS="production:https://your-app.example.com,preview:...,development:http://localhost:3333"
```

Config file (`hooks.config.ts`):

```typescript
export const hookConfig = {
  "pipeline.started": [
    { type: "github-label", labels: ["running"] },
    { type: "dashboard", channel: "pipeline" },
  ],
  "step.started": [
    { type: "github-label", labels: ["active"], remove: ["idle"] },
  ],
  "step.waiting": [
    { type: "github-action" },
    { type: "github-label", labels: ["waiting"], remove: ["active"] },
    { type: "dashboard", channel: "chat" },
  ],
  "step.complete": [{ type: "dashboard", channel: "chat" }],
  "step.failed": [
    { type: "github-label", labels: ["failed"], remove: ["running"] },
    { type: "dashboard", channel: "chat" },
  ],
  "pipeline.success": [
    {
      type: "github-label",
      labels: ["success"],
      remove: ["running", "waiting"],
    },
    { type: "dashboard", channel: "pipeline" },
  ],
  "pipeline.failed": [
    {
      type: "github-label",
      labels: ["failed"],
      remove: ["running", "waiting"],
    },
    { type: "dashboard", channel: "chat" },
  ],
  "action.cancelled": [
    { type: "github-label", remove: ["running", "waiting"] },
    { type: "dashboard", channel: "chat" },
  ],
  "user.response": [{ type: "github-action" }],

  // PR Lifecycle
  "task.pr.created": [
    { type: "github-label", labels: ["pr-open"], remove: ["running"] },
    { type: "dashboard", channel: "chat" },
  ],
  "task.pr.merged": [
    { type: "github-label", labels: ["pr-merged"] },
    { type: "dashboard", channel: "chat" },
  ],

  // Session Summary PR
  "session.completed": [
    { type: "github-pr", branch: "session-summary-{sessionId}", create: true },
    { type: "github-label", labels: ["session-complete"] },
    { type: "dashboard", channel: "chat" },
  ],
};
```

---

## Authentication

| Connection         | Auth Method                                  |
| ------------------ | -------------------------------------------- |
| Action → Dashboard | `KODY_ACTION_SECRET` (Bearer token, env var) |
| Dashboard → GitHub | GitHub App token (existing)                  |

No per-hook webhook auth in v1 (deferred to v2).

---

## Lifecycle Management

### Ignite (Start)

- **Dashboard:** `POST /repos/{owner}/{repo}/actions/workflows/kody.yml/dispatches` via `workflow_dispatch` with `sessionId` (chat mode) or `issue_number` (agent mode)
- **Manual:** GitHub Actions UI
- **On event:** `push`, `pull_request`, etc.

### Turn Off

- **User cancels** in GitHub Actions UI → `workflow_cancel` event
- **Dashboard cancels:** `POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel`
- **Dashboard flag:** sets `cancel=true` in action state → action exits gracefully
- **Timeout:** GitHub kills action after `timeout_minutes`
- **Natural end:** `pipeline.success` / `pipeline.failed` → action exits

---

## File Structure

### Kody-ADE-Engine (event system lives here)

```
src/event-system/
  events/
    types.ts           # Event types, payloads, KodyEvent interface
    emitter.ts         # KodyEmitter class, emit() convenience function
  hooks/
    registry.ts        # HookRegistry — fires hooks per event with failure isolation
    impl/
      github-label.ts  # Add/remove labels on PR
      github-pr.ts     # Create PR (task or session summary)
      dashboard.ts     # Push state to dashboard via HTTP
      log.ts           # Log event (dev)
    types.ts           # Hook, HookConfig, HookContext types
  config/
    hooks.config.ts    # User-defined event → hook mappings
    environments.ts    # KODY_DASHBOARD_ENDPOINTS parser
  store/
    action-state.ts    # Action state (waiting, instruction queue, cancel flag)
    event-log.ts       # Event audit log
    pr-state.ts        # Task PR state (prNumber, status, mergedAt, etc.)
  index.ts             # Public API re-exports

scripts/
  kody-poll.sh         # Bash poll script (GitHub Actions)
  kody-poll.ts         # TypeScript poll script (tsx runner)
```

### Kody-Dashboard (API routes live here)

```
src/dashboard/lib/kody-store/
  action-state.ts      # Dashboard-side action state store
  event-log.ts         # Dashboard-side event log store

src/dashboard/lib/hooks/
  useKodyActionState.ts # React hook — polls action state, detects waiting

app/api/kody/action/
  heartbeat/route.ts    # Action registers/updates its state
  poll/[runId]/route.ts # Action polls for instruction
  instruction/route.ts  # Dashboard sends user instruction
  state/[runId]/route.ts # Dashboard fetches action state
  cancel/[runId]/route.ts # Dashboard cancels an action

app/api/kody/events/
  route.ts             # Receive events from engine, log to store
```

---

## Dashboard API Endpoints

### Action / Hook Endpoints

| Method | Path                              | Description                                                  |
| ------ | --------------------------------- | ------------------------------------------------------------ |
| `POST` | `/api/kody/action/heartbeat`      | Action registers/updates its state (polls this)              |
| `GET`  | `/api/kody/action/poll/:runId`    | Action polls — returns `{ instruction?, cancel?, actionId }` |
| `POST` | `/api/kody/action/instruction`    | Dashboard sends user instruction                             |
| `GET`  | `/api/kody/action/state/:runId`   | Dashboard fetches current action state                       |
| `POST` | `/api/kody/action/cancel/:runId`  | Dashboard cancels an action                                  |
| `POST` | `/api/kody/events`                | Dashboard emits an event                                     |
| `GET`  | `/api/kody/events/history/:runId` | Event log for a runId                                        |

### PR Endpoints

| Method | Path                           | Description                          |
| ------ | ------------------------------ | ------------------------------------ |
| `POST` | `/api/kody/pr/create`          | Create task PR or session summary PR |
| `POST` | `/api/kody/pr/merge/:prNumber` | Merge a PR                           |
| `GET`  | `/api/kody/pr/state/:runId`    | Get PR state for a runId             |

---

## Data Models

### ActionState (database)

```typescript
{
  runId: string;            // GitHub run ID
  actionId: string;         // Per-instance UUID (prevents duplicate instances)
  sessionId: string;       // Kody session
  status: "waiting" | "running" | "complete" | "cancelled";
  step: string;
  instructions: string[];  // Queue — FIFO
  cancel: boolean;
  cancelledBy?: string;
  lastHeartbeat: Date;
  createdAt: Date;
}
```

### EventLog (database)

```typescript
{
  id: string;
  runId: string;
  event: EventName;
  payload: object;
  hooksFired: string[];    // ["github-action", "github-label", ...]
  hookErrors: Record<string, string>;
  emittedAt: Date;
}
```

### TaskPRState (database)

```typescript
{
  runId: string;
  sessionId: string;
  taskId?: string;          // null for session summary PR
  prNumber?: number;
  prUrl?: string;
  title: string;
  body: string;
  head: string;             // branch name
  status: "pending" | "open" | "merged" | "closed";
  mergedAt?: Date;
  createdAt: Date;
}
```

---

## Action Poll Loop

```bash
# 1. Register with heartbeat
curl -X POST $DASHBOARD_URL/api/kody/action/heartbeat \
  -H "Authorization: Bearer $KODY_ACTION_SECRET" \
  -d '{"runId":"$GITHUB_RUN_ID","actionId":"$ACTION_ID","step":"lint","status":"waiting"}'

# 2. Poll loop
while true; do
  RESPONSE=$(curl -s -H "Authorization: Bearer $KODY_ACTION_SECRET" \
    $DASHBOARD_URL/api/kody/action/poll/$GITHUB_RUN_ID)

  INSTRUCTION=$(echo $RESPONSE | jq -r '.instruction // empty')
  CANCEL=$(echo $RESPONSE | jq -r '.cancel // false')
  ACTION_ID=$(echo $RESPONSE | jq -r '.actionId // empty')

  # Check if another instance owns this poll
  if [ "$ACTION_ID" != "$ACTION_ID_SELF" ]; then
    echo "Another instance took over — exiting"
    exit 0
  fi

  [ "$CANCEL" = "true" ] && echo "Cancelled — exiting" && exit 0
  [ -n "$INSTRUCTION" ] && echo "$INSTRUCTION" && break

  # Heartbeat
  curl -s -X POST $DASHBOARD_URL/api/kody/action/heartbeat \
    -H "Authorization: Bearer $KODY_ACTION_SECRET" \
    -d '{"runId":"$GITHUB_RUN_ID","actionId":"$ACTION_ID","status":"waiting"}' > /dev/null

  sleep 10
done
```

---

## Chat UI Integration

- Chat detects `status === "waiting"` for the active session
- Shows input field: "Kody is waiting for your instructions..."
- User types → `POST /api/kody/action/instruction` → queued
- Hook registry fires `user.response` → `github-action` hook
- Action receives instruction on next poll → continues

---

## v1 Scope

**In scope:**

- Event engine + emitter
- Hook registry with per-hook failure isolation
- Built-in hooks: github-action, github-label, dashboard, log
- Instruction queue per runId
- Per-instance actionId + heartbeat timeout (prevents orphan/duplicate instances)
- Event store / audit log
- Hooks config + KODY_DASHBOARD_ENDPOINTS parser
- Dashboard API endpoints
- GitHub Action polling script
- Chat UI integration
- **Task PRs** — `github-pr` hook creates a PR per task
- **Session summary PR** — `github-pr` hook creates a final summary PR on `session.completed`
- **PR state tracking** — `TaskPRState` model stores prNumber, status, mergedAt
- **PR merge hook** — `github-pr-merge` hook to merge PRs (manual or auto)

**Out of scope (v2):**

- Custom/webhook hook with per-hook auth (HMAC, Bearer, API key)
- SSRF protection for custom webhooks
- Max-wait escalation (notify after X minutes)
- Per-repo / per-user concurrency limits
- Multiple simultaneous sessions per runId
- Auto-merge rules (configurable merge strategy, squash vs merge commit)

---

## Security Considerations

- `KODY_ACTION_SECRET` must be long and random — used as Bearer token for Action → Dashboard auth
- `KODY_DASHBOARD_ENDPOINTS` contains URLs — no validation needed (user-controlled, not user-input)
- Action state mutations require matching `actionId` (prevents rogue instances)
- Heartbeat timeout: if action doesn't ping within 60s, its pending instructions are invalidated
