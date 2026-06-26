# Inbox Notification Plumbing

The inbox is no longer a primary dashboard work surface and is not listed in
the main navigation. Recommendations should be reviewed through
[Reports](reports.md), where capabilities can publish findings plus optional
suggested actions.

This document remains only to describe the legacy notification plumbing that
may still exist under the hood.

## Current Role

The inbox code can still support mention-style notification delivery:

1. A GitHub comment mentions an operator.
2. The webhook path extracts the mentioned login.
3. A per-user inbox/feed entry can be written for notification purposes.
4. The operator follows the source thread or opens Reports for structured
   follow-up.

The old dashboard approval queue is no longer the recommended operator model.
Do not design new capability flows around Inbox Approve / Reject / Dismiss.

## What Replaced It

Reports now carry the reviewable output:

- Findings live in `.kody/reports/<slug>.md`.
- Optional `suggestedActions` render as buttons on the Reports page.
- `dispatch` runs a named executable against a concrete issue/PR.
- `create-task` opens the task dialog with report lineage.
- `dismiss` hides one suggested action locally.

There is no report-level trust ledger, approval streak, or hidden autonomy
gate. If a capability needs human judgement, it writes a report. If an executable is
allowed to act, it acts through its declared operation.

## Legacy Files

| File                                                                        | Legacy purpose                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------ |
| [inbox/feed.ts](../src/dashboard/lib/inbox/feed.ts)                         | Feed manifest types and serialization.                 |
| [inbox/feed-server.ts](../src/dashboard/lib/inbox/feed-server.ts)           | Server read/append path for feed entries.              |
| [inbox/useInbox.ts](../src/dashboard/lib/inbox/useInbox.ts)                 | Client bindings for inbox entries.                     |
| [inbox/useInboxWatcher.tsx](../src/dashboard/lib/inbox/useInboxWatcher.tsx) | Poller that syncs a user's feed slice.                 |
| [InboxList.tsx](../src/dashboard/lib/components/InboxList.tsx)              | Legacy inbox UI for deep links/backward compatibility. |
| [ReportsView.tsx](../src/dashboard/lib/components/ReportsView.tsx)          | Current report review and suggested-action surface.    |
