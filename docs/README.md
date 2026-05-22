# Kody Dashboard — Documentation

Index of all dashboard documentation. Start here.

**Status:** ✅ written · 🚧 stub / partial · ⛔ planned (not written yet)

## Start here

- ✅ [Dashboard setup](dashboard-setup.md) — how to configure each
  dashboard-managed store (Staff, Duties, Prompts, Secrets, Variables,
  Profile), with an end-to-end **QA setup** walkthrough at the end.

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

- ✅ [Prompts](prompts.md) — slash commands, built-ins + repo prompts.
- ✅ [Secrets vault](secrets-vault.md) — per-repo encrypted `.kody/secrets.enc`.
- ✅ [Variables](variables.md) — non-secret per-repo config (`.kody/variables.json`),
  e.g. `QA_URL`, `LOGIN_USER`.
- ✅ [Company profile](profile.md) — `.kody/profile/*.md`, chat/agent context.
- ✅ [Notifications](notifications.md) — channels + rules.
- ✅ [Push notifications](push-notifications.md) — PWA / Web Push.
- ✅ [GitHub webhooks](webhooks.md) — push-based cache invalidation + mention dispatch.
- ✅ [QA automation](qa.md) — the `qa` persona + `qa`/`qa-sweep` duties.
  Doc is written; the feature's new context model (Variables + Vault +
  Profile, replacing `.kody/qa-guide.md`) is **pending engine publish +
  per-repo migration** — see the doc.

## Operations

- ✅ [Deploy](DEPLOY.md) — Vercel deployment.
- ✅ [Engine install](engine-install.md) — connecting the Kody engine.

---

## Known doc-vs-code flags (follow-ups)

Surfaced while writing the docs — code inconsistencies, not doc errors:

- **Chat default**: `KodyChat.tsx` initializes `selectedAgentId` to
  `lockedAgentId ?? "kody-live"`, so the default agent is `kody-live`, not
  `kody`. CLAUDE.md's "Chat flow" table still says `kody` — stale, worth fixing.
- **Cron cadence**: the dashboard hard-codes a 15-min tick
  (`ticked/schedule.ts`), `templates/kody.yml` comments say "every 30
  minutes" while its cron is `*/15`, and `job-scheduler/profile.json`
  declares `*/5`. These disagree — reconcile in the engine.
