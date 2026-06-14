# Why Kody

**Kody is the git-native, single-repo, lightweight take on autonomous AI engineering.**

A scheduled coding-agent fleet on top of GitHub.

Kody is the difference between AI as a coding assistant you babysit (Cursor, Copilot, Devin) and AI as an autonomous engineering teammate that runs on your infrastructure, on a schedule, in parallel, with results you review rather than guide.

**An open, self-hosted autonomous engineering platform — engine plus visual control plane.**

Kody is two pieces designed to work together:

- **[Kody Engine](https://github.com/aharonyaircohen/Kody-Engine)** — the autonomous-agent runtime. A `kody` CLI built on the Claude Agent SDK, packaged as a GitHub Actions workflow that runs in your own repo. Implements features end-to-end, fixes CI, reviews PRs, browses preview deployments, runs scheduled jobs, manages goals as issues. **This is the actual product.**
- **Kody Dashboard** (this repo) — the visual control plane for the engine. A Next.js app that lets you launch tasks, monitor parallel runs, schedule jobs, review reports, manage secrets, and chat with Kody. **Optional but essential at scale.** The engine works without it (via `@kody` comments and scheduled workflows); the dashboard turns it from a CLI into a platform.

---

## The problem

Every other AI coding tool on the market is **interactive and single-threaded**: one developer, one chat, one task, idle the moment you close the tab. Devin, Copilot Workspace, Cursor, OpenHands — they all assume a human is sitting there driving.

Kody is built around a different assumption: **engineering work doesn't need a human in the loop for every step.** Most of what teams want done — dependency upgrades, tech-debt sweeps, security audits, doc freshness, test coverage, issue triage, performance hunts — is recurring, well-scoped, and never gets done because no one has time.

Kody is the platform that does it. Unattended. On a schedule. In parallel. With PRs and reports waiting for you in the morning.

---

## What the Engine does

The engine is a single CLI, `kody-engine`, with one entrypoint per capability. Install it in any repo with one command:

```bash
npx -y -p @kody-ade/kody-engine@latest kody-engine init
```

That scaffolds the GitHub Actions workflow, the config, and the scheduled-job workflows. From there, every command below can be invoked via `@kody <command>` comments, the GitHub Actions `workflow_dispatch` UI, or the Kody Dashboard.

### Agent commands (write code)

| Command               | What it does                                                         |
| --------------------- | -------------------------------------------------------------------- |
| `kody run --issue N`  | Implements an issue end-to-end. Opens a PR.                          |
| `kody fix --pr N`     | Applies PR review feedback.                                          |
| `kody fix-ci --pr N`  | Diagnoses and fixes failing CI runs.                                 |
| `kody resolve --pr N` | Merges the default branch into the PR branch and resolves conflicts. |

### Agent commands (read-only)

| Command                   | What it does                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kody plan --issue N`     | Research + implementation plan, posted as a comment.                                                                                                                 |
| `kody research --issue N` | Maps repo context, surfaces gaps for an issue.                                                                                                                       |
| `kody review --pr N`      | Structured diff review with severity levels.                                                                                                                         |
| `kody ui-review --pr N`   | Drives the running preview deployment via Playwright MCP, reviews UI alongside the diff.                                                                             |
| `kody qa-engineer`        | **Free-form QA pass** — browses the running site, exercises happy/empty/error/loading/mobile/a11y states, opens severity-labelled bug issues. Read-only on the repo. |
| `kody classify --issue N` | Picks a flow type (feature/bug/spec/chore) for an unlabelled issue.                                                                                                  |

### Flow orchestrators (declarative pipelines)

Each flow is a transition table — postflight hooks dispatch the next executable based on the previous outcome. No engine changes to add a new flow; drop a new directory.

| Flow                     | Pipeline                                      |
| ------------------------ | --------------------------------------------- |
| `kody feature --issue N` | research → plan → run → review → (fix loop)   |
| `kody bug --issue N`     | plan → run → review → (fix loop)              |
| `kody spec --issue N`    | research → plan (terminates at plan, no code) |
| `kody chore --issue N`   | run → review → (fix loop)                     |

### Duties, watches, managers

A **duty** is a stateful, bounded goal expressed as a markdown file under `.kody/duties/`. A **watch** is a stateless repeating loop. A **manager** is a duty whose goal is overseeing other duties.

`job-scheduler` runs on cron (default every 5 minutes), finds every duty file under `.kody/duties/`, and calls `job-tick` once per duty. The tick agent reads the duty body (human-owned prose) and a state file (bot-owned JSON), decides the next step, and updates state. Children spawn via `gh workflow run`.

This is how Kody runs **autonomously without supervision**. You file a goal as a duty under `.kody/duties/`, and the scheduler keeps making progress every five minutes until the goal is done. Manager duties let you set up org-wide policies (e.g. "keep dependencies fresh across all repos") without any external orchestrator.

### Built-in deterministic commands

`kody sync`, `kody release` (prepare/finalize semver bumps with auto-generated changelogs), `kody init` (idempotent scaffold), `kody memorize` (daily vault wiki update from recent PRs), `kody watch-stale-prs` (weekly report).

### What makes the engine architecturally different

- **Zero hardcoded executable names.** The router resolves `@kody <token>` through config aliases, then auto-discovers from `src/executables/<name>/`. Drop a `profile.json` + `prompt.md` (+ optional `.sh` scripts) and `kody <name>` works.
- **Declarative profiles, not code.** Executable directories contain only three kinds of files: declaration JSON, agent prompt markdown, mechanical side-effect shell scripts. Cross-cutting TypeScript lives separately and can't branch on profile name.
- **Single-session Claude agent.** Every command is one agent session with a focused prompt and a curated tool set — not a chain of LLM calls glued together. Easier to debug, easier to reason about, easier to extend.
- **Playwright MCP integration.** UI review and QA work because the agent can drive a real browser against a real preview deployment, with auth via committed Playwright storageState files.
- **`@kody` ChatOps.** Every command is reachable from issue/PR comments. No new UI to learn — you talk to Kody where the work already lives.

---

## What the Dashboard adds

The engine handles the agent work. The dashboard turns it into a managed platform.

| Capability                           | Why it matters                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task board**                       | Kanban view (inbox → spec → building → review → done) across all engine activity. Drag to change status, click to drill in.                                                                                         |
| **Parallel run monitoring**          | Watch 10 agents work on 10 tasks at once, live, in one view. CLI can't do this.                                                                                                                                     |
| **Duty scheduler UI**                | Markdown-defined duties in `.kody/duties/`, ticked off in the dashboard as they complete. Visual cron without leaving the app.                                                                                      |
| **Live preview management**          | Per-task Fly.io preview environments, with per-repo Fly tokens managed in Settings (never deployment env vars).                                                                                                     |
| **PR viewer**                        | File diffs, CI status, gate approvals — all inline, no GitHub roundtrip.                                                                                                                                            |
| **Provider-agnostic chat**           | Configure any LLM (Claude, GPT, Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI, custom endpoints) per model entry. Two protocols, your keys.                                                                      |
| **Multiple chat backends**           | Direct provider chat for quick questions, external Brain server for advanced reasoning, engine via Actions for full-power agent tasks. One UI.                                                                      |
| **Per-repo encrypted secrets vault** | AES-256-GCM blob at `.kody/secrets.enc`. One master key powers vault + session JWT + HMAC, cryptographically separated by purpose prefixes. Per-user creds (Fly tokens, API keys) live here, not in deployment env. |
| **Real-time status**                 | Push-based GitHub webhooks, IP-verified against GitHub's CIDR list (no shared secret). Polling is the backstop, not the source of truth.                                                                            |
| **Changelog & report aggregation**   | Readable, dated output from every autonomous run, indexed and searchable.                                                                                                                                           |
| **Notifications**                    | Desktop + in-app for completed tasks, blocked gates, report deliveries.                                                                                                                                             |

The dashboard never bypasses GitHub — every state change is a real issue/PR/workflow event. If the dashboard goes down, the engine keeps running. If the engine goes down, the dashboard still shows you the last known state.

---

## What makes the platform different (cross-cutting)

### Scheduled, autonomous, reporting

Agents run on cron, not on prompt. Define a duty once, get output forever — as PRs you review, issues you triage, or markdown reports in the changelog. **Renovate and Dependabot are single-purpose; Kody is a general autonomous-agent runtime.**

Real use cases:

- Nightly dependency upgrades with PRs ready by morning
- Weekly tech-debt sweeps (dead code, lint debt, type coverage)
- Scheduled security audits with findings as issues
- Auto-triage of new issues on a cron
- Continuous test coverage improvements
- Doc freshness checks against the codebase
- Performance regression hunts after each deploy
- Recurring QA passes against staging with severity-labelled bug reports

### Parallel by design

Kick off 10 features at once. Get 10 PRs back with 10 live preview environments. Each task is its own GitHub Actions workflow run on its own runner — no shared sandbox, no editor lock, no queue. Every other agent platform serializes work; Kody parallelizes it natively.

### Runs in _your_ CI, on _your_ account

- **Your compute, your control.** No SaaS bill scaling with usage. Your Actions minutes, your runners (including self-hosted).
- **Your secrets stay yours.** API keys live in your repo's encrypted vault or GitHub Actions secrets — they never touch a third-party service.
- **Full audit trail.** Every agent action is a workflow run with logs, timing, exit codes. Compliance teams love this.
- **Native integration.** Agents produce real PRs that go through your real review process, your real CI, your real branch protections.

This isn't "agent as a SaaS." It's "agent as a teammate with a GitHub account."

### Open and self-hosted

The whole stack is yours to read, fork, and run. No vendor lock-in, no per-seat pricing, no opaque hosted runtime. Self-host the dashboard on Vercel (or anywhere Next.js runs); install the engine in your repos with one `npx` command.

### Bring your own model — at every layer

- **Dashboard chat:** Anthropic Messages API or OpenAI Chat Completions protocol covers Claude, GPT, Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI, DeepInfra, Together, Fireworks, plus a "custom endpoint" preset for self-hosted LiteLLM proxies, vLLM, Ollama, or in-house services.
- **Engine:** built on the Claude Agent SDK, routes non-Anthropic models through LiteLLM's Anthropic-compatible proxy. Configure per-executable model choice if you want (e.g. cheap model for classification, smart model for implementation).

No hardcoded provider, no vendor lock-in, at any layer.

---

## Who this is for

**Engineering teams and dev orgs** that want autonomous agents working alongside humans:

- CTOs who want AI engineering work without handing data to a SaaS vendor.
- Teams running OSS who need help with recurring maintenance no one has time for.
- Platform teams who want to operationalize "AI does the boring engineering work" with audit trails and review gates.
- Anyone tired of paying per-seat for closed, single-threaded AI coding tools.

**Not for:** quick-prototype "vibe coders" who want a hosted sandbox. Use Lovable, v0, or Bolt for that. Kody assumes you have a real repo, a real CI pipeline, and want real reviewable engineering output.

---

## How it compares

|                                       | Kody                          | Devin   | Codegen | Factory.ai | Copilot Workspace | Cursor  | OpenHands |
| ------------------------------------- | ----------------------------- | ------- | ------- | ---------- | ----------------- | ------- | --------- |
| Open source                           | Yes                           | No      | No      | No         | No                | No      | Yes       |
| Self-hosted                           | Yes                           | No      | No      | No         | No                | No      | Yes       |
| Scheduled / autonomous runs           | Yes                           | No      | Limited | Limited    | No                | No      | No        |
| Parallel tasks                        | Yes (native)                  | Limited | Yes     | Yes        | No                | No      | No        |
| Runs in your CI                       | Yes                           | No      | No      | No         | GitHub-locked     | No      | No        |
| `@kody`-style ChatOps in issues/PRs   | Yes                           | No      | Partial | Partial    | No                | No      | No        |
| Free-form QA agent                    | Yes                           | No      | No      | No         | No                | No      | No        |
| Goal-driven duties (autonomous loops) | Yes                           | No      | No      | No         | No                | No      | No        |
| Multi-model (any provider)            | Yes (LiteLLM + OpenAI-compat) | No      | No      | Limited    | No                | Limited | Yes       |
| Visual control plane (dashboard)      | Yes                           | Yes     | Yes     | Yes        | Yes               | n/a     | Yes       |
| Per-seat pricing                      | No                            | Yes     | Yes     | Yes        | Yes               | Yes     | No        |
| Audit trail in your repo              | Yes                           | No      | No      | No         | Partial           | No      | No        |

Of every product in this table, Kody is the only one that is both open-source and in the scheduled-fleet category. The closest "code while you sleep" rivals — Devin, Codegen, Factory.ai — are all closed and per-seat priced; the open-source ones (OpenHands) are single-session tools, not autonomous fleets. Ownership and self-hosting is the axis the closed competitors structurally can't cross.

---

## Architecture at a glance

```
┌──────────────────────────┐       ┌──────────────────────────────┐
│   Kody Dashboard         │       │    Kody Engine               │
│   (Next.js — optional)   │◄─────►│   (GitHub Actions runtime)   │
│                          │       │                              │
│   Visual control plane:  │       │   Autonomous agent runtime:  │
│   - Task board           │       │   - `kody` CLI               │
│   - Duty scheduler UI    │       │   - Claude Agent SDK         │
│   - Parallel monitoring  │       │   - Multi-model (LiteLLM)    │
│   - PR viewer            │       │   - Auto-discovered          │
│   - Provider-agnostic    │       │     executables              │
│     chat                 │       │   - Flow orchestrators       │
│   - Reports & changelog  │       │   - Job scheduler + tick     │
│   - Secrets vault        │       │   - Playwright MCP for UI    │
└──────────────────────────┘       │     review & QA              │
            │                      └──────────────────────────────┘
            │                                  │
            └────────────► GitHub ◄────────────┘
              (issues, PRs, comments, webhooks,
                workflow runs, branches)
```

The engine does the work. The dashboard makes it observable and steerable. GitHub is the source of truth.

---

## Get started

See [README.md](./README.md) for dashboard setup. For the engine, run `npx -y -p @kody-ade/kody-engine@latest kody-engine init` in any repo to scaffold the workflow, then comment `@kody help` on an issue.
