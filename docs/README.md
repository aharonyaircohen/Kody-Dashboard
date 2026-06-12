# Kody Dashboard — Documentation

Index of all dashboard documentation. Start here.

**Status:** ✅ written · 🚧 stub / partial · ⛔ planned (not written yet)

## Start here

- ✅ [Dashboard setup](dashboard-setup.md) — how to configure each
  dashboard-managed store (Staff, Duties, Commands, Secrets, Variables,
  Context), with an end-to-end **QA setup** walkthrough at the end.

## Concepts

How the moving parts fit together.

- ✅ [Chat backends](concepts/chat.md) — the three chat paths (`kody`
  in-process, `brain`, engine via GitHub Actions) and how the selected
  agent's `backend` field picks one.
- ✅ [Staff & Duties](concepts/staff-duties.md) — identity-only personas
  (`.kody/staff/`) vs. scheduled jobs (`.kody/duties/`); how a duty names
  `staff:` and the engine injects the persona ahead of the duty body.

## Features

One doc per dashboard-managed store / capability.

### Work surfaces

- ✅ [Tasks board](tasks.md) — the lanes, what drives a card's column
  (engine `kodyState` comment, **not** `kody:*` labels), and the
  feature/bug/chore/spec/goal lifecycle.
- ✅ [Reports](reports.md) — markdown reports from duties, including
  structured findings and optional suggested actions (`dispatch`,
  `create-task`, `dismiss`).
- ✅ [Activity & audit](activity.md) — the Log / Auto / Runs / Feed timeline;
  merges `recordAudit`, engine `.kody/activity` events, and GitHub artifacts.
- ✅ [Messages & mentions](messages-and-mentions.md) — `#`-channel team chat
  (GitHub Discussions) plus the `dispatchMentionPushes` spine that fans
  @mentions out to notifications and push.

### Authoring & config

- ✅ [Commands](commands.md) — slash commands, built-ins + repo commands.
- ✅ [Executables](executables.md) — custom `.kody/executables/<slug>/`
  implementation folders (Git Data API CRUD), set-default, and the commit-skills caveat.
- ✅ [Engine config](engine-config.md) — the `/config` page editing
  `kody.config.json` (operators, quality commands, access gate, aliases);
  why the model lives on `/models` via `agent.model`.
- ✅ [Secrets vault](secrets-vault.md) — per-repo encrypted `.kody/secrets.enc`.
- ✅ [Variables](variables.md) — non-secret per-repo config (`.kody/variables.json`),
  e.g. `QA_URL`, `LOGIN_USER`.
- ✅ [Context](context.md) — `.kody/context/*.md`, curated context fed to Kody,
  with a `staff:` audience relation. **Supersedes** the old Company Profile.
- 🗄️ [Company profile](profile.md) — _historical._ The Profile feature was
  removed; see [Context](context.md) for the current model.
- ✅ [Company export/import](company.md) — portable bundle of staff, duties,
  commands, executables, instructions, and a config slice.

### Runtime & infra

- ✅ [Runners](runners.md) — GitHub Actions (default) vs Fly Machines
  (per-repo, opt-in, auto-fallback); the `/runner` page.
- ✅ [Vibe & Voice](vibe-and-voice.md) — preview-driven element picking into
  the composer, and the browser-native voice conversation overlay.

### Notifications

- ✅ [Notifications](notifications.md) — channels + rules.
- ✅ [Push notifications](push-notifications.md) — PWA / Web Push.
- ✅ [GitHub webhooks](webhooks.md) — push-based cache invalidation + mention dispatch.

### Quality

- ✅ [QA automation](qa.md) — the `qa` persona + `qa`/`qa-sweep` duties.
- ✅ [Changelog](changelog.md) — `CHANGELOG.md` as machine-written ledger;
  the per-PR QA markers QA writes are documented here.

## Operations

- ✅ [Deploy](DEPLOY.md) — Vercel deployment.
- ✅ [Engine install](engine-install.md) — connecting the Kody engine.

---

## Known doc-vs-code flags (follow-ups)

Surfaced while writing the docs. Most are stale source comments / doc text,
not behavior bugs — but two are real seams worth a look.

### Real seams

- **Activity "Feed" tab reads the wrong branch.** `activity/feed-source.ts`
  reads `.kody/events/*.jsonl` from `KODY_STORE_BRANCH ?? "main"`, while the
  "Auto" tab reads company activity from `kody-state` (`STATE_BRANCH`). If the
  engine writes event files to `kody-state` (or the repo default isn't
  `main`), the Feed tab silently goes empty while Auto keeps working. See
  [activity.md](activity.md).
- **Version-bump hook freezes silently.** `.husky/pre-commit` →
  `bump-version.mjs` runs only on `main` and stops bumping with no error if it
  loses its execute bit (`chmod +x` to fix). See [changelog.md](changelog.md).

### Stale comments / docs (behavior is fine)

- **`prompts.md` → `commands.md`**: ✅ fixed in this index. The Prompts→Commands
  rename left the old index entry pointing at a nonexistent `prompts.md`.
- **Profile feature removed**: `app/(chat-rail)/profile/`, `app/api/kody/profile/`,
  `ProfileManager.tsx`, and `src/dashboard/lib/profile/` are gone; chat now
  calls `loadContextForPrompt()`. [profile.md](profile.md) documents a removed
  feature — see [context.md](context.md). Left in place as historical record.
- **Operators moved to `/config`**: CLAUDE.md, the `OperatorsCard.tsx` /
  `EngineConfigCards.tsx` JSDoc headers, and the operators memory still say
  "Company settings," but commit `2167c97` moved operators + all config cards
  onto `/config` (`/company` is import/export only). The `/api/kody/company/*`
  route paths are a naming carry-over, not a bug. See [engine-config.md](engine-config.md).
- **Company bundle is richer than its docstring**: `CompanyManager`'s
  `@ai-summary` still describes a legacy jobs/workers→duties/staff migration
  card that no longer renders; the bundle actually carries six collections
  including executables and a config slice. See [company.md](company.md).
- **Preview inspector ships six actions, not "picker"**: `element-picker.md`
  says "Get picker" / "four" in places; the live `PreviewInspector.tsx` renders
  "Get inspector" with six actions (pick, console, requests, screenshot, speed,
  record-a-test). See [vibe-and-voice.md](vibe-and-voice.md).
- **`autonomous` route comment stale**: its header says it lists "PRs it
  opens/merges/closes" via `fetchRecentPRs`, but it actually calls
  `fetchCompanyActivity()` over `.kody/activity/*.jsonl`. Behavior correct.

### Reconciled earlier (no behavior bug)

- **Chat default**: ✅ `KodyChat.tsx` initializes `selectedAgentId` to
  `lockedAgentId ?? "kody-live"`, so the default agent is `kody-live`.
- **Cron cadence**: ✅ the wake is `*/15`; `duty-scheduler`'s `*/5` is a _max
  eligible_ cadence. The only stale artifact is a `templates/kody.yml` comment
  (engine repo; not edited here per the no-touch-kody.yml rule). See
  [Staff & Duties → cron cadence](concepts/staff-duties.md).
