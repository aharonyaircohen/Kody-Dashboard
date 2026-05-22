# Kody Dashboard — Documentation

Index of all dashboard documentation. Start here.

**Status:** ✅ written · 🚧 stub / partial · ⛔ planned (not written yet)

## Start here

- ⛔ [Dashboard setup](dashboard-setup.md) — how to configure each
  dashboard-managed store (Staff, Duties, Prompts, Secrets, Variables,
  Profile), with an end-to-end **QA setup** walkthrough at the end.

## Concepts

How the moving parts fit together.

- ⛔ [Chat backends](concepts/chat.md) — the three chat paths (`kody`
  in-process, `brain`, engine via GitHub Actions) and how `selectedAgentId`
  picks one.
- ⛔ [Staff & Duties](concepts/staff-duties.md) — identity-only personas
  (`.kody/staff/`) vs. scheduled jobs (`.kody/duties/`); how a duty names
  `staff:` and the engine injects the persona ahead of the duty body.

## Features

One doc per dashboard-managed store / capability.

- ✅ [Prompts](prompts.md) — slash commands, built-ins + repo prompts.
- ✅ [Secrets vault](secrets-vault.md) — per-repo encrypted `.kody/secrets.enc`.
- ⛔ [Variables](variables.md) — non-secret per-repo config (`.kody/variables.json`),
  e.g. `QA_URL`, `LOGIN_USER`.
- ⛔ [Company profile](profile.md) — `.kody/profile/*.md`, chat/agent context.
- ✅ [Notifications](notifications.md) — channels + rules.
- ✅ [Push notifications](push-notifications.md) — PWA / Web Push.
- ⛔ [GitHub webhooks](webhooks.md) — push-based cache invalidation + mention dispatch.
- ⛔ [QA automation](qa.md) — the `qa` persona + `qa`/`qa-sweep` duties.
  **Write last** — depends on the engine change that sources QA config from
  Variables + Vault + Profile (replacing `.kody/qa-guide.md`).

## Operations

- ✅ [Deploy](DEPLOY.md) — Vercel deployment.
- ✅ [Engine install](engine-install.md) — connecting the Kody engine.

---

## Backlog (order of work)

1. This index ✅
2. Feature gaps: [Variables](variables.md), [Company profile](profile.md),
   [Staff & Duties](concepts/staff-duties.md), [Webhooks](webhooks.md),
   [Chat backends](concepts/chat.md)
3. [Dashboard setup](dashboard-setup.md) — ties the stores together
4. [QA automation](qa.md) — after the engine change lands
