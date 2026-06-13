---
name: dev-ci-health
description: Watch the `dev` branch CI and open or reuse one tracking issue when the branch is red.
---

# Dev CI Health Skill

Use this skill when the `dev-ci-health` executable runs from the matching duty.

Runtime state is owned by the engine. Do not ask the duty author to configure raw state keys.

## Method

Watch the `dev` branch's own CI. If a check on `dev`'s tip is failing **and no
fix is already in flight**, open the single tracking issue and dispatch
`@kody run` to fix it (the fix lands as a PR into `dev`).

Why: `fix-ci` / `sync` / `resolve` all need a `--pr`, but `dev` has no PR — so a
broken `dev` build is invisible to `pr-health-triage`. This routes the repair
through a fix PR. Duplicates are impossible here: `ensure_issue` is keyed and
idempotent, so a re-tick reuses the one open issue instead of creating another.

## Tick

1. **Read dev's CI:** `read_check_runs({ ref: "dev" })`.
   - `state` is `"GREEN"` or `"PENDING"` -> nothing to do. `submit_state` and stop.
   - `state` is `"RED"` -> keep `sha` and `failing` (each has `name` + `detailsUrl`), continue.

2. **Ensure the one tracking issue (this IS the dedup):**
   `ensure_issue({ key: "dev-ci-red", title: "dev CI is red — Kody auto-fix", body: <below> })`
   - If it returns `created: false`, a fix is already in flight -> `submit_state`
     and stop. Do **not** dispatch again.
   - If `created: true`, keep the returned `number` and continue.

   Issue body:

   ```
   {{mentions}} 🔴 `dev` branch CI is failing.

   - Commit: `<sha>`
   - Failing checks: <each failing name + its detailsUrl>

   Task: diagnose the failing check(s) and open a PR into `dev` that makes them
   green. Keep it minimal; if a failure is flaky / scanner-config rather than a
   code defect, make the smallest change that helps — or none, and say so.
   ```

3. **Dispatch the fix:** `dispatch_workflow({ executable: "run", issueNumber: <number> })`.

4. **Notify once:** `ensure_comment({ issue: <number>, key: "dev-ci-red:dispatched", body: "🧭 CTO auto-ran — dispatched @kody run (failing: <names>). The fix lands as a PR into dev; its own CI must pass before merge." })`.

5. **`submit_state`** with `{ cursor: "idle", data: {}, done: false }`.

The reused issue (`key: "dev-ci-red"`) is the entire dedup — while it is open,
`ensure_issue` returns `created: false` and the duty stops. The fix PR closes it
on merge; only then does a later tick open a fresh one.
