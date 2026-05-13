# Why Kody

**The open, self-hosted control plane for an autonomous engineering workforce.**

Kody Dashboard + [Kody Engine](https://github.com/aharonyaircohen/Kody-Engine) form a complete autonomous development platform for engineering teams. Schedule agents, run many in parallel, review their PRs and reports, and keep full control of your code, secrets, and CI.

---

## The problem

Every other AI coding tool on the market is **interactive and single-threaded**: one developer, one chat, one task, idle the moment you close the tab. Devin, Copilot Workspace, Cursor, OpenHands — they all assume a human is sitting there driving.

Kody is built around a different assumption: **engineering work doesn't need a human in the loop for every step.** Most of what teams want done — dependency upgrades, tech-debt sweeps, security audits, doc freshness, test coverage, issue triage, performance hunts — is recurring, well-scoped, and never gets done because no one has time.

Kody is the platform that does it. Unattended. On a schedule. In parallel. With PRs and reports waiting for you in the morning.

---

## What makes it different

### 1. Scheduled, autonomous, reporting

Agents run on cron, not on prompt. Define a job once — "audit dependencies weekly," "sweep dead code every Friday," "triage new issues hourly" — and Kody handles it. Output is a PR you can review, an issue with findings, or a markdown report in the dashboard's changelog view.

No competitor in the open-source space does this. Renovate and Dependabot are single-purpose; Kody is a general autonomous-agent runtime.

**Real use cases this unlocks:**

- Nightly dependency upgrades with PRs ready by morning
- Weekly tech-debt sweeps (dead code, lint debt, type coverage)
- Scheduled security audits with findings as issues
- Auto-triage of new issues on a cron
- Continuous test coverage improvements
- Doc freshness checks against the codebase
- Performance regression hunts after each deploy

These are things teams already pay humans to do and never get around to.

### 2. Parallel by design

Kick off 10 features at once. Get 10 PRs back with 10 live preview environments. The architecture supports it natively because every task is its own workflow run on its own runner — no shared sandbox, no editor lock, no queue.

Every other agent platform serializes work. Kody parallelizes it.

### 3. Runs in *your* CI, on *your* account

The runtime is GitHub Actions. That means:

- **Your compute, your control.** No SaaS bill scaling with usage. Your Actions minutes, your runners (including self-hosted).
- **Your secrets stay yours.** API keys live in your repo's encrypted vault or GitHub Actions secrets — they never touch a third-party service.
- **Full audit trail.** Every agent action is a workflow run with logs, timing, exit codes. Compliance teams love this.
- **Native integration.** Agents produce real PRs that go through your real review process, your real CI, your real branch protections.

This isn't "agent as a SaaS." It's "agent as a teammate with a GitHub account."

### 4. Open and self-hosted

The whole stack is yours to read, fork, and run. No vendor lock-in, no per-seat pricing, no opaque hosted runtime. Self-host the dashboard on Vercel (or anywhere Next.js runs) and the engine in your repos.

### 5. Multi-model out of the box

The engine is built on the Claude Agent SDK but routes non-Anthropic models through LiteLLM's Anthropic-compatible proxy. Use Claude, GPT, Gemini, Llama, Mistral, or local models — the platform doesn't care.

### 6. Three chat backends, one UI

- **In-process Gemini** for fast, low-cost interactive chat
- **External Brain server** for advanced reasoning
- **Engine via GitHub Actions** for full-power agent tasks that produce PRs

Pick the right tool for the request without leaving the dashboard.

---

## What the dashboard gives you

- **Task board** — Kanban view (inbox → spec → building → review → done) for everything the engine is working on, with drag-and-drop status changes.
- **Job scheduler** — define scheduled and on-demand jobs as markdown files in `.kody/jobs/`; the dashboard ticks them off as they run.
- **Live previews** — per-task preview environments on Fly.io, with per-repo Fly tokens managed in the dashboard's Settings (never as a deployment env var).
- **PR viewer** — file diffs, CI status, gate approvals, all without leaving the tab.
- **Real-time pipeline status** — push-based via GitHub webhooks (verified by source IP, no shared secret needed), with polling fallback.
- **Per-repo encrypted secrets vault** — AES-256-GCM-encrypted blob committed to the repo at `.kody/secrets.enc`. Keys never appear in deployment env, never leave your repo. Single master key powers vault, session JWT, and HMAC.
- **Chat with Kody** — three backends, one interface, with full system-prompt configuration per agent.
- **Changelog & reports** — readable, dated output from autonomous job runs.
- **Notifications** — desktop + in-app for completed tasks, blocked gates, and report deliveries.

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

| | Kody | Devin | Copilot Workspace | Cursor | OpenHands |
|---|---|---|---|---|---|
| Open source | Yes | No | No | No | Yes |
| Self-hosted | Yes | No | No | No | Yes |
| Scheduled / autonomous runs | Yes | No | No | No | No |
| Parallel tasks | Yes (native) | Limited | No | No | No |
| Runs in your CI | Yes | No | GitHub-locked | No | No |
| Multi-model | Yes (LiteLLM) | No | No | Limited | Yes |
| Per-seat pricing | No | Yes | Yes | Yes | No |
| Audit trail in your repo | Yes | No | Partial | No | No |

---

## Architecture at a glance

```
┌─────────────────────┐         ┌──────────────────────┐
│   Kody Dashboard    │         │    Kody Engine       │
│   (Next.js)         │◄───────►│  (GitHub Actions)    │
│                     │         │                      │
│  - Task board       │         │  - Claude Agent SDK  │
│  - Job scheduler    │         │  - Multi-model via   │
│  - PR viewer        │         │    LiteLLM           │
│  - Chat UI          │         │  - Runs per-task in  │
│  - Reports          │         │    isolated workflow │
│  - Secrets vault    │         │    runs              │
└─────────────────────┘         └──────────────────────┘
         │                                  │
         └───────────► GitHub ◄─────────────┘
                  (issues, PRs, webhooks,
                   workflows, branches)
```

The dashboard is the brain; GitHub Actions is the hands; your repo is the world the agents act on.

---

## Get started

See [README.md](./README.md) for setup, environment configuration, and deployment.
