# Kody Dashboard

Operations dashboard for the [Kody Engine](https://github.com/aharonyaircohen/Kody-Engine) CI/CD pipeline.

Monitor tasks, approve gates, view pipeline status, manage PRs, and chat with Kody — all from a single web interface.

## Features

- Task board with drag-and-drop columns (inbox, spec, building, review, done)
- Real-time pipeline status and stage progress
- Gate approval workflow (approve/reject from the dashboard)
- PR viewer with file diffs and CI status
- Chat interface with Kody
- Scenario builder for pipeline templates
- GitHub OAuth authentication
- Dark/light theme

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

Open http://localhost:3333

## Environment Variables

Create a `.env` file:

```env
GEMINI_API_KEY=your_gemini_api_key
KODY_MASTER_KEY=64-hex-chars-from-openssl-rand-hex-32
GITHUB_TOKEN=ghp_...
NEXT_PUBLIC_SERVER_URL=http://localhost:3333
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | Yes | Gemini AI model for chat |
| `KODY_MASTER_KEY` | Yes | Single master secret — vault AES, session JWT, ingest HMAC. Generate with `openssl rand -hex 32` or `pnpm vault:init`. |
| `GITHUB_TOKEN` / `KODY_BOT_TOKEN` | Yes | GitHub API access for server-side flows (cron, webhooks). |
| `NEXT_PUBLIC_SERVER_URL` | Dev | Public URL — set in dev only. |

### GitHub token / PAT scopes

The GitHub Personal Access Token used for `GITHUB_TOKEN` / `KODY_BOT_TOKEN`,
and the OAuth scopes the app requests, must cover:

| Scope | Why |
|-------|-----|
| `repo` | Full repo access — issues, PRs, comments, **webhooks** (the `repo` scope already includes `admin:repo_hook`, so no separate webhook scope is needed). |
| `workflow` | Dispatch and cancel GitHub Actions workflow runs. |
| `user:email` | Identify the logged-in user during OAuth (required by the OAuth flow). |

A classic PAT with `repo` + `workflow` is the simplest setup. Create one at
[github.com/settings/tokens](https://github.com/settings/tokens) → "Generate
new token (classic)".

The dashboard auto-registers a GitHub webhook on the connected repo at
login (push-based cache invalidation, no shared secret — verified by
GitHub's source IP). If the user's token lacks `admin:repo_hook`
permission on the repo, registration fails silently and the dashboard
falls back to the existing polling path.

## Development

```bash
pnpm dev            # Start dev server (port 3333)
pnpm build          # Production build
pnpm typecheck      # Type check
pnpm lint           # Lint
pnpm format         # Format
pnpm test           # Run tests
```

## Deployment

Deployed to Vercel at https://kody-aguy.vercel.app

```bash
vercel --prod
```

### OAuth Setup

The GitHub OAuth App callback URL must match your deployment:

```
https://kody-aguy.vercel.app/api/oauth/github/callback
```

## Project Structure

```
app/                              # Next.js App Router
  api/kody/                       # API routes (tasks, PRs, chat, auth)
  api/oauth/                      # GitHub OAuth flow
  [issueNumber]/                  # Task detail pages
  chat/                           # Chat interface
  scenario/                       # Scenario builder
src/dashboard/
  lib/components/                 # React components
  lib/hooks/                      # Custom hooks
  lib/auth/                       # Auth utilities
  lib/notifications/              # Notification system
  providers/                      # Theme provider
  ui/                             # shadcn/ui primitives
```

## License

MIT
