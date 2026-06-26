# Workflows

Workflows are named queues of capabilities.

They let the dashboard describe a simple orchestration without creating a new
capability. A workflow owns the ordered capability list and the shared
instructions for that run.

## What a workflow owns

A workflow owns:

- Name.
- Instructions sent with the workflow.
- Ordered capability queue.

A workflow does not own:

- Agent identity. Capabilities decide which agent runs.
- Schedule. Goals or loops decide when work wakes.
- Implementation details. Capability implementations own those.
- Runtime progress. State, logs, reports, or goals own what happened.

## Local workflows

Local workflow definitions live in the configured Kody state repo:

```text
workflows/<slug>/workflow.json
```

The dashboard `/workflows` page can create, edit, reorder capabilities, and
delete these local definitions.

Example:

```json
{
  "version": 1,
  "name": "Release readiness",
  "instructions": "Prepare the repo for release and report blockers.",
  "capabilities": ["review", "test", "release-check"],
  "createdAt": "2026-06-26T00:00:00.000Z",
  "updatedAt": "2026-06-26T00:00:00.000Z"
}
```

## Store workflows

Store workflow definitions live in the company Store repo:

```text
.kody/workflows/<slug>/workflow.json
```

The dashboard shows Store workflows on `/workflows` only when this repo links
them in `kody.config.json`:

```json
{
  "company": {
    "activeWorkflows": ["release-readiness"]
  }
}
```

Store workflows are read-only in the repo. The page shows their Store link and
allows removal, but removal only clears the local `company.activeWorkflows`
reference. It does not delete the Store asset.

## Import from Store

Use `/store-catalog` to add a Store workflow.

Importing a workflow:

- Adds the workflow slug to `company.activeWorkflows`.
- Adds any Store capabilities used by the workflow to `company.activeCapabilities`.
- Adds each capability agent to `company.activeAgents` when required.
- Does not copy the workflow JSON into the local state repo.

If a local workflow has the same slug, the local workflow wins and the Store
workflow is hidden for that slug.

## Current scope

The workflow page manages definitions. It does not dispatch a workflow by
itself yet. Runtime execution still comes from the capability, goal, loop, or
chat path that chooses to use the workflow.

## Files

| File                                                                                                           | Purpose                                                  |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`../src/dashboard/lib/workflow-definitions.ts`](../src/dashboard/lib/workflow-definitions.ts)                 | Workflow model, validation, and normalization            |
| [`../src/dashboard/lib/workflow-definition-files.ts`](../src/dashboard/lib/workflow-definition-files.ts)       | Local and Store workflow readers/writers                 |
| [`../app/api/kody/company/workflows/route.ts`](../app/api/kody/company/workflows/route.ts)                     | List and create workflow definitions                     |
| [`../app/api/kody/company/workflows/[id]/route.ts`](../app/api/kody/company/workflows/[id]/route.ts)           | Read, update, delete local workflows; remove Store links |
| [`../src/dashboard/lib/components/WorkflowsManager.tsx`](../src/dashboard/lib/components/WorkflowsManager.tsx) | `/workflows` UI                                          |
| [`../app/api/kody/store-catalog/import/route.ts`](../app/api/kody/store-catalog/import/route.ts)               | Store workflow link activation                           |
