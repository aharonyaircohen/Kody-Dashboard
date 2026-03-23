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
KODY_SESSION_SECRET=your-jwt-secret
GITHUB_TOKEN=ghp_...
GITHUB_APP_CLIENT_ID=your-oauth-client-id
GITHUB_APP_CLIENT_SECRET=your-oauth-client-secret
KODY_PUBLIC_SERVER_URL=http://localhost:3333
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `KODY_SESSION_SECRET` | Yes | JWT session signing |
| `GITHUB_TOKEN` / `KODY_BOT_TOKEN` | Yes | GitHub API access |
| `GITHUB_APP_CLIENT_ID` | Yes | GitHub OAuth App |
| `GITHUB_APP_CLIENT_SECRET` | Yes | GitHub OAuth App |
| `KODY_PUBLIC_SERVER_URL` | Yes | Public URL for OAuth redirects |

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
