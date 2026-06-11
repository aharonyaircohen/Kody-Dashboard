---
name: security-audit
description: Coordinate a security posture sweep covering dependencies, application code, and supply chain risks.
---

# Security Audit Skill

Use this skill when the `security-audit` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

## Job

Daily **security posture sweep** — three layers, delegated to a Kody executable in CI (the job itself cannot run shell beyond `gh`, so it opens a tracking issue and tracks the result):

1. **Dependency CVEs** — `pnpm audit` on production deps.
2. **Code (OWASP Top 10 + STRIDE)** — review the codebase against the OWASP Top 10 and a STRIDE pass on auth/handlers/queries/external calls; every reported finding must carry a concrete exploit path.
3. **Supply chain** — flag newly-added or version-jumped dependencies and any install/postinstall scripts.

**Per tick (one action max):**

1. Check whether an open tracking issue exists:
   `gh issue list --label "kody:security-audit" --state open --json number,title,createdAt,body`
2. If an open issue exists AND was created in the last 36 hours, emit state with `cursor: awaiting-result` and exit (the audit is in flight; don't double-trigger).
3. If an open issue exists older than 36 hours with no `/kody` activity, post a single nudge comment:
   ```
   gh issue comment <n> --body "Audit appears stalled. /kody chore: re-run the posture sweep (deps + OWASP/STRIDE + supply chain) and open fix PRs for HIGH/CRITICAL findings."
   ```
   Then exit.
4. Otherwise (no open issue), open one:
   ```
   gh issue create \
     --title "security: posture sweep $(date -u +%Y-%m-%d)" \
     --label "kody:security-audit" \
     --body "/kody chore: run a three-layer security posture sweep and open fix PRs for HIGH/CRITICAL findings.
     (1) Dependencies: \`pnpm audit --prod --json\` — for each HIGH/CRITICAL, open a separate fix PR bumping the offending package (or its closest fixable parent).
     (2) Code: audit the codebase against the OWASP Top 10 and run a STRIDE pass over auth checks, request handlers, queries, parsers, and external calls; report each finding with a concrete step-by-step exploit path, and open a fix PR for any HIGH/CRITICAL.
     (3) Supply chain: flag newly-added or version-jumped dependencies and any install/postinstall scripts.
     Group LOW/MEDIUM into a single tracking comment on this issue. Close this issue when all HIGH/CRITICAL fixes are merged."
   ```
   Stash `data.openIssue = <number>`.

## Allowed Commands

- `gh issue list`, `gh issue create`, `gh issue comment`, `gh issue view`

## Restrictions

- Never edit files. Never push. Never run `pnpm` directly — delegation via `/kody chore` only.
- Maximum **one** issue created or commented per tick.
- If `gh issue create --label kody:security-audit` fails because the label doesn't exist, run `gh label create kody:security-audit --description "Kody job: security audit"` and retry the create. **Do not skip the label** — the next-tick "is audit in flight?" check depends on it.
- Never close an issue from this job — let the fix PRs auto-close via `Closes #N`.
