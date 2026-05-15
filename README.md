# Kody Dashboard

Kody is the difference between AI as a coding assistant you babysit (Cursor, Copilot, Devin) and AI as an autonomous engineering teammate that runs on your infrastructure, on a schedule, in parallel, with results you review rather than guide.

Operations UI for the [Kody Engine](https://github.com/aharonyaircohen/Kody-Engine) — the control plane for an autonomous engineering workforce.

Monitor tasks, schedule autonomous jobs, run agents in parallel, approve gates, review PRs and reports, and chat with Kody — all from a single web interface.

**New here?** Read [WHY-KODY.md](./WHY-KODY.md) for what this platform is, who it's for, and why it exists.

---

## Quick start

```bash
# Install dependencies
pnpm install

# Generate a master key
pnpm vault:init   # prints a 32-byte hex secret — save it

# Configure environment
cat > .env <<EOF
KODY_MASTER_KEY=<paste from above>
GITHUB_TOKEN=ghp_...
NEXT_PUBLIC_SERVER_URL=http://localhost:3333
EOF

# Start the dashboard
pnpm dev
```

Open <http://localhost:3333>, sign in with GitHub, and point it at a repo where the [Kody Engine](https://github.com/aharonyaircohen/Kody-Engine) is installed. Add at least one LLM provider in the dashboard's Models manager (any OpenAI-compatible or Anthropic endpoint — Claude, GPT, Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI, or a custom endpoint).

---

## Features

- Task board (inbox → spec → building → review → done) with drag-and-drop
- Job scheduler — markdown-defined jobs in `.kody/jobs/`, ticked off as they run
- Parallel task execution — each task is its own GitHub Actions workflow run
- PR viewer with file diffs, CI status, and gate approvals
- Live previews — per-task Fly.io preview environments
- Per-repo encrypted secrets vault (`.kody/secrets.enc`, AES-256-GCM)
- Provider-agnostic chat — Claude, GPT, Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI, or any OpenAI-compatible endpoint, configured in-app (Anthropic Messages or OpenAI Chat Completions protocols)
- Multiple chat backends (direct via configured provider, external Brain, engine via GitHub Actions)
- Real-time pipeline status via GitHub webhooks (push-based, IP-verified)
- Changelog & report aggregation from autonomous runs
- Desktop + in-app notifications
- GitHub OAuth authentication
- Dark/light theme

---

## Environment variables

The dashboard intentionally keeps the env surface tiny. **One** secret is required; everything else is either a non-secret config knob or lives in the dashboard's Settings page (user-scoped, not deployment-scoped).

| Variable | Required | Purpose |
|----------|----------|---------|
| `KODY_MASTER_KEY` | Yes | 32-byte hex/base64 secret. Powers per-repo secrets vault (AES-256-GCM), session JWT signing, and chat-ingest HMAC. Each consumer purpose-prefixes the key so they're cryptographically separated. Generate with `pnpm vault:init`. |
| `GITHUB_TOKEN` | Yes | Server-side GitHub API token for cron/webhook flows. Needs `repo` + `workflow` scope. |
| `KODY_CHAT_WORKFLOW_REPO` | Optional | Central engine repo (default: connected repo). |
| `KODY_CHAT_WORKFLOW_ID` | Optional | Chat workflow filename (default: `kody.yml`). |
| `JINA_API_KEY` | Optional | Jina Reader key for the `fetch_url` tool. |
| `NEXT_PUBLIC_SERVER_URL` | Dev only | Public URL for callbacks. |

**Per-user credentials live in the dashboard's Settings page**, not as deployment env vars. This includes LLM API keys (configured per model entry in Models manager) and infra tokens like Fly. They're stored in the per-repo encrypted vault and sent per-request via headers. Same rule for any future per-user credential.

### GitHub token / PAT scopes

| Scope | Why |
|-------|-----|
| `repo` | Issues, PRs, comments, and webhooks (`repo` includes `admin:repo_hook`). |
| `workflow` | Dispatch and cancel GitHub Actions runs. |
| `user:email` | Identify the user on OAuth login. |

A classic PAT with `repo` + `workflow` is the simplest setup. Create one at [github.com/settings/tokens](https://github.com/settings/tokens).

The dashboard auto-registers a webhook on the connected repo at login (push-based cache invalidation, no shared secret — verified by GitHub's source IP CIDR list). If the user's token lacks `admin:repo_hook` on the repo, registration fails silently and the dashboard falls back to polling.

---

## Development

```bash
pnpm dev          # Dev server on :3333
pnpm build        # Production build
pnpm typecheck    # Type check
pnpm lint         # Lint
pnpm format       # Format
pnpm test         # Run tests
```

### Project structure

```
app/
  api/kody/           # Task, PR, chat, job, secrets endpoints
  api/oauth/          # GitHub OAuth flow
  api/webhooks/       # GitHub webhook receiver
  [issueNumber]/      # Task detail pages
  chat/               # Chat UI
  scenario/           # Scenario builder

src/dashboard/lib/
  components/         # React UI
  hooks/              # Custom hooks
  auth/               # GitHub OAuth + session
  vault/              # Per-repo encrypted secrets
  webhooks/           # GitHub webhook handlers + registration
  changelog/          # Job report aggregation
  notifications/      # Desktop + in-app
```

### Import aliases

```typescript
import { ... } from '@dashboard/...'    // src/dashboard/
import { ... } from '@/...'             // src/
```

---

## Deployment

Deploy to your own Vercel project (set `NEXT_PUBLIC_SERVER_URL` to the public
URL of that deployment so webhook registration and OG metadata use it):

```bash
vercel --prod
```

The OAuth App callback URL must match your deployment:

```
https://<your-domain>/api/oauth/github/callback
```

Set `KODY_MASTER_KEY`, `GITHUB_TOKEN`, and any optional keys in your hosting provider's env config. Everything user-scoped (Fly tokens, per-user API keys) is configured in the dashboard's Settings page at runtime.

---

## Design principles

These aren't aspirational — they're load-bearing rules that shape the codebase. See [`CLAUDE.md`](./CLAUDE.md) for the full version.

- **One canonical env var per concern.** No `FOO ?? BAR` fallback chains.
- **Secrets are user-scoped by default.** If a credential belongs to one user, it goes in Settings, not in deployment env.
- **Cache discipline matters.** Polling-path GitHub calls use ETag + 304 + in-flight dedup. Bypassing cache to "fix staleness" is forbidden — it burns the rate-limit budget for every user.
- **Push beats poll.** GitHub webhooks drive invalidation; polling is the backstop, not the source of truth.
- **Clean architecture.** Modular separation, named modules per concern, no god-routes.

---

## License

MIT
